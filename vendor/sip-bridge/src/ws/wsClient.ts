import { WebSocket } from 'ws';
import type { Logger } from 'pino';

export interface WsCallParams {
  streamSid: string;
  callSid: string;
  from: string;
  to: string;
  sipCallId: string;
  mediaFormat: { encoding: string; sampleRate: number; channels: number };
  /** Extra key/value pairs from Voice-URL TwiML <Parameter> children, merged into customParameters. */
  extraCustomParameters?: Record<string, string>;
}

export interface WsClient {
  /** Forward mulaw payload Buffer from RTP as inbound media event */
  sendAudio(payload: Buffer): void;
  /** Forward DTMF digit string as dtmf event */
  sendDtmf(digit: string): void;
  /** Send stop event, then close the WebSocket */
  stop(): void;
  /** Register handler for outbound audio payload from WS backend (decode base64 → Buffer) */
  onAudio(handler: (payload: Buffer) => void): void;
  /** Register handler for WS close/error — called when WS disconnects for any reason */
  onDisconnect(handler: () => void): void;
  /** Register handler for mark events echoed back from the drain queue */
  onMark(handler: (markName: string) => void): void;
  /** Echo a mark name back to the WS backend as a Twilio mark event */
  sendMark(markName: string): void;
  /** Discard all buffered outbound audio and echo all pending marks immediately */
  sendClear(): void;
}

// Tagged union for drain queue items — audio frames or mark sentinels
type DrainItem = Buffer | { markName: string };

/**
 * Exposed for unit testing — returns the makeDrain function with both arguments.
 * Production code uses the internal makeDrain closure inside buildClient().
 */
export function makeDrainForTest(
  sendPacket: (pkt: Buffer) => void,
  onMarkReady: (name: string) => void,
): {
  enqueue(pkt: Buffer): void;
  enqueueMark(name: string): void;
  stop(): void;
} {
  return makeDrain(sendPacket, onMarkReady);
}

