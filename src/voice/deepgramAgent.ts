import WebSocket from 'ws';
import type { CallSession } from '../media/callSession.js';
import type { SipPluginConfig } from '../config.js';
import type { UtteranceHook } from './voiceCall.js';
import { speakAnnouncement } from './voiceCall.js';

export type AgentLog = (event: string, fields?: Record<string, unknown>) => void;

export interface DeepgramAgentDependencies {
  agentUrl?: string;
}

interface FunctionCall { id?: string; name?: string; arguments?: string; client_side?: boolean }

/** Common surface of both voice engines, used by src/index.ts. */
export interface VoiceEngine {
  audio(audio: Uint8Array): void;
  /** Optional keypad input; only engines with a DTMF gate implement it. */
  dtmf?(digit: string): void;
  stop(): void;
}

export const OPENCLAW_TASK = {
  name: 'openclaw_task',
  description: 'Run a task with the OpenClaw agent tools (lookups, research, actions) and return the result as a short spoken sentence.',
  parameters: {
    type: 'object',
    properties: { request: { type: 'string', description: 'The caller\'s request as a complete sentence.' } },
    required: ['request'],
  },
};

const CONNECT_TIMEOUT_MS = 10000;
const KEEPALIVE_MS = 4000;

/** Pure so tests can assert the exact Settings payload. */
export function buildSettings(config: SipPluginConfig, codec: string, sampleRate: number): Record<string, unknown> {
  const agent = config.voice.agent;
  const encoding = codec === 'pcmu' ? 'mulaw' : 'linear16';
  const think: Record<string, unknown> = {
    provider: {
      type: agent.think.provider, model: agent.think.model,
      ...(agent.think.temperature !== undefined ? { temperature: agent.think.temperature } : {}),
    },
    prompt: agent.prompt,
    ...(agent.tools ? { functions: [OPENCLAW_TASK] } : {}),
  };
  if (agent.think.endpoint) think.endpoint = { url: agent.think.endpoint.url, headers: agent.think.endpoint.headers };
  const greeting = agent.greeting ?? config.inbound.greeting;
  return {
    type: 'Settings',
    audio: {
      input: { encoding, sample_rate: sampleRate },
      output: { encoding, sample_rate: sampleRate, container: 'none' },
    },
    agent: {
      listen: {
        provider: {
          type: 'deepgram', model: config.stt.model, language: config.stt.language,
          ...(config.stt.keyterms.length ? { keyterms: config.stt.keyterms } : {}),
        },
      },
      think,
      speak: config.tts.provider === 'elevenlabs' ? {
        provider: { type: 'eleven_labs', model_id: config.tts.model },
        endpoint: {
          url: config.tts.model === 'eleven_v3'
            ? `${config.tts.baseUrl!.replace(/\/$/, '')}/v1/text-to-speech/${encodeURIComponent(config.tts.voice!)}`
            : `${config.tts.baseUrl!.replace(/^https:/, 'wss:').replace(/\/$/, '')}/v1/text-to-speech/${encodeURIComponent(config.tts.voice!)}/multi-stream-input`,
          headers: { 'xi-api-key': config.tts.apiKey },
        },
      } : { provider: { type: 'deepgram', model: config.tts.voice ?? config.tts.model } },
      ...(greeting ? { greeting } : {}),
    },
  };
}

/**
 * Deepgram Voice Agent bridge: caller mu-law goes up, agent mu-law comes back.
 * PCMU passes through untouched; other codecs run as linear16 and are transcoded by CallCodec.
 */
export class DeepgramAgentCall implements VoiceEngine {
  private readonly socket: WebSocket;
  private readonly connectTimer: NodeJS.Timeout;
  private keepalive: NodeJS.Timeout | undefined;
  private ready = false;
  private stopped = false;
  private playing = true;
  private turn = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private remainder = Buffer.alloc(0);
  private readonly tasks = new AbortController();

  // DTMF PIN gate (same semantics as VoiceCall)
  private pinAuthenticated = false;
  private pinLocked = false;
  private pinHangup?: NodeJS.Timeout;
  private pinState: { digits: string; attempts: number } | null = null;
  private pinTimeout: NodeJS.Timeout | undefined;

