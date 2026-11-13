/**
 * Independent SIP telephony channel plugin for OpenClaw.
 *
 * Design: the plugin owns telephony, the agent side only sees call sessions.
 *   SIP trunk (sipgate, ...) -> SIP UAS + RTP (embedded, vendor/sip-bridge)
 *                            -> 8 kHz mu-law frames over WebSocket (Twilio
 *                               Media Streams wire format)
 *                            -> CallSession -> STT -> OpenClaw turn -> TTS
 *
 * No dependency on Twilio, LiveKit or the voice-call plugin: any SIP trunk and
 * any Twilio-Media-Streams-capable gateway can attach.
 */
import { parseSipConfig, validateForTransport, type SipPluginConfig } from './config.js';
import { CallSession } from './media/callSession.js';
import { MediaServer } from './media/mediaServer.js';
import { cleanupAll, startEmbeddedTransport } from './embedded/embeddedTransport.js';
import { DeepgramAgentCall, type DeepgramAgentDependencies, type VoiceEngine } from './voice/deepgramAgent.js';
import { VoiceCall, type VoiceDependencies, type UtteranceHook } from './voice/voiceCall.js';

export { discoverDeepgramModels, registerDeepgramModelDiscovery } from './voice/deepgramModels.js';
export type {
  DeepgramModel, DeepgramSttModel, DeepgramModelCatalog, DeepgramModelOptions,
  DeepgramModelDependencies, DeepgramModelGatewayApi
} from './voice/deepgramModels.js';

export interface SipPluginHooks {
  /** A call was answered; `custom` carries gateway parameters (caller, dialed number). */
  onCall?: (session: CallSession, custom: Record<string, string>) => void | Promise<void>;
  /** 20 ms of inbound mu-law audio from the caller. */
  onAudio?: (session: CallSession, audio: Uint8Array) => void;
  /** Keypad input (RFC 4733), e.g. IVR selection. */
  onDtmf?: (session: CallSession, digit: string) => void;
  /** Diagnostics only; never receives secrets. */
  onLog?: (message: string, fields?: Record<string, unknown>) => void;
  onUtterance?: UtteranceHook;
  onMark?: (session: CallSession, name: string) => void;
  onEnd?: (streamSid: string, reason: string) => void;
  admitCall?: (session: CallSession, custom: Record<string, string>) => boolean;
}

export interface SipPluginHandle {
  readonly server: MediaServer;
  readonly config: SipPluginConfig;
  stop: () => Promise<void>;
  hangup: (session: CallSession, reason: string) => void;
}

/**
 * Start the media path. `transport: "bridge"` only binds the WebSocket and
 * waits for a gateway; `transport: "embedded"` additionally registers the
 * vendored SIP UAS and streams RTP through the local media endpoint.
 */
export async function startSipPlugin(
  rawConfig: unknown,
  hooks: SipPluginHooks = {},
  dependencies: { startEmbeddedTransport?: typeof startEmbeddedTransport; voice?: VoiceDependencies; agent?: DeepgramAgentDependencies } = {},
): Promise<SipPluginHandle> {
  const config = parseSipConfig(rawConfig);
  const problems = validateForTransport(config);
  if (problems.length > 0) {
    throw new Error(`sip plugin config rejected: ${problems.join('; ')}`);
  }

  const server = new MediaServer({
    host: config.media.host,
    port: config.media.port,
    path: config.media.path,
    onLog: hooks.onLog,
  });

  let embedded: Awaited<ReturnType<typeof startEmbeddedTransport>> | undefined;
  const sessions = new Map<string, CallSession>();
  const voices = new Map<string, VoiceEngine>();
  server.on('call', (session, custom) => {
    sessions.set(session.streamSid, session);
    if (hooks.admitCall && !hooks.admitCall(session, custom)) return;
    if (config.voice.enabled) {
      if (voices.size >= config.inbound.maxConcurrent) { session.end('voice-call-limit'); return; }
      const log = (event: string, fields?: Record<string, unknown>): void => hooks.onLog?.(event, fields);
      voices.set(session.streamSid, config.voice.engine === 'deepgram-agent'
        ? new DeepgramAgentCall(session, config, log, dependencies.agent, hooks.onUtterance)
        : new VoiceCall(session, config, hooks.onUtterance, log, dependencies.voice));
    }
    void Promise.resolve().then(() => hooks.onCall?.(session, custom)).catch(() => hooks.onLog?.('call-hook-error'));
  });
  server.on('audio', (session, audio) => {
    voices.get(session.streamSid)?.audio(audio);
    hooks.onAudio?.(session, audio);
  });
  server.on('dtmf', (session, digit) => {
    voices.get(session.streamSid)?.dtmf?.(digit);
    hooks.onDtmf?.(session, digit);
  });
  server.on('mark', (session, name) => hooks.onMark?.(session, name));
  server.on('end', (streamSid, reason) => {
    const session = sessions.get(streamSid); sessions.delete(streamSid);
  hooks.onLog?.('call-end', { reason });
    if (session?.callSid) embedded?.terminateCall?.(session.callSid, reason);
    voices.get(streamSid)?.stop(); voices.delete(streamSid);
    hooks.onEnd?.(streamSid, reason);
  });
  server.on('error', (err) => hooks.onLog?.('media-error', { message: err.message }));

  await server.start();
  try {
    if (config.transport === 'embedded') {
      if (!server.address) throw new Error('Media server has no bound address');
      embedded = await (dependencies.startEmbeddedTransport ?? startEmbeddedTransport)(config, server.address, hooks.onLog);
    }
    hooks.onLog?.('sip-plugin-started', { port: server.address?.port, path: config.media.path, transport: config.transport });
  } catch (error) {
    try { await cleanupAll([() => embedded?.stop(), () => server.stop()]); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Plugin startup and cleanup failed'); }
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return {
    server,
    config,
    hangup: (session, reason) => {
      if (session.callSid) embedded?.terminateCall?.(session.callSid, reason);
      session.end(reason);
    },
    stop: () => stopping ??= cleanupAll([() => embedded?.stop(), () => server.stop()]),
  };
}

/**
 * Echo mode: no STT/LLM/TTS. Returns the caller's own audio so the SIP trunk,
 * RTP path, jitter and barge-in can be proven before any model is involved.
 */
export function echoHooks(log?: SipPluginHooks['onLog']): SipPluginHooks {
  return {
    onAudio: (session, audio) => session.sendAudio(audio),
    onDtmf: (_session, digit) => log?.('echo-dtmf', { digit }),
    onLog: log,
  };
}

export { parseSipConfig, validateForTransport } from './config.js';
export type { SipPluginConfig } from './config.js';
export { CallSession, CallRegistry } from './media/callSession.js';
export { MediaServer } from './media/mediaServer.js';

/** Manifest-facing plugin descriptor; the SDK entry is wired in a later phase. */
export const pluginDescriptor = {
  id: 'sip',
  name: 'SIP Telephony',
  channel: { id: 'sip', label: 'SIP Telephony' },
} as const;
