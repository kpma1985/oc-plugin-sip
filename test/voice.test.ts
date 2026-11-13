import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { parseSipConfig, validateForTransport } from '../src/config.js';
import { CallSession } from '../src/media/callSession.js';
import { VoiceCall, pcm24kToMulaw, splitSentences } from '../src/voice/voiceCall.js';
import { startSipPlugin } from '../src/index.js';
import { mulawEncodeSample } from '../src/media/ulaw.js';
import { buildMediaFrame } from '../src/media/twilioFrames.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function wait(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
  expect(predicate()).toBe(true);
}
const errorsOnly = (log: ReturnType<typeof vi.fn>) => (event: string, fields?: Record<string, unknown>): void => { if (event === 'voice-error' || event === 'voice-turn-error') log(event, fields); };
async function fake() {
  let stt: WebSocket | undefined;
  let query = new URL('http://localhost');
  const audio: Buffer[] = [];
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(ws, 'listening');
  cleanup.push(() => new Promise<void>(resolve => { for (const s of ws.clients) s.terminate(); ws.close(() => resolve()); }));
  ws.on('connection', (s, req) => { stt = s; query = new URL(req.url!, 'http://localhost'); s.on('message', (b, binary) => { if (binary) audio.push(Buffer.from(b as Buffer)); }); });
  const requests: Array<{ url: URL; body: Record<string, unknown>; auth: string | undefined }> = [];
  let output: Buffer = Buffer.alloc(321, 0x81);
  let status = 200;
  let contentType = 'audio/mulaw;rate=8000';
  let hang = false;
  const http: Server = createServer((req, res) => {
    let body = ''; req.on('data', b => body += b);
    req.on('end', () => {
      requests.push({ url: new URL(req.url!, 'http://localhost'), body: JSON.parse(body), auth: req.headers.authorization });
      if (hang) return;
      res.writeHead(status, { 'Content-Type': contentType });
      res.write(output.subarray(0, 1));
      setTimeout(() => res.end(output.subarray(1)), 5);
    });
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  cleanup.push(() => new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => resolve()); }));
  const port = (http.address() as { port: number }).port;
  return {
    dependencies: { listenUrl: `ws://127.0.0.1:${(ws.address() as { port: number }).port}/v1/listen`, speakUrl: `http://127.0.0.1:${port}/v1/speak` },
    requests, audio, query: () => query, socket: () => stt,
    send: (event: unknown) => stt!.send(JSON.stringify(event)),
    output: (data: Buffer, type = contentType) => { output = data; contentType = type; },
    fail: () => status = 401, hang: () => hang = true
  };
}
function config(extra: Record<string, unknown> = {}) {
  return parseSipConfig({ transport: 'bridge', voice: { enabled: true }, stt: { apiKey: 'fake-stt', keyterms: ['Telefon'] }, tts: { apiKey: 'fake-tts' }, ...extra });
}
function final(text: string, start: number, speechFinal = true) {
  return { type: 'Results', is_final: true, speech_final: speechFinal, start, duration: 1, channel: { alternatives: [{ transcript: text }] } };
}
function session(codec: 'pcmu' | 'pcma' | 'g722' = 'pcmu') {
  const frames: Array<Record<string, any>> = [];
  const call = new CallSession({ streamSid: 'MZ1', codec, onSend: data => frames.push(JSON.parse(data)) }); call.activate();
  cleanup.push(() => call.end('test'));
  return { call, frames };
}