  constructor(private session: CallSession, private config: SipPluginConfig,
    private log?: AgentLog, dependencies: DeepgramAgentDependencies = {},
    private utterance?: UtteranceHook) {
    session.setQueueLimit(config.voice.maxOutboundBytes);
    session.setPlaybackPrebuffer(config.voice.playbackPrebufferMs);
    const url = new URL(dependencies.agentUrl ??
      `${config.voice.agent.baseUrl.replace(/\/$/, '')}/v1/agent/converse`);
    this.socket = new WebSocket(url, {
      headers: { Authorization: `Token ${config.stt.apiKey}` },
      handshakeTimeout: CONNECT_TIMEOUT_MS, maxPayload: 1048576,
    });
    this.connectTimer = setTimeout(() => this.fail('agent-connect-timeout'), CONNECT_TIMEOUT_MS);
    this.socket.on('error', error => this.fail('agent-socket-error', error.message));
    this.socket.on('close', () => { if (!this.stopped) this.fail('agent-socket-closed'); });
    this.socket.on('open', () => clearTimeout(this.connectTimer));
    this.socket.on('message', (data, isBinary) => this.message(data, isBinary));
    this.log?.('agent-connecting', { model: config.voice.agent.think.model, provider: config.voice.agent.think.provider });

    // DTMF PIN gate: block caller audio until the code is confirmed.
    const pin = config.inbound.pin;
    if (pin.enabled && pin.code) {
      this.pinState = { digits: '', attempts: 0 };
      this.pinTimeout = setTimeout(() => {
        if (this.stopped || this.pinLocked || this.pinAuthenticated) return;
        this.pinLocked = true;
        this.speak(pin.lockoutText);
        this.pinHangup = setTimeout(() => this.session.end('pin-timeout'), 3000);
      }, pin.timeoutMs);
      if (pin.promptText) this.speak(pin.promptText);
    } else {
      this.pinAuthenticated = true;
    }
  }

