import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSession } from '../src/media/callSession.js';
import { parseSipConfig } from '../src/config.js';

// No sockets or HTTP requests leave this test: exercise the public callbacks with
// a controllable peer and real prompt streaming against a mocked fetch.
const peers = vi.hoisted(() => [] as any[]);
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class Socket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    send = vi.fn();
    terminate = vi.fn();
    constructor(..._args: unknown[]) { super(); peers.push(this); }
  }
  return { default: Socket };
});
import { DeepgramAgentCall } from '../src/voice/deepgramAgent.js';
import { VoiceCall } from '../src/voice/voiceCall.js';

const active: Array<{ stop(): void }> = [];
beforeEach(() => {
  vi.useFakeTimers();
  peers.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x81, 0x82]), {
    headers: { 'content-type': 'audio/mulaw' },
  })));
});
afterEach(() => {
  for (const call of active.splice(0)) call.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup(engine: 'openclaw' | 'deepgram-agent') {
  const config = parseSipConfig({
    inbound: { greeting: '', pin: {
      enabled: true, code: '4321', maxDigits: 8, maxAttempts: 2, timeoutMs: 3000,
      promptText: 'Enter PIN.', successText: '', failureText: 'Wrong.', lockoutText: 'Locked.',
    } },
    stt: { apiKey: 'test' }, tts: { apiKey: 'test' },
    voice: { enabled: true, engine, agent: {
      tools: true, prompt: 'Test', think: { provider: 'open_ai', model: 'test' },
    } },
  });
  const session = {
    media: { codec: 'pcmu', sampleRate: 8000, decode: vi.fn(), encode: vi.fn() },
    setQueueLimit: vi.fn(), setPlaybackPrebuffer: vi.fn(),
    sendAudioChunk: vi.fn(), sendAudioChunkAsync: vi.fn(async () => {}),
    mark: vi.fn(), markAsync: vi.fn(async () => {}), interrupt: vi.fn(), end: vi.fn(),
  };
  const hook = vi.fn(async () => 'Allowed.');
  const log = vi.fn();
  const typedSession = session as unknown as CallSession;
  const call = engine === 'openclaw'
    ? new VoiceCall(typedSession, config, hook, log)
    : new DeepgramAgentCall(typedSession, config, log, {}, hook);
  active.push(call);
  const peer = peers.at(-1)!;
  const event = (value: unknown) => peer.emit('message', Buffer.from(JSON.stringify(value)), false);
  peer.emit('open');
  if (engine === 'deepgram-agent') { event({ type: 'Welcome' }); event({ type: 'SettingsApplied' }); }
  const digits = (text: string) => { for (const digit of text) call.dtmf(digit); };
  const dispatch = () => {
    call.audio(Buffer.from([1, 2]));
    // Attempt both a normal agent turn and a tool request; neither peer is trusted.
    event({ type: 'Results', is_final: true, speech_final: true, start: 0, duration: 1,
      channel: { alternatives: [{ transcript: 'Do a privileged task' }] } });
    event({ type: 'FunctionCallRequest', functions: [{ id: 'f', name: 'openclaw_task',
      arguments: JSON.stringify({ request: 'Do a privileged task' }) }] });
    if (engine === 'deepgram-agent') peer.emit('message', Buffer.from([0x91, 0x92]), true);
  };
  return { call, peer, session, hook, log, digits, dispatch };
}

for (const engine of ['openclaw', 'deepgram-agent'] as const) {
  describe(`${engine} terminal PIN security`, () => {
    for (const terminal of ['timeout', 'max-attempts'] as const) {
      for (const attack of ['4321#', '0000#', '*4321#0000#4321#']) {
        it(`${terminal} ignores ${JSON.stringify(attack)} throughout the hangup window`, async () => {
          const f = setup(engine);
          f.dispatch();
          expect(f.hook).not.toHaveBeenCalled();
          expect(f.session.sendAudioChunk).not.toHaveBeenCalled();
          if (terminal === 'timeout') {
            // Leave a correct code pending when the timeout fires. A late # must fail.
            f.digits('4321');
            vi.advanceTimersByTime(3000);
          } else {
            f.digits('0000#0000#');
          }
          // Lock must already be effective synchronously, before prompt I/O settles.
          const promptRequests = vi.mocked(fetch).mock.calls.length;
          f.digits('#' + attack);
          f.dispatch();
          expect(f.log.mock.calls.filter(([event]) => event === 'pin-accepted')).toHaveLength(0);
          expect(vi.mocked(fetch).mock.calls).toHaveLength(promptRequests);
          await vi.advanceTimersByTimeAsync(2999);
          f.digits(attack);
          f.dispatch();
          expect(f.hook).not.toHaveBeenCalled();
          expect(f.peer.send.mock.calls.filter((args: unknown[]) => args[1] && typeof args[1] === 'object' && 'binary' in args[1])).toHaveLength(0);
          expect(f.peer.send.mock.calls.filter(([payload]: [unknown]) => String(payload).includes('FunctionCallResponse'))).toHaveLength(0);
          expect(f.session.sendAudioChunk).not.toHaveBeenCalled();
          // Only the local failure/lockout announcement may produce playback.
          expect(f.session.sendAudioChunkAsync.mock.calls.length).toBeGreaterThan(0);
          expect(f.session.end).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1);
          expect(f.session.end).toHaveBeenCalledExactlyOnceWith(terminal === 'timeout' ? 'pin-timeout' : 'pin-failed');
        });
      }
      it(`stop cancels ${terminal} hangup and pending playback`, async () => {
        const f = setup(engine);
        if (terminal === 'timeout') vi.advanceTimersByTime(3000);
        else f.digits('0000#0000#');
        f.call.stop();
        f.call.stop();
        f.digits('4321#');
        f.dispatch();
        await vi.advanceTimersByTimeAsync(10000);
        expect(f.session.end).not.toHaveBeenCalled();
        expect(f.hook).not.toHaveBeenCalled();
        expect(f.session.sendAudioChunk).not.toHaveBeenCalled();
        expect(f.session.sendAudioChunkAsync).not.toHaveBeenCalled();
        expect(f.peer.terminate).toHaveBeenCalledTimes(1);
      });
    }
    it('accepts a normal PIN after a nonterminal failure and enables audio and agent/tools', async () => {
      const f = setup(engine);
      f.digits('0000#');
      f.dispatch();
      expect(f.hook).not.toHaveBeenCalled();
      f.digits('4321#');
      f.dispatch();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.log.mock.calls.filter(([event]) => event === 'pin-accepted')).toHaveLength(1);
      expect(f.hook).toHaveBeenCalledTimes(1);
      expect(f.peer.send.mock.calls.some((args: unknown[]) => args[1] && typeof args[1] === 'object' && 'binary' in args[1])).toBe(true);
      if (engine === 'deepgram-agent') {
        expect(f.session.sendAudioChunk).toHaveBeenCalledTimes(1);
        expect(f.peer.send.mock.calls.some(([payload]: [unknown]) => String(payload).includes('FunctionCallResponse'))).toBe(true);
      } else expect(f.session.sendAudioChunkAsync).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(6000);
      expect(f.session.end).not.toHaveBeenCalled();
    });
  });
}