describe('sentence splitting', () => {
  it('bounds long sentences without losing words', () => {
    const text = 'Geschichte '.repeat(600).trim();
    const chunks = splitSentences(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 500)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
    expect(splitSentences('x'.repeat(1200)).map(chunk => chunk.length)).toEqual([500, 500, 200]);
  });
  it('keeps decimals whole and drops empty sentences', () => {
    expect(splitSentences('Es kostet 3.5 Euro. Danke!')).toEqual(['Es kostet 3.5 Euro.', 'Danke!']);
    expect(splitSentences('Hallo.\n')).toEqual(['Hallo.']);
    expect(splitSentences('Ohne Punkt')).toEqual(['Ohne Punkt']);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('voice config and ordered playback', () => {
  it('is opt-in, validates credentials and strictly rejects unknown keys', () => {
    const c = parseSipConfig({ transport: 'bridge' });
    expect(c.voice.enabled).toBe(false); expect(validateForTransport(c)).toEqual([]);
    expect(validateForTransport(parseSipConfig({ transport: 'bridge', voice: { enabled: true } }))).toHaveLength(2);
    expect(() => parseSipConfig({ stt: { typo: 1 } })).toThrow();
    expect(() => parseSipConfig({ tts: { baseUrl: 'http://localhost' } })).toThrow();
    expect(() => parseSipConfig({ stt: { utteranceEndMs: 999 } })).toThrow();
    expect(validateForTransport(config({ tts: { apiKey: 'fake', provider: 'custom' } })))
      .toEqual(['tts.baseUrl is required for custom', 'tts.model is required for custom', 'tts.voice is required for custom',
        'tts.sourceSampleRate must explicitly be 24000 for OpenAI-compatible PCM']);
  });
  it('aligns chunks, pads final frame, orders marks, drops both on interruption', () => {
    vi.useFakeTimers(); const { call, frames } = session();
    call.sendAudioChunk(Buffer.alloc(81, 1)); call.sendAudioChunk(Buffer.alloc(81, 2)); call.mark('sentence');
    expect(frames).toEqual([]); vi.advanceTimersByTime(60);
    expect(frames.map(f => f.event)).toEqual(['media', 'media', 'mark']);
    expect(Buffer.from(frames[1]!.media.payload, 'base64')).toHaveLength(160);
    call.sendAudio(Buffer.alloc(160)); call.mark('stale'); call.interrupt(); vi.advanceTimersByTime(100);
    expect(frames.map(f => f.event)).toEqual(['media', 'media', 'mark', 'clear']);
    call.end('done'); expect(call.queuedBytes).toBe(0);
  });
  it('bounds audio bytes and marks independently of call count', () => {
    const { call } = session(); call.setQueueLimit(160);
    call.sendAudio(Buffer.alloc(160)); expect(() => call.sendAudioChunk(Buffer.alloc(1))).toThrow('limit');
    expect(() => call.mark('overflow')).toThrow('limit'); call.interrupt(); expect(call.queuedBytes).toBe(0);
  });
  it('resamples 24k PCM before mu-law encoding', () => {
    const pcm = Buffer.alloc(960); for (let i = 0; i < 480; i++) pcm.writeInt16LE(3000, i * 2);
    const out = pcm24kToMulaw(pcm); expect(out).toHaveLength(160); expect(out[0]).toBe(mulawEncodeSample(3000));
    expect(() => pcm24kToMulaw(Buffer.alloc(5))).toThrow();
  });

  it.each(['abort', 'interrupt', 'end'])('cancels a backpressured producer on %s', async action => {
    const { call } = session(); call.setQueueLimit(160);
    call.sendAudioChunk(Buffer.alloc(160));
    const controller = new AbortController();
    const pending = call.sendAudioChunkAsync(Buffer.alloc(320), controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    if (action === 'abort') controller.abort();
    else if (action === 'interrupt') call.interrupt();
    else call.end('test');
    await rejected;
  });
});

describe('local STT / agent / TTS', () => {
  it('speaks an agent answer longer than the former 4096-character limit', async () => {
    const f = await fake(); f.output(Buffer.alloc(160));
    const { call, frames } = session(); const log = vi.fn();
    const answer = 'Geschichte '.repeat(500).trim();
    const chunks = splitSentences(answer);
    const voice = new VoiceCall(call, config(), () => answer, errorsOnly(log), f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Frage', 0));
    await wait(() => frames.filter(frame => frame.event === 'mark').length === chunks.length);
    expect(f.requests.map(request => request.body.text)).toEqual(chunks);
    expect(log).not.toHaveBeenCalled();
  });
  it.each(['pcma', 'g722'] as const)('streams %s through PCM STT and codec-encoded TTS', async codec => {
    const f = await fake(); const { call, frames } = session(codec);
    const pcm = Buffer.alloc(call.media.sampleRate / 50 * 2);
    f.output(pcm, `audio/l16;rate=${call.media.sampleRate}`);
    const voice = new VoiceCall(call, config({ inbound: { greeting: 'Hallo.' } }), undefined, undefined, f.dependencies);
    cleanup.push(() => voice.stop());
    await wait(() => !!f.socket());
    voice.audio(call.media.encode(pcm));
    await wait(() => f.audio.length > 0);
    expect(f.query().searchParams.get('encoding')).toBe('linear16');
    expect(f.query().searchParams.get('sample_rate')).toBe(String(call.media.sampleRate));
    expect(f.audio[0]).toHaveLength(pcm.length);
    await wait(() => frames.some(frame => frame.event === 'media'));
    const audio = frames.find(frame => frame.event === 'media')!;
    expect(Buffer.from(audio.media.payload, 'base64')).toHaveLength(160);
    expect(f.requests[0]?.url.searchParams.get('encoding')).toBe('linear16');
    expect(f.requests[0]?.url.searchParams.get('sample_rate')).toBe(String(call.media.sampleRate));
  });

  it('accumulates final segments, deduplicates end events and streams raw Aura', async () => {
    const f = await fake(); const { call, frames } = session(); const agent = vi.fn((_text: string) => 'Antwort.');
    const voice = new VoiceCall(call, config(), agent, undefined, f.dependencies); cleanup.push(() => voice.stop());
    voice.audio(Buffer.alloc(160, 0xff)); await wait(() => !!f.socket()); await wait(() => f.audio.length === 1);
    expect(f.query().searchParams.get('encoding')).toBe('mulaw'); expect(f.query().searchParams.get('sample_rate')).toBe('8000');
    expect(f.query().searchParams.getAll('keyterm')).toEqual(['Telefon']);
    f.send(final('Hallo', 0, false)); f.send(final('Welt', 1)); f.send(final('Welt', 1));
    f.send({ type: 'UtteranceEnd', last_word_end: 2 }); f.send({ type: 'UtteranceEnd', last_word_end: -1 });
    await wait(() => frames.some(x => x.event === 'mark'));
    expect(agent).toHaveBeenCalledTimes(1); expect(agent.mock.calls[0]?.[0]).toBe('Hallo Welt');
    const r = f.requests[0]!; expect(r.url.searchParams.get('container')).toBe('none'); expect(r.url.searchParams.get('sample_rate')).toBe('8000');
    expect(r.body).toEqual({ text: 'Antwort.' }); expect(r.auth).toBe('Token fake-tts');
    expect(frames.filter(x => x.event === 'media')).toHaveLength(3);
    expect(frames.at(-1)?.event).toBe('mark'); voice.stop(); await wait(() => f.socket()?.readyState === WebSocket.CLOSED);
  });
  it('keeps pending agent turn on noise and merges a follow-up utterance', async () => {
    const f = await fake(); const { call, frames } = session(); const resolvers: ((text: string) => void)[] = [];
    const signals: AbortSignal[] = []; const texts: string[] = [];
    const voice = new VoiceCall(call, config(), (text, s) => { texts.push(text); signals.push(s); return new Promise<string>(r => resolvers.push(r)); }, undefined, f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Frage', 0)); await wait(() => signals.length === 1);
    f.send({ type: 'SpeechStarted' });
    f.send({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'aeh' }] } });
    await new Promise(r => setTimeout(r, 40)); expect(signals[0]!.aborted).toBe(false);
    f.send({ ...final('und noch', 2), speech_final: true }); await wait(() => signals.length === 2);
    expect(signals[0]!.aborted).toBe(true); expect(texts[1]).toBe('Frage und noch');
    resolvers[0]!('Stale.'); await new Promise(r => setTimeout(r, 40));
    expect(f.requests).toHaveLength(0); expect(frames.some(x => x.event === 'clear')).toBe(true);
  });
  it.each(['deepgram'] as const)('ignores VAD noise but aborts pending %s TTS on a transcript', async provider => {
    const f = await fake(); f.hang(); const { call, frames } = session();
    const voice = new VoiceCall(call, config({ tts: { provider, apiKey: 'fake-tts', voice: 'configured-voice' } }), () => 'Antwort.', undefined, f.dependencies); cleanup.push(() => voice.stop());
    await wait(() => !!f.socket()); f.send(final('Frage', 0)); await wait(() => f.requests.length === 1);
    const clears = frames.filter(x => x.event === 'clear').length;
    f.send({ type: 'SpeechStarted' }); await new Promise(r => setTimeout(r, 50));
    f.send({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: '' }] } });
    await new Promise(r => setTimeout(r, 20));
    expect(frames.filter(x => x.event === 'clear')).toHaveLength(clears);
    f.send({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'Stopp' }] } });
    await wait(() => frames.filter(x => x.event === 'clear').length > clears);
    expect(frames.filter(x => x.event === 'media' || x.event === 'mark')).toEqual([]);
  });
  it('uses explicit OpenAI-compatible PCM source rate through custom TTS', async () => {
    const f = await fake(); f.output(Buffer.alloc(960), 'application/octet-stream'); const { call, frames } = session();
    const voice = new VoiceCall(call, config({ tts: { provider: 'custom', apiKey: 'fake', baseUrl: 'https://speech.example', model: 'tts-1', voice: 'alloy', sourceSampleRate: 24000 } }), () => 'Antwort.', undefined, f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Frage', 0));
    await wait(() => frames.some(x => x.event === 'mark'));
    expect(frames.filter(x => x.event === 'media')).toHaveLength(1);
    expect(f.requests[0]?.body).toEqual({ model: 'tts-1', voice: 'alloy', input: 'Antwort.', response_format: 'pcm' });
  });
  it('sanitizes remote errors and enforces TTS timeout', async () => {
    const f = await fake(); f.hang(); const { call } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config({ tts: { apiKey: 'fake', timeoutMs: 20 } }), () => 'Answer.', errorsOnly(log), f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Question', 0)); await wait(() => log.mock.calls.length === 1);
    expect(log.mock.calls[0]?.[0]).toBe('voice-turn-error'); f.send({ type: 'Error', message: 'secret transcript' }); await wait(() => log.mock.calls.length === 2);
    await wait(() => f.socket()?.readyState === WebSocket.CLOSED);
  });
  it('bounds preconnect bytes and closes socket', async () => {
    const f = await fake(); const { call } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config({ voice: { enabled: true, maxInboundBytes: 160 } }), undefined, log, f.dependencies);
    cleanup.push(() => voice.stop()); voice.audio(Buffer.alloc(161)); expect(log).toHaveBeenCalledTimes(1); expect(call.queuedBytes).toBe(0);
  });
  it('plays multiple sentences larger than the bounded queue without dropping audio', async () => {
    const f = await fake(); f.output(Buffer.alloc(1000)); const { call, frames } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config({ voice: { enabled: true, maxOutboundBytes: 320, playbackPrebufferMs: 100 } }), () => 'Answer. More.', errorsOnly(log), f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Question', 0));
    await wait(() => frames.filter(x => x.event === 'mark').length === 2);
    expect(frames.filter(x => x.event === 'media')).toHaveLength(14);
    expect(log).not.toHaveBeenCalled(); expect(call.queuedBytes).toBe(0);
  });
  it('rejects TTS exceeding 120 seconds independently of queue capacity', async () => {
    const f = await fake(); f.output(Buffer.alloc(8000 * 120 + 1));
    const { call, frames } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config({ voice: { enabled: true, maxOutboundBytes: 1048576 } }), () => 'Answer.', errorsOnly(log), f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Question', 0));
    await wait(() => log.mock.calls.length === 1);
    expect(log.mock.calls[0]?.[1]).toMatchObject({ message: 'TTS response limit' });
    expect(frames.some(frame => frame.event === 'mark')).toBe(false);
    expect(call.queuedBytes).toBe(0);
  });
  it('plugin forwards hooks, speaks greeting and cleans up on server stop', async () => {
    const f = await fake(); const mark = vi.fn(); const end = vi.fn();
    // Reserve then release port because runtime config deliberately rejects port zero.
    const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
    const port = (reserve.address() as { port: number }).port; await new Promise<void>(r => reserve.close(() => r()));
    const handle = await startSipPlugin({ ...config(), media: { port }, inbound: { greeting: 'Willkommen.' } }, { onUtterance: () => 'Antwort.', onMark: mark, onEnd: end }, { voice: f.dependencies });
    cleanup.push(() => handle.stop()); const client = new WebSocket(`ws://127.0.0.1:${port}/sip/media`); await once(client, 'open'); cleanup.push(() => client.terminate());
    const received: any[] = []; client.on('message', b => received.push(JSON.parse(String(b))));
    client.send(JSON.stringify({ event: 'start', streamSid: 'MZ1', start: {} }));
    client.send(buildMediaFrame('MZ1', Buffer.alloc(160))); await wait(() => f.requests.length === 1);
    await wait(() => received.some(x => x.event === 'mark')); expect(f.requests[0]?.body).toEqual({ text: 'Willkommen.' });
    f.send(final('Frage', 0));
    await wait(() => f.requests.length === 2);
    await wait(() => received.filter(x => x.event === 'mark').length === 2);
    expect(f.requests[1]?.body).toEqual({ text: 'Antwort.' });
    client.send(JSON.stringify({ event: 'mark', streamSid: 'MZ1', mark: { name: 'played' } })); await wait(() => mark.mock.calls.length === 1);
    await handle.stop(); expect(end).toHaveBeenCalledWith('MZ1', 'server-stop'); await wait(() => f.socket()?.readyState === WebSocket.CLOSED);
    expect(handle.server.registry.size).toBe(0);
  });

  it('enforces STT connection timeout against stalled handshake', async () => {
    const http = createServer((_req, _res) => undefined);
    http.on('upgrade', (_req, socket) => { cleanup.push(() => { socket.destroy(); }); });
    http.listen(0, '127.0.0.1'); await once(http, 'listening');
    cleanup.push(() => new Promise<void>(r => { http.closeAllConnections(); http.close(() => r()); }));
    const { call } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config({ stt: { apiKey: 'fake', connectionTimeoutMs: 25 } }), undefined, log,
      { listenUrl: `ws://127.0.0.1:${(http.address() as { port: number }).port}/listen` });
    cleanup.push(() => voice.stop());
    await wait(() => call.currentState === 'ended'); expect(log).toHaveBeenCalledTimes(1);
  });

  it('enforces STT bufferedAmount cap', async () => {
    const f = await fake(); const { call } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config({ stt: { apiKey: 'fake', maxBufferedBytes: 160 } }), undefined, log, f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket());
    const client = (voice as unknown as { socket: WebSocket }).socket;
    await wait(() => client.readyState === WebSocket.OPEN);
    Object.defineProperty(client, 'bufferedAmount', { get: () => 150 });
    voice.audio(Buffer.alloc(160)); expect(log).toHaveBeenCalledTimes(1); expect(call.currentState).toBe('ended');
  });

  it('never forwards HTTP error payloads or container headers to audio', async () => {
    const f = await fake(); f.fail(); f.output(Buffer.from('secret transcript'));
    const { call, frames } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config(), () => 'Answer.', errorsOnly(log), f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Question', 0));
    await wait(() => log.mock.calls.length === 1); expect(log.mock.calls[0]?.[0]).toBe('voice-turn-error');
    expect(frames.some(x => x.event === 'media' || x.event === 'mark')).toBe(false);
  });

  it('rejects WAV from raw Aura endpoint', async () => {
    const f = await fake(); f.output(Buffer.from('RIFF-not-raw'), 'audio/wav');
    const { call, frames } = session(); const log = vi.fn();
    const voice = new VoiceCall(call, config(), () => 'Answer.', errorsOnly(log), f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Question', 0));
    await wait(() => log.mock.calls.length === 1); expect(frames.some(x => x.event === 'media')).toBe(false);
  });

  it('stop aborts pending agent even if hook ignores cancellation', async () => {
    const f = await fake(); const { call } = session(); let signal!: AbortSignal; let resolve!: (text: string) => void;
    const voice = new VoiceCall(call, config(), (_text, s) => { signal = s; return new Promise<string>(r => resolve = r); }, undefined, f.dependencies);
    cleanup.push(() => voice.stop()); await wait(() => !!f.socket()); f.send(final('Question', 0)); await wait(() => !!signal);
    voice.stop(); expect(signal.aborted).toBe(true); resolve('Late.'); await new Promise(r => setTimeout(r, 30));
    expect(f.requests).toHaveLength(0); await wait(() => f.socket()?.readyState === WebSocket.CLOSED);
  });

  it('blocks audio and prompts for PIN when pin is enabled, then unlocks on correct code', async () => {
    const f = await fake();
    const { call } = session();
    const voice = new VoiceCall(
      call,
      config({
        inbound: {
          greeting: 'Willkommen nach PIN.',
          pin: {
            enabled: true,
            code: '8018',
            promptText: 'Please enter PIN.',
            successText: 'PIN korrekt.',
            failureText: 'PIN falsch.',
            lockoutText: 'Gesperrt.',
            maxAttempts: 3,
            maxDigits: 8,
            timeoutMs: 20000,
          },
        },
      }),
      undefined,
      undefined,
      f.dependencies
    );
    cleanup.push(() => voice.stop());
    await wait(() => !!f.socket());

    // Prompt played immediately
    await wait(() => f.requests.length === 1);
    expect(f.requests[0]?.body.text).toBe('Please enter PIN.');

    // Inbound audio is dropped before PIN entry
    voice.audio(Buffer.alloc(160, 0x55));
    await new Promise((r) => setTimeout(r, 20));
    expect(f.audio.length).toBe(0);

    // Wrong PIN entry
    voice.dtmf('1');
    voice.dtmf('2');
    voice.dtmf('3');
    voice.dtmf('4');
    voice.dtmf('#');
    await wait(() => f.requests.length === 2);
    expect(f.requests[1]?.body.text).toBe('PIN falsch.');

    // Correct PIN entry: success text and greeting are queued back to back, so an
    // in-flight success sentence may be aborted by the greeting; the greeting must arrive.
    voice.dtmf('8');
    voice.dtmf('0');
    voice.dtmf('1');
    voice.dtmf('8');
    voice.dtmf('#');
    await wait(() => f.requests.length >= 4);
    const pinTexts = f.requests.map((request) => request.body.text);
    expect(pinTexts).toEqual([
      'Please enter PIN.',
      'PIN falsch.',
      'PIN korrekt.',
      'Willkommen nach PIN.',
    ]);

    // Now audio passes through to STT
    voice.audio(Buffer.alloc(160, 0x55));
    await wait(() => f.audio.length === 1);
  });
});
