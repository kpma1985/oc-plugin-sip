import WebSocket from 'ws';
import type { SipPluginConfig } from '../config.js';
import type { CallSession } from '../media/callSession.js';
import { pcm16ToMulaw } from '../media/ulaw.js';
import { MAX_TTS_CHUNK_CHARS, MAX_VOICE_REPLY_CHARS } from './textLimits.js';

export interface VoiceDependencies {
  /** Trusted test injection only; production URLs remain TLS-only. */
  listenUrl?: string;
  speakUrl?: string;
  fetch?: typeof fetch;
}
export type UtteranceHook = (text: string, signal: AbortSignal, session: CallSession) => string | Promise<string>;

/** OpenAI-compatible raw PCM is mono signed LE 24 kHz. Average groups of three
 * samples (box low-pass) before encoding 8 kHz; never relabel 24 kHz as 8 kHz. */
export function pcm24kToMulaw(data: Buffer): Uint8Array {
  if (data.length % 6) throw new Error('Incomplete 24 kHz PCM group');
  const pcm = Buffer.alloc(data.length / 3);
  for (let i = 0; i < pcm.length / 2; i++) {
    pcm.writeInt16LE(Math.round((data.readInt16LE(i * 6) + data.readInt16LE(i * 6 + 2) + data.readInt16LE(i * 6 + 4)) / 3), i * 2);
  }
  return pcm16ToMulaw(pcm);
}

