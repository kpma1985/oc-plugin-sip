/**
 * Media WebSocket endpoint. Two producers can attach:
 *  - transport "embedded": our own SIP UAS (vendor/sip-bridge) connects locally
 *  - transport "bridge":   an external Twilio-Media-Streams gateway (e.g.
 *    sipgate-sip-stream-bridge) connects over loopback or the LAN.
 *
 * Both speak the same protocol, so the agent side never learns which one is in
 * use. This module owns protocol parsing, call registration and audio pacing;
 * consumers only see CallSession objects and typed events.
 */
import { EventEmitter } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';

import { CallRegistry, CallSession } from './callSession.js';
import { codecFromFormat } from './codecs.js';
import {
  decodeMediaPayload,
  TELEPHONY_SAMPLE_RATE,
  parseMediaStreamsFrame,
  type TwilioDtmfEvent,
  type TwilioMarkEvent,
  type TwilioMediaEvent,
  type TwilioStartEvent,
} from './twilioFrames.js';

export interface MediaServerOptions {
  host: string;
  port: number;
  path: string;
  onLog?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface MediaServerEvents {
  call: [CallSession, Record<string, string>];
  audio: [CallSession, Uint8Array];
  dtmf: [CallSession, string];
  mark: [CallSession, string];
  end: [string, string];
  error: [Error];
}

export class MediaServer extends EventEmitter<MediaServerEvents> {
  readonly registry = new CallRegistry();

  private server: WebSocketServer | null = null;
  private stopping: Promise<void> | null = null;
  private readonly options: MediaServerOptions;

  constructor(options: MediaServerOptions) {
    super();
    this.options = options;
  }

  /** Bind the media endpoint. Rejects when host/port/path are unusable. */
  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const { host, port, path } = this.options;
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ host, port, path });
      server.once('listening', () => {
        this.server = server;
        resolve();
      });
      server.once('error', (err: Error) => {
        server.close();
        reject(err);
      });
      server.on('connection', (socket, request) =>
        this.attach(socket, request.socket.remoteAddress ?? 'unknown'),
      );
    });
  }

  get address(): { address: string; port: number } | null {
    const addr = this.server?.address();
    return typeof addr === 'object' && addr !== null ? { address: addr.address, port: addr.port } : null;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.registry.terminateAll('server-stop');
    const server = this.server;
    this.server = null;
    this.stopping = new Promise<void>((resolve, reject) => {
      if (!server) { resolve(); return; }
      for (const socket of server.clients) socket.terminate();
      server.close((error) => error ? reject(error) : resolve());
    });
    return this.stopping;
  }

  private attach(socket: WebSocket, remote: string): void {
    let session: CallSession | null = null;
    this.options.onLog?.('media-connection-open', { remote });

    socket.on('message', (data) => {
      const event = parseMediaStreamsFrame(String(data));
      if (!event) return;

      switch (event.event) {
        case 'start': {
          if (session) { socket.terminate(); break; }
          const start = (event as TwilioStartEvent).start ?? {};
          const format = start.mediaFormat;
          const codec = format ? codecFromFormat(format.encoding ?? '', format.sampleRate ?? 0) : 'pcmu';
          if (!codec || (format?.channels !== undefined && format.channels !== 1)) {
            this.emit('error', new Error('Unsupported mono media stream codec or sample rate'));
            socket.terminate();
            break;
          }
          const custom = start.customParameters ?? {};
          const started = new CallSession({
            streamSid: event.streamSid,
            codec,
            callSid: start.callSid,
            from: custom['From'] ?? custom['from'] ?? custom['caller'],
            to: custom['To'] ?? custom['to'] ?? custom['dialed'],
            onSend: (payload) => {
              if (socket.readyState !== socket.OPEN) return;
              if (socket.bufferedAmount + Buffer.byteLength(payload) > 262144) {
                started.end('media-backpressure'); return;
              }
              socket.send(payload, error => { if (error) started.end('media-send-error'); });
            },
            onEnd: (reason) => {
              this.registry.remove(event.streamSid);
              this.emit('end', event.streamSid, reason);
              socket.terminate();
            },
          });
          started.activate();
          session = started;
          this.registry.add(started);
          this.options.onLog?.('call-start', { streamSid: started.streamSid, remote });
          this.emit('call', started, custom);
          break;
        }
        case 'media': {
          if (!session) break;
          this.emit('audio', session, decodeMediaPayload(event as TwilioMediaEvent));
          break;
        }
        case 'dtmf': {
          if (!session) break;
          this.emit('dtmf', session, (event as TwilioDtmfEvent).dtmf.digit);
          break;
        }
        case 'mark': {
          if (!session) break;
          this.emit('mark', session, (event as TwilioMarkEvent).mark.name);
          break;
        }
        case 'stop': {
          if (!session) break;
          this.registry.remove(session.streamSid);
          session.end('gateway-stop');
          session = null;
          break;
        }
        default:
          break;
      }
    });

    socket.on('close', () => {
      const current = session;
      if (current) {
        this.registry.remove(current.streamSid);
        current.end('websocket-close');
      }
      this.options.onLog?.('media-connection-close', { remote });
    });

    socket.on('error', (err: Error) => this.emit('error', err));
  }
}
