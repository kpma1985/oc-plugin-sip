/**
 * A single inbound/outbound call on the media path. Frames are paced at 20 ms
 * so the gateway's jitter buffer behaves like it does with a real carrier.
 */
import {
  MULAW_FRAME_BYTES,
  TELEPHONY_SAMPLE_RATE,
  buildClearFrame,
  buildMarkFrame,
  buildMediaFrame,
} from './twilioFrames.js';
import { CallCodec, type AudioCodec } from './codecs.js';

export type CallState = 'starting' | 'active' | 'ended';

export interface CallSessionOptions {
  streamSid: string;
  codec?: AudioCodec;
  callSid?: string;
  from?: string;
  to?: string;
  onSend: (payload: string) => void;
  onEnd?: (reason: string) => void;
  maxQueuedBytes?: number;
}

export class CallSession {
  readonly streamSid: string;
  readonly media: CallCodec;
  readonly callSid?: string;
  readonly from?: string;
  readonly to?: string;
  readonly startedAt = Date.now();

  private state: CallState = 'starting';
  private queue: Array<Buffer | string> = [];
  private partial = Buffer.alloc(0);
  private maxQueuedBytes = 64000;
  private prebufferBytes = 0;
  private pumping = false;
  private pumpTimer: NodeJS.Timeout | null = null;
  private readonly capacityWaiters = new Set<() => void>();
  private playbackGeneration = 0;
  private readonly onSend: (payload: string) => void;
  private readonly onEndCb?: (reason: string) => void;

  constructor(options: CallSessionOptions) {
    this.streamSid = options.streamSid;
    this.media = new CallCodec(options.codec);
    this.callSid = options.callSid;
    this.from = options.from;
    this.to = options.to;
    this.onSend = options.onSend;
    this.onEndCb = options.onEnd;
    this.maxQueuedBytes = options.maxQueuedBytes ?? 64000;
  }

  get currentState(): CallState {
    return this.state;
  }

  setQueueLimit(bytes: number): void { this.maxQueuedBytes = bytes; }

  /** Streaming-only threshold; completed clips/marks bypass it. */
  setPlaybackPrebuffer(ms: number): void {
    if (!Number.isInteger(ms) || ms < 0 || ms > 2000 || ms % 20) throw new Error('Invalid playback prebuffer');
    this.prebufferBytes = ms * (TELEPHONY_SAMPLE_RATE / 1000);
  }

  get queuedBytes(): number {
    return this.partial.length + this.queue.reduce((total, frame) => total + (typeof frame === 'string' ? Buffer.byteLength(frame) : frame.length), 0);
  }

  /** Mark the call active once the gateway reported `start`. */
  activate(): void {
    if (this.state === 'starting') this.state = 'active';
  }

  /** Queue outbound mu-law audio (8 kHz) for 20 ms paced playback. */
  sendAudio(mulaw: Uint8Array): void {
    this.sendAudioChunk(mulaw);
    this.flushAudio();
    this.startPump(true);
  }

  sendAudioChunk(mulaw: Uint8Array): void {
    if (this.state === 'ended') return;
    if (this.queuedBytes + mulaw.length > this.maxQueuedBytes) throw new Error('Outbound audio queue limit');
    const data = Buffer.concat([this.partial, mulaw]);
    let offset = 0;
    for (; offset + MULAW_FRAME_BYTES <= data.length; offset += MULAW_FRAME_BYTES) {
      this.queue.push(Buffer.from(data.subarray(offset, offset + MULAW_FRAME_BYTES)));
    }
    this.partial = Buffer.from(data.subarray(offset));
    this.startPump();
  }

  private async waitForCapacity(bytes: number, signal: AbortSignal, generation: number): Promise<void> {
    if (bytes > this.maxQueuedBytes) throw new Error('Outbound audio queue limit');
    while (true) {
      signal.throwIfAborted();
      if (this.currentState === 'ended' || generation !== this.playbackGeneration) throw new Error('Playback cancelled');
      if (this.queuedBytes + bytes <= this.maxQueuedBytes) return;
      this.startPump(true);
      await new Promise<void>(resolve => {
        const wake = (): void => {
          this.capacityWaiters.delete(wake);
          signal.removeEventListener('abort', wake);
          resolve();
        };
        this.capacityWaiters.add(wake);
        signal.addEventListener('abort', wake, { once: true });
      });
    }
  }