/** Split on sentence ends followed by whitespace, so "3.5" stays whole; never returns empty sentences. */
export function splitSentences(text: string): string[] {
  const chunks: string[] = [];
  for (const sentence of (text.match(/.+?(?:[.!?]+(?=\s|$)|$)/gs) ?? [text])) {
    let remaining = sentence.trim();
    while (remaining.length > MAX_TTS_CHUNK_CHARS) {
      const boundary = remaining.lastIndexOf(' ', MAX_TTS_CHUNK_CHARS);
      const length = boundary > 0 ? boundary : MAX_TTS_CHUNK_CHARS;
      chunks.push(remaining.slice(0, length));
      remaining = remaining.slice(length).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}

export function pcm24kToPcm(data: Uint8Array, sampleRate: number): Buffer {
  if (data.length % 6) throw new Error('Incomplete 24 kHz PCM group');
  if (sampleRate !== 8000 && sampleRate !== 16000) throw new Error('Unsupported output sample rate');
  const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const samples = source.length / 2;
  const output = Buffer.alloc(sampleRate === 8000 ? samples / 3 * 2 : samples / 3 * 4);
  for (let index = 0; index < samples / 3; index++) {
    const first = source.readInt16LE(index * 6);
    const second = source.readInt16LE(index * 6 + 2);
    const third = source.readInt16LE(index * 6 + 4);
    if (sampleRate === 8000) output.writeInt16LE(Math.round((first + second + third) / 3), index * 2);
    else {
      output.writeInt16LE(Math.round((3 * first + 2 * second + third) / 6), index * 4);
      output.writeInt16LE(Math.round((first + 2 * second + 3 * third) / 6), index * 4 + 2);
    }
  }
  return output;
}

export class VoiceCall {
  private socket: WebSocket;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private stopped = false;
  private generation = 0;
  private controller?: AbortController;
  private connectTimer: NodeJS.Timeout;
  private keepalive?: NodeJS.Timeout;
  private finalText = '';
  private thinking = '';
  private lastFinalEnd = -1;
  private emittedEnd = -1;
  private pinState: { digits: string; attempts: number } | null = null;
  private pinAuthenticated = false;
  private pinTimeout?: NodeJS.Timeout;

  constructor(private session: CallSession, private config: SipPluginConfig,
    private utterance: UtteranceHook | undefined, private log: ((event: string, fields?: Record<string, unknown>) => void) | undefined,
    private dependencies: VoiceDependencies = {}) {
    session.setQueueLimit(config.voice.maxOutboundBytes);
    const url = new URL(dependencies.listenUrl ?? `${config.stt.baseUrl.replace(/\/$/, '')}/v1/listen`);
    const params = {
      encoding: session.media.codec === 'pcmu' ? 'mulaw' : 'linear16',
      sample_rate: String(session.media.sampleRate), channels: '1', interim_results: 'true',
      vad_events: 'true', model: config.stt.model, language: config.stt.language,
      endpointing: String(config.stt.endpointing), utterance_end_ms: String(config.stt.utteranceEndMs)
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (const term of config.stt.keyterms) url.searchParams.append('keyterm', term);
    this.socket = new WebSocket(url, {
      headers: { Authorization: `Token ${config.stt.apiKey}` },
      handshakeTimeout: config.stt.connectionTimeoutMs, maxPayload: 65536
    });
    this.connectTimer = setTimeout(() => this.fail('stt-connect-timeout'), config.stt.connectionTimeoutMs);
    this.socket.on('error', error => this.fail('stt-socket-error', error.message));
    this.socket.on('close', () => { if (!this.stopped) this.fail('stt-socket-closed'); });
    this.socket.on('open', () => {
      clearTimeout(this.connectTimer);
      for (const audio of this.pending) this.send(audio);
      this.pending = []; this.pendingBytes = 0;
      if (this.stopped) return;
      this.keepalive = setInterval(() => {
        if (this.socket.bufferedAmount + 20 > config.stt.maxBufferedBytes) { this.fail('stt-buffer-overflow'); return; }
        this.socket.send(JSON.stringify({ type: 'KeepAlive' }), error => { if (error) this.fail('stt-keepalive-failed'); });
      }, 4000);
    });
    this.socket.on('message', data => {
      if (this.stopped) return;
      try { this.result(JSON.parse(String(data)) as Result); } catch { this.fail('stt-bad-message'); }
    });
    // DTMF-PIN gate: audio and agent stay blocked until the caller enters the code
    if (config.inbound.pin?.enabled && config.inbound.pin?.code) {
      this.pinState = { digits: '', attempts: 0 };
      this.pinTimeout = setTimeout(() => {
        if (this.stopped || this.pinAuthenticated) return;
        this.respond(config.inbound.pin.lockoutText, false);
        setTimeout(() => this.session.end('pin-timeout'), 3000);
      }, config.inbound.pin.timeoutMs);
      if (config.inbound.pin.promptText) this.respond(config.inbound.pin.promptText, false);
    } else {
      this.pinAuthenticated = true;
      if (config.inbound.greeting) this.respond(config.inbound.greeting, false);
    }
  }

  /** Caller keypad input; drives the DTMF-PIN gate until authenticated. */
  dtmf(digit: string): void {
    if (this.stopped || this.pinAuthenticated) return;
    const pin = this.config.inbound.pin;
    if (!pin?.enabled || !pin.code) return;
    if (digit === '#') {
      if ((this.pinState?.digits ?? '') === pin.code) {
        clearTimeout(this.pinTimeout);
        this.pinState = null;
        this.pinAuthenticated = true;
        this.log?.('pin-accepted');
        // One utterance: a second respond() would abort the first sentence.
        const afterPin = [pin.successText, this.config.inbound.greeting].filter(Boolean).join(' ').trim();
        if (afterPin) this.respond(afterPin, false);
        return;
      }
      const attempts = (this.pinState?.attempts ?? 0) + 1;
      if (attempts >= pin.maxAttempts) {
        clearTimeout(this.pinTimeout);
        this.log?.('pin-lockout', { attempts });
        this.respond(pin.lockoutText, false);
        setTimeout(() => this.session.end('pin-failed'), 3000);
        return;
      }
      this.pinState = { digits: '', attempts };
      this.log?.('pin-rejected', { attempts });
      this.respond(pin.failureText, false);
      return;
    }
    if (digit === '*') {
      if (this.pinState) this.pinState.digits = '';
      return;
    }
    if (!/^\d$/.test(digit)) return;
    if (!this.pinState) this.pinState = { digits: '', attempts: 0 };
    if (this.pinState.digits.length >= pin.maxDigits) return;
    this.pinState.digits += digit;
    if (this.pinState.digits.length === pin.maxDigits) this.dtmf('#');
  }

  audio(audio: Uint8Array): void {
    if (this.stopped) return;
    if (!this.pinAuthenticated) return;
    const input = this.session.media.codec === 'pcmu' ? audio : this.session.media.decode(audio);
    if (this.socket.readyState === WebSocket.OPEN) { this.send(input); return; }
    if (this.pendingBytes + input.length > this.config.voice.maxInboundBytes) { this.fail('stt-pending-overflow'); return; }
    this.pending.push(Buffer.from(input)); this.pendingBytes += input.length;
  }

  private send(audio: Uint8Array): void {
    if (this.stopped) return;
    if (this.socket.bufferedAmount + audio.length > this.config.stt.maxBufferedBytes) { this.fail('stt-buffer-overflow'); return; }
    this.socket.send(audio, { binary: true }, error => { if (error) this.fail('stt-send-failed'); });
  }

  private result(event: Result): void {
    if (event.type === 'Error') { this.fail('stt-error-event'); return; }
    if (event.type === 'SpeechStarted') { this.log?.('stt-speech-start'); return; }
    if (event.type === 'UtteranceEnd') {
      if (typeof event.last_word_end === 'number' && event.last_word_end > this.emittedEnd) this.finish(event.last_word_end);
      return;
    }
    if (event.type !== 'Results') return;
    const alternative = event.channel?.alternatives?.[0];
    const text = alternative?.transcript?.trim() ?? '';
    if (text) {
      this.log?.('voice-barge-in', { source: 'transcript', final: event.is_final === true });
      this.bargeIn();
    }
    if (event.is_final && typeof event.start === 'number' && typeof event.duration === 'number') {
      const end = event.start + event.duration;
      if (end > this.lastFinalEnd) {
        this.lastFinalEnd = end;
        if (text) this.finalText += (this.finalText ? ' ' : '') + text;
        if (this.finalText.length > 4096) { this.fail('stt-text-limit'); return; }
      }
    }
    if (event.speech_final) this.finish(this.lastFinalEnd);
  }

  private finish(end: number): void {
    if (!this.finalText) return;
    const text = this.thinking ? `${this.thinking} ${this.finalText}` : this.finalText;
    this.finalText = ''; this.emittedEnd = Math.max(this.emittedEnd, end);
    this.respond(text, true);
  }

  /** Caller speech stops playback; a pending agent turn survives until a new utterance supersedes it. */
  private bargeIn(): void {
    if (this.thinking) { this.session.interrupt(); return; }
    this.interrupt();
  }

  private interrupt(): void {
    this.thinking = '';
    this.generation++; this.controller?.abort(); this.controller = undefined;
    this.session.interrupt();
  }
  private respond(text: string, agent: boolean): void {
    this.interrupt();
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    const current = (): boolean => !this.stopped && !controller.signal.aborted && generation === this.generation;
    void (async () => {
      try {
        if (agent) this.thinking = text;
        const answer = agent ? await this.utterance?.(text, controller.signal, this.session) : text;
        if (current()) this.thinking = '';
        if (!current() || !answer) return;
        if (answer.length > MAX_VOICE_REPLY_CHARS) throw new Error('Answer limit');
        const sentences = splitSentences(answer);
        for (let i = 0; i < sentences.length; i++) {
          if (!current()) return;
          const started = Date.now();
          this.log?.('tts-start', { chars: sentences[i]!.length, sentence: i });
          await this.speak(sentences[i]!, controller.signal, current);
          this.log?.('tts-end', { ms: Date.now() - started, sentence: i, interrupted: !current() });
          if (current()) await this.session.markAsync(`voice-${generation}-${i}`, controller.signal);
        }
      } catch (error) {
        if (current()) {
          this.session.interrupt();
          this.log?.('voice-turn-error', { message: error instanceof Error ? error.message : String(error) });
        }
      } finally { if (this.controller === controller) { this.controller = undefined; this.thinking = ''; } }
    })();
  }

  private async speak(text: string, parent: AbortSignal, current: () => boolean): Promise<void> {
    return speakAnnouncement(this.session, this.config, text, parent, current, this.dependencies);
  }

  private fail(reason: string, detail?: string): void {
    if (!this.stopped) { this.log?.('voice-error', { reason, ...(detail ? { detail } : {}) }); this.stop(); this.session.end('voice-error'); }
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pinTimeout) clearTimeout(this.pinTimeout);
    this.interrupt();
    clearTimeout(this.connectTimer); if (this.keepalive) clearInterval(this.keepalive);
    this.pending = []; this.pendingBytes = 0; this.finalText = '';
    this.socket.terminate();
  }
}

export async function speakAnnouncement(session: CallSession, config: SipPluginConfig,
  text: string, parent: AbortSignal, current: () => boolean,
  dependencies: VoiceDependencies = {}): Promise<void> {
  session.setPlaybackPrebuffer(config.voice.playbackPrebufferMs);
  const tts = config.tts;
  if (tts.provider === 'elevenlabs') throw new Error('Native ElevenLabs TTS is disabled; use Deepgram Voice Agent');
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) controller.abort();
  const timer = setTimeout(abort, tts.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const deepgram = tts.provider === 'deepgram';
    const rawMulaw = deepgram && session.media.codec === 'pcmu';
    if (!tts.baseUrl && !dependencies.speakUrl) throw new Error('TTS base URL is required');
    const baseUrl = tts.baseUrl?.replace(/\/$/, '');
    const url = new URL(dependencies.speakUrl ?? (deepgram
      ? `${baseUrl}/v1/speak`
      : `${baseUrl}/v1/audio/speech`));
    if (deepgram) for (const [key, value] of Object.entries({
      model: tts.voice ?? tts.model!,
      encoding: rawMulaw ? 'mulaw' : 'linear16', sample_rate: String(session.media.sampleRate), container: 'none'
    })) url.searchParams.set(key, value);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers.Authorization = `${deepgram ? 'Token' : 'Bearer'} ${tts.apiKey}`;
    const response = await (dependencies.fetch ?? fetch)(url, {
      method: 'POST', headers,
      body: JSON.stringify(deepgram ? { text } : { model: tts.model, voice: tts.voice, input: text, response_format: 'pcm' }),
      signal: controller.signal, redirect: 'error'
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('TTS request failed'); }
    const contentType = response.headers.get('content-type') ?? '';
    if (deepgram && !(rawMulaw ? /^audio\/mulaw(?:;|$)/i : /^audio\/(?:l16|linear16|pcm)(?:;|$)/i).test(contentType)) {
      await response.body.cancel(); throw new Error('Unexpected TTS format');
    }
    if (!deepgram && !/^(application\/octet-stream|audio\/pcm)(?:;|$)/i.test(contentType)) {
      await response.body.cancel(); throw new Error('Unexpected PCM format');
    }
    if (!deepgram && tts.sourceSampleRate !== 24000) throw new Error('Unverified PCM sample rate');
    reader = response.body.getReader();
    let remainder = Buffer.alloc(0);
    let total = 0;
    while (current()) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!current() || controller.signal.aborted) return;
      total += value.length;
      const sourceBytesPerSecond = rawMulaw ? 8000 : (!deepgram ? 24000 : session.media.sampleRate) * 2;
      if (total > sourceBytesPerSecond * 120) throw new Error('TTS response limit');
      const data = Buffer.concat([remainder, value]);
      const pcm24k = !deepgram;
      const alignment = pcm24k ? 6 : session.media.codec === 'g722' && !rawMulaw ? 4 : rawMulaw ? 1 : 2;
      const length = data.length - data.length % alignment;
      if (length) {
        const chunk = data.subarray(0, length);
        await session.sendAudioChunkAsync(rawMulaw ? chunk : session.media.encode(pcm24k
          ? pcm24kToPcm(chunk, session.media.sampleRate) : chunk), controller.signal);
      }
      remainder = Buffer.from(data.subarray(length));
    }
    if (remainder.length) throw new Error('Incomplete PCM audio');
    if (controller.signal.aborted) throw new Error('TTS timeout');
    if (!total) throw new Error('Empty TTS audio');
  } finally {
    clearTimeout(timer); parent.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => undefined);
  }
}

interface Result {
  type?: string; is_final?: boolean; speech_final?: boolean; start?: number; duration?: number; last_word_end?: number;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}