  /** Caller keypad input; drives the DTMF PIN gate until authenticated. */
  dtmf(digit: string): void {
    if (this.stopped || this.pinLocked || this.pinAuthenticated) return;
    const pin = this.config.inbound.pin;
    if (!pin.enabled || !pin.code) return;
    if (digit === '#') {
      if ((this.pinState?.digits ?? '') === pin.code) {
        clearTimeout(this.pinTimeout);
        this.pinState = null;
        this.pinAuthenticated = true;
        this.log?.('pin-accepted');
        return;
      }
      const attempts = (this.pinState?.attempts ?? 0) + 1;
      if (attempts >= pin.maxAttempts) {
        clearTimeout(this.pinTimeout);
        this.pinState = { digits: '', attempts };
        this.pinLocked = true;
        this.log?.('pin-lockout', { attempts });
        this.speak(pin.lockoutText);
        this.pinHangup = setTimeout(() => this.session.end('pin-failed'), 3000);
        return;
      }
      this.pinState = { digits: '', attempts };
      this.log?.('pin-rejected', { attempts });
      this.speak(pin.failureText);
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

  /** Speak a short local prompt (PIN gate) without going through the agent turn. */
  private speak(text: string): void {
    if (this.stopped || !text) return;
    void (async () => {
      try {
        await speakAnnouncement(this.session, this.config, text,
          this.tasks.signal, () => !this.stopped);
      } catch (error) {
        this.log?.('agent-announcement-error', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  audio(audio: Uint8Array): void {
    if (this.stopped) return;
    if (this.pinLocked || !this.pinAuthenticated) return;
    const input = this.session.media.codec === 'pcmu' ? audio : this.session.media.decode(audio);
    if (this.ready && this.socket.readyState === WebSocket.OPEN) { this.send(input); return; }
    if (this.pendingBytes + input.length > this.config.voice.maxInboundBytes) { this.fail('agent-pending-overflow'); return; }
    this.pending.push(Buffer.from(input)); this.pendingBytes += input.length;
  }

  private send(audio: Uint8Array): void {
    if (this.stopped || this.pinLocked || !this.pinAuthenticated) return;
    if (this.socket.bufferedAmount + audio.length > this.config.voice.maxInboundBytes) { this.fail('agent-buffer-overflow'); return; }
    this.socket.send(audio, { binary: true }, error => { if (error) this.fail('agent-send-failed'); });
  }

  private message(data: WebSocket.RawData, isBinary: boolean): void {
    if (this.stopped || this.pinLocked) return;
    if (isBinary) {
      if (!this.pinAuthenticated || !this.playing) return;
      try { this.play(Buffer.from(data as Buffer)); } catch { this.fail('agent-playback-overflow'); }
      return;
    }
    let event: { type?: string; description?: string; code?: string; role?: string; content?: string; functions?: FunctionCall[] };
    try { event = JSON.parse(String(data)); } catch { this.fail('agent-bad-message'); return; }
    switch (event.type) {
      case 'Welcome':
        this.socket.send(JSON.stringify(buildSettings(this.config, this.session.media.codec, this.session.media.sampleRate)),
          error => { if (error) this.fail('agent-settings-failed'); });
        break;
      case 'SettingsApplied':
        this.ready = true;
        for (const chunk of this.pending) this.send(chunk);
        this.pending = []; this.pendingBytes = 0;
        this.keepalive = setInterval(() => {
          if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'KeepAlive' }));
        }, KEEPALIVE_MS);
        this.log?.('agent-ready');
        break;
      case 'UserStartedSpeaking':
        this.log?.('user-speaking');
        this.playing = false; this.remainder = Buffer.alloc(0); this.session.interrupt();
        break;
      case 'AgentStartedSpeaking':
        this.playing = true; this.log?.('tts-start', { turn: this.turn });
        break;
      case 'AgentAudioDone':
        this.playing = true; this.remainder = Buffer.alloc(0);
        try { this.session.mark(`agent-${this.turn++}`); } catch { this.fail('agent-mark-overflow'); }
        this.log?.('tts-end', { turn: this.turn - 1 });
        break;
      case 'FunctionCallRequest':
        for (const call of event.functions ?? []) void this.callFunction(call);
        break;
      case 'Error':
        this.fail('agent-error-event', event.code ?? event.description);
        break;
      case 'ConversationText':
        if (event.role === 'assistant') {
          this.playing = true;
          this.log?.('tts-start', { turn: this.turn });
        }
        this.log?.('agent-text', { role: event.role, content: (event.content ?? '').slice(0, 200) });
        break;
      case 'AgentThinking':
        this.log?.('agent-thinking');
        break;
      case 'Warning': case 'InjectionRefused':
        this.log?.('agent-warning', { type: event.type, description: event.description });
        break;
    }
  }

  private async callFunction(call: FunctionCall): Promise<void> {
    if (this.stopped || this.pinLocked || !this.pinAuthenticated) return;
    if (call.client_side === false) return;
    let content: string;
    const started = Date.now();
    try {
      if (call.name !== OPENCLAW_TASK.name || !this.config.voice.agent.tools || !this.utterance) throw new Error('unknown function');
      const request = String((JSON.parse(call.arguments ?? '{}') as { request?: unknown }).request ?? '').trim();
      if (!request) throw new Error('empty request');
      content = (await this.utterance(request, this.tasks.signal, this.session)).slice(0, 4096) || 'No answer.';
      this.log?.('agent-function', { name: call.name, ms: Date.now() - started, chars: content.length, preview: content.slice(0, 160) });
    } catch (error) {
      content = 'The task could not be completed.';
      this.log?.('agent-function-error', { name: call.name, message: error instanceof Error ? error.message : String(error) });
    }
    if (this.stopped || this.pinLocked || !this.pinAuthenticated || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'FunctionCallResponse', id: call.id, name: call.name, content }));
  }

  private play(chunk: Buffer): void {
    if (this.session.media.codec === 'pcmu') { this.session.sendAudioChunk(chunk); return; }
    const data = Buffer.concat([this.remainder, chunk]);
    const alignment = this.session.media.codec === 'g722' ? 4 : 2;
    const length = data.length - data.length % alignment;
    if (length) this.session.sendAudioChunk(this.session.media.encode(data.subarray(0, length)));
    this.remainder = Buffer.from(data.subarray(length));
  }

  private fail(reason: string, detail?: string): void {
    if (this.stopped) return;
    this.log?.('voice-error', { reason, ...(detail ? { detail } : {}) });
    this.stop(); this.session.end('voice-error');
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.tasks.abort();
    if (this.pinTimeout) clearTimeout(this.pinTimeout);
    if (this.pinHangup) clearTimeout(this.pinHangup);
    clearTimeout(this.connectTimer); if (this.keepalive) clearInterval(this.keepalive);
    this.pending = []; this.pendingBytes = 0;
    this.socket.terminate();
  }
}