export function createWsClient(
  url: string,
  params: WsCallParams,
  log: Logger,
): Promise<WsClient> {
  const { streamSid, callSid, from, to, sipCallId, mediaFormat, extraCustomParameters } = params;

  return new Promise<WsClient>((resolve, reject) => {
    const ws = new WebSocket(url, { maxPayload: 1024 * 1024 });

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WS connect timeout after 2000ms to ${url}`));
    }, 2000);

    ws.once('open', () => {
      clearTimeout(timer);
      log.info({ event: 'ws_connected', url }, 'WS connected to backend');

      // Send connected event immediately
      ws.send(
        JSON.stringify({
          event: 'connected',
          protocol: 'Call',
          version: '1.0.0',
        }),
      );

      // Send start event immediately (sequenceNumber '1')
      // Merge extra params from Voice-URL TwiML <Parameter> children.
      // Reserved keys (From, To, sipCallId) take precedence.
      const reservedCustomParams: Record<string, string> = { From: from, To: to, sipCallId };
      const customParameters: Record<string, string> = { ...extraCustomParameters, ...reservedCustomParams };
      ws.send(
        JSON.stringify({
          event: 'start',
          sequenceNumber: '1',
          start: {
            streamSid,
            accountSid: '',
            callSid,
            tracks: ['inbound', 'outbound'],
            customParameters,
            mediaFormat,
          },
          streamSid,
        }),
      );

      log.info({ event: 'ws_start_sent', streamSid, callSid }, 'connected + start events sent');
      resolve(buildClient());
    });

    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Per-session sequencing state — seq 1 was used by start event
    let seq = 2;
    let chunk = 0;
    let rtpTimestamp = 0;

    function buildClient(): WsClient {
      const PACKET_MS = 20;
      const PACKET_BYTES = 160; // 20 ms of mulaw at 8 kHz

      // ── Smooth drain helper ────────────────────────────────────────────────────
      // Both inbound (RTP → WS) and outbound (WS → RTP) use the same pacing logic:
      //   • self-correcting recursive setTimeout so ±2 ms drift is recovered next tick
      //   • reset-on-stall: if we are more than one full packet behind (V8 GC pause
      //     typically ~100 ms every ~500 ms), reset the baseline instead of bursting.
      //     A brief audio gap is far less audible than jitter-buffer overflow.

      // ── Inbound drain: RTP → WS ────────────────────────────────────────────────
      // GC pauses cause UDP packets to queue in the OS buffer and arrive in a burst.
      // Without smoothing the WS backend sees 100 ms gaps + 5 packets at 0 ms each.
      const inboundDrain = makeDrain(
        (pkt) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              event: 'media',
              sequenceNumber: String(seq++),
              media: {
                track: 'inbound',
                chunk: String(chunk++),
                timestamp: String(rtpTimestamp),
                payload: pkt.toString('base64'),
              },
              streamSid,
            }),
          );
          rtpTimestamp += 160; // 20 ms at 8 kHz
        },
        () => {}, // inbound drain has no mark sentinels — no-op onMarkReady
      );

      // ── Outbound drain: WS → RTP ───────────────────────────────────────────────
      // TTS backends send the whole audio clip as one base64 blob. Chunk into 160-byte
      // slices and drain one packet per 20 ms so the phone's jitter buffer stays full.
      let outboundHandler: ((payload: Buffer) => void) | null = null;
      let markHandler: ((name: string) => void) | null = null;
      const outboundDrain = makeDrain(
        (pkt) => outboundHandler?.(pkt),
        (name) => markHandler?.(name), // routes mark echoes to registered handler
      );

      function enqueueOutbound(decoded: Buffer): void {
        for (let off = 0; off < decoded.length; off += PACKET_BYTES) {
          const slice = decoded.subarray(off, off + PACKET_BYTES);
          if (slice.length < PACKET_BYTES) {
            // Pad short final chunk to a full 20 ms packet with μ-law silence (0xFF).
            // A sub-160-byte RTP packet confuses G.711 decoders and causes a glitch.
            const padded = Buffer.alloc(PACKET_BYTES, 0xff);
            slice.copy(padded);
            outboundDrain.enqueue(padded);
          } else {
            outboundDrain.enqueue(slice);
          }
        }
      }

      return {
        sendAudio(payload: Buffer): void {
          if (ws.readyState !== WebSocket.OPEN) {
            log.warn({ event: 'ws_send_skipped', reason: 'not_open' }, 'WS not OPEN — dropping audio packet');
            return;
          }
          inboundDrain.enqueue(payload);
        },

        sendDtmf(digit: string): void {
          if (ws.readyState !== WebSocket.OPEN) {
            log.warn({ event: 'ws_send_skipped', reason: 'not_open' }, 'WS not OPEN — dropping DTMF digit');
            return;
          }
          ws.send(
            JSON.stringify({
              event: 'dtmf',
              streamSid,
              sequenceNumber: String(seq++),
              dtmf: {
                track: 'inbound_track',
                digit,
              },
            }),
          );
        },

        stop(): void {
          // Discard any queued audio in both directions — call is ending
          inboundDrain.stop();
          outboundDrain.stop();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                event: 'stop',
                sequenceNumber: String(seq++),
                stop: {
                  accountSid: '',
                  callSid,
                },
                streamSid,
              }),
            );
            ws.close();
          } else {
            ws.terminate();
          }
        },

        onAudio(handler: (payload: Buffer) => void): void {
          outboundHandler = handler;
          ws.on('message', (data) => {
            let msg: {
              event: string;
              media?: { payload: string };
              mark?: { name: string };
            };
            try {
              msg = JSON.parse(data.toString()) as {
                event: string;
                media?: { payload: string };
                mark?: { name: string };
              };
            } catch {
              return;
            }
            if (!msg || typeof msg !== 'object') return;
            switch (msg.event) {
              case 'media':
                if (typeof msg.media?.payload === 'string') {
                  enqueueOutbound(Buffer.from(msg.media.payload, 'base64'));
                }
                break;
              case 'mark':
                if (typeof msg.mark?.name === 'string' && Buffer.byteLength(msg.mark.name) <= 256) {
                  log.debug({ event: 'mark_received', name: msg.mark.name }, 'mark event received');
                  outboundDrain.enqueueMark(msg.mark.name);
                }
                break;
              case 'clear':
                log.debug({ event: 'clear_received' }, 'clear event received');
                outboundDrain.stop();
                break;
              default:
                break;
            }
          });
        },

        onDisconnect(handler: () => void): void {
          ws.once('close', handler);
          ws.once('error', (err) => {
            log.error({ err, event: 'ws_error' }, 'WS error');
            handler();
          });
        },

        onMark(handler: (markName: string) => void): void {
          markHandler = handler;
        },

        sendMark(markName: string): void {
          if (ws.readyState !== WebSocket.OPEN) {
            log.warn({ event: 'ws_send_skipped', reason: 'not_open' }, 'WS not OPEN — dropping mark echo');
            return;
          }
          if (typeof markName !== 'string' || Buffer.byteLength(markName) > 256) return;
          log.debug({ event: 'mark_echoed', name: markName }, 'mark echo sent to WS backend');
          ws.send(
            JSON.stringify({
              event: 'mark',
              sequenceNumber: String(seq++),
              streamSid,
              mark: { name: markName },
            }),
          );
        },

        sendClear(): void {
          // stop() echoes all pending mark sentinels then flushes the queue
          // The drain restarts automatically on the next enqueue() call
          outboundDrain.stop();
        },
      };
    }
  });
}

// ── Internal drain implementation ──────────────────────────────────────────────

function makeDrain(
  sendPacket: (pkt: Buffer) => void,
  onMarkReady: (name: string) => void,
): {
  enqueue(pkt: Buffer): void;
  enqueueMark(name: string): void;
  stop(): void;
} {
  const queue: DrainItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let base = 0;
  let count = 0;
  const PACKET_MS = 20;

  // Bound every retained item, including marks and tiny views of large buffers.
  const MAX_QUEUE_ITEMS = 5000;
  const MAX_QUEUE_BYTES = 800_000;
  const MAX_MARK_BYTES = 256;
  let queuedBytes = 0;
  const size = (item: DrainItem): number => Buffer.isBuffer(item) ? item.length : Buffer.byteLength(item.markName);

  function shift(): DrainItem | undefined {
    const item = queue.shift();
    if (item !== undefined) queuedBytes -= size(item);
    return item;
  }

  function reserve(bytes: number): boolean {
    if (bytes > MAX_QUEUE_BYTES) return false;
    // Evict oldest items of either kind. Evicted marks are discarded, not echoed:
    // overload must not claim that dropped audio was successfully played.
    while (queue.length >= MAX_QUEUE_ITEMS || queuedBytes + bytes > MAX_QUEUE_BYTES) shift();
    return true;
  }

  function schedule(): void {
    const now = Date.now();
    const deadline = base + count * PACKET_MS;
    if (now - deadline > PACKET_MS) {
      base = now;
      count = 0;
    }
    timer = setTimeout(() => {
      timer = null;
      const item = shift();
      if (item !== undefined) {
        if (Buffer.isBuffer(item)) {
          count++;
          sendPacket(item);
        } else {
          onMarkReady(item.markName);
        }
      }
      if (queue.length > 0 && timer === null) schedule();
    }, Math.max(0, base + count * PACKET_MS - now));
  }

  function start(): void {
    if (timer === null) {
      base = Date.now();
      count = 0;
      schedule();
    }
  }

  return {
    enqueue(pkt: Buffer): void {
      if (pkt.length === 0 || !reserve(pkt.length)) return;
      // allocUnsafeSlow gives this item its own backing store, unlike subarray
      // or small pooled Buffer copies which can retain unrelated allocation data.
      const copy = Buffer.allocUnsafeSlow(pkt.length);
      pkt.copy(copy);
      queue.push(copy);
      queuedBytes += copy.length;
      start();
    },

    enqueueMark(name: string): void {
      if (typeof name !== 'string') return;
      const bytes = Buffer.byteLength(name);
      if (bytes > MAX_MARK_BYTES) return;
      if (queue.length === 0 && timer === null) {
        onMarkReady(name);
        return;
      }
      if (!reserve(bytes)) return;
      queue.push({ markName: name });
      queuedBytes += bytes;
      start();
    },

    stop(): void {
      // Detach before callbacks so re-entrant enqueues are not silently erased.
      const pending = queue.splice(0);
      queuedBytes = 0;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      for (const item of pending) {
        if (!Buffer.isBuffer(item)) onMarkReady(item.markName);
      }
    },
  };
}