  async sendAudioChunkAsync(audio: Uint8Array, signal: AbortSignal): Promise<void> {
    const generation = this.playbackGeneration;
    for (let offset = 0; offset < audio.length;) {
      const length = Math.min(MULAW_FRAME_BYTES - this.partial.length, audio.length - offset);
      await this.waitForCapacity(length, signal, generation);
      this.sendAudioChunk(audio.subarray(offset, offset + length));
      offset += length;
    }
  }

  async markAsync(name: string, signal: AbortSignal): Promise<void> {
    const generation = this.playbackGeneration;
    await this.waitForCapacity(this.partial.length ? MULAW_FRAME_BYTES - this.partial.length : 0, signal, generation);
    this.flushAudio();
    await this.waitForCapacity(Buffer.byteLength(name), signal, generation);
    this.mark(name);
  }

  private flushAudio(): void {
    if (!this.partial.length) return;
    if (this.queuedBytes + MULAW_FRAME_BYTES - this.partial.length > this.maxQueuedBytes) throw new Error('Outbound audio queue limit');
    const frame = this.media.silence();
    this.partial.copy(frame);
    this.partial = Buffer.alloc(0);
    this.queue.push(frame);
    this.startPump();
  }

  /** Barge-in: drop buffered audio on the gateway and locally. */
  interrupt(): void {
    this.playbackGeneration++;
    for (const wake of this.capacityWaiters) wake();
    this.queue = [];
    this.partial = Buffer.alloc(0);
    this.media.reset();
    this.pumping = false;
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    if (this.state !== 'ended') this.onSend(buildClearFrame(this.streamSid));
  }

  /** Ask the gateway to confirm playout of everything queued so far. */
  mark(name: string): void {
    if (this.state === 'ended') return;
    this.flushAudio();
    if (this.queuedBytes + Buffer.byteLength(name) > this.maxQueuedBytes) throw new Error('Outbound mark queue limit');
    this.queue.push(name);
    this.startPump(true);
  }

  end(reason: string): void {
    if (this.state === 'ended') return;
    this.state = 'ended';
    for (const wake of this.capacityWaiters) wake();
    this.pumping = false;
    this.queue = [];
    this.partial = Buffer.alloc(0);
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
    this.onEndCb?.(reason);
  }

  private startPump(force = false): void {
    if (this.pumping || this.state === 'ended') return;
    // Count full audio frames only. Cap threshold at queue capacity so small
    // configured limits cannot leave streaming playback waiting forever.
    const threshold = Math.min(this.prebufferBytes, Math.floor(this.maxQueuedBytes / MULAW_FRAME_BYTES) * MULAW_FRAME_BYTES);
    const audioBytes = this.queue.reduce((total, frame) => total + (typeof frame === 'string' ? 0 : frame.length), 0);
    if (!force && audioBytes < threshold) return;
    this.pumping = true;
    const tick = (): void => {
      const frame = this.queue.shift();
      for (const wake of this.capacityWaiters) wake();
      if (!frame) {
        this.pumping = false;
        if (this.pumpTimer) {
          clearInterval(this.pumpTimer);
          this.pumpTimer = null;
        }
        return;
      }
      if (typeof frame === 'string') this.onSend(buildMarkFrame(this.streamSid, frame));
      else this.onSend(buildMediaFrame(this.streamSid, frame));
    };
    // 20 ms per frame == the frame duration in the wire format.
    this.pumpTimer = setInterval(tick, (MULAW_FRAME_BYTES / (TELEPHONY_SAMPLE_RATE / 1000)));
  }
}

/** Tracks live calls so policy, limits and shutdown can act on all of them. */
export class CallRegistry {
  private readonly calls = new Map<string, CallSession>();

  add(session: CallSession): void {
    this.calls.set(session.streamSid, session);
  }

  get(streamSid: string): CallSession | undefined {
    return this.calls.get(streamSid);
  }

  remove(streamSid: string): void {
    this.calls.delete(streamSid);
  }

  get size(): number {
    return this.calls.size;
  }

  list(): CallSession[] {
    return [...this.calls.values()];
  }

  /** Hang up every live call, e.g. on plugin deactivation. */
  terminateAll(reason: string): void {
    for (const call of this.calls.values()) call.end(reason);
    this.calls.clear();
  }
}
