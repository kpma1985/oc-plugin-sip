import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { parseSipConfig, validateForTransport } from '../src/config.js';
import { CallSession } from '../src/media/callSession.js';
import { DeepgramAgentCall, buildSettings, OPENCLAW_TASK } from '../src/voice/deepgramAgent.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function wait(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
}

const agentConfig = (voice: Record<string, unknown> = {}) => parseSipConfig({
  stt: { apiKey: 'k', keyterms: ['Sipgate'] }, tts: { apiKey: 'k' }, inbound: { greeting: 'Hallo.' },
  voice: {
    enabled: true, engine: 'deepgram-agent', ...voice,
    agent: { prompt: 'Du bist ein Telefonassistent.', think: { provider: 'open_ai', model: 'gpt-4o-mini' } },
  },
});

async function fake() {
  const received: Array<string | Buffer> = [];
  let socket: WebSocket | undefined;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  cleanup.push(() => new Promise<void>(resolve => { for (const client of server.clients) client.terminate(); server.close(() => resolve()); }));
  server.on('connection', client => {
    socket = client;
    client.on('message', (data, binary) => received.push(binary ? Buffer.from(data as Buffer) : String(data)));
    client.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
  });
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { received, url, socket: () => socket, json: (value: unknown) => socket!.send(JSON.stringify(value)) };
}

function session(codec: 'pcmu' | 'g722' = 'pcmu') {
  const frames: Array<Record<string, any>> = [];
  const call = new CallSession({ streamSid: 'MZ1', codec, onSend: data => frames.push(JSON.parse(data)) });
  call.activate(); cleanup.push(() => call.end('test'));
  return { call, frames };
}

const voiceProblems = (config: ReturnType<typeof parseSipConfig>) =>
  validateForTransport(config).filter(problem => /voice\.|stt\.|tts\./.test(problem));

describe('voice.engine deepgram-agent config', () => {
  it('defaults to openclaw and rejects unknown agent keys', () => {
    expect(parseSipConfig({}).voice.engine).toBe('openclaw');
    expect(() => parseSipConfig({ voice: { agent: { nope: 1 } } })).toThrow(/invalid sip plugin config/);
    expect(() => parseSipConfig({ voice: { engine: 'other' } })).toThrow(/invalid sip plugin config/);
  });

  it('requires prompt and think.model for deepgram-agent, tts.apiKey not needed', () => {
    const base = { sip: { user: 'u', password: 'p', publicIp: '1.2.3.4' }, stt: { apiKey: 'k' } };
    const missing = voiceProblems(parseSipConfig({ ...base, transport: 'embedded', voice: { enabled: true, engine: 'deepgram-agent' } }));
    expect(missing).toEqual(expect.arrayContaining([
      expect.stringContaining('voice.agent.think.model'), expect.stringContaining('voice.agent.prompt'),
    ]));
    expect(voiceProblems(agentConfig())).toEqual([]);
  });

  it('requires think.endpoint for providers without managed models', () => {
    const config = parseSipConfig({
      stt: { apiKey: 'k' }, tts: { apiKey: 'k' },
      voice: { enabled: true, engine: 'deepgram-agent', agent: { prompt: 'p', think: { provider: 'groq', model: 'm' } } },
    });
    expect(voiceProblems(config)).toEqual([expect.stringContaining('think.endpoint')]);
  });

  it('accepts Deepgram-managed NVIDIA think models without endpoint', () => {
    const config = parseSipConfig({
      stt: { apiKey: 'k' }, tts: { apiKey: 'k' },
      voice: { enabled: true, engine: 'deepgram-agent', agent: { prompt: 'p', think: { provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' } } },
    });
    expect(voiceProblems(config)).toEqual([]);
    expect((buildSettings(config, 'pcmu', 8000) as any).agent.think.provider).toMatchObject({ type: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' });
  });
});

describe('DeepgramAgentCall', () => {
  it('builds mulaw Settings with prompt, greeting and think provider', () => {
    const settings = buildSettings(agentConfig(), 'pcmu', 8000) as any;
    expect(settings.audio).toEqual({
      input: { encoding: 'mulaw', sample_rate: 8000 },
      output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
    });
    expect(settings.agent.think).toEqual({
      provider: { type: 'open_ai', model: 'gpt-4o-mini' }, prompt: 'Du bist ein Telefonassistent.',
    });
    expect(settings.agent.greeting).toBe('Hallo.');
    expect(settings.agent.listen.provider.keyterms).toEqual(['Sipgate']);
    expect(settings.agent.speak.provider.model).toBe('aura-2-viktoria-de');
    expect((buildSettings(agentConfig(), 'g722', 16000) as any).audio.input).toEqual({ encoding: 'linear16', sample_rate: 16000 });
  });

  it('sends Settings on Welcome, queues audio until SettingsApplied and plays agent audio', async () => {
    const f = await fake(); const { call, frames } = session(); const log = vi.fn();
    const agent = new DeepgramAgentCall(call, agentConfig(), log, { agentUrl: f.url });
    cleanup.push(() => agent.stop());
    await wait(() => f.received.some(x => typeof x === 'string' && x.includes('"Settings"')));
    agent.audio(Buffer.alloc(160, 1));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.received.filter(x => Buffer.isBuffer(x))).toHaveLength(0);
    f.json({ type: 'SettingsApplied' });
    await wait(() => f.received.some(x => Buffer.isBuffer(x)));
    f.socket()!.send(Buffer.alloc(320, 0x81), { binary: true });
    await wait(() => call.queuedBytes > 0 || frames.some(x => x.event === 'media'));
    f.json({ type: 'AgentAudioDone' });
    await wait(() => log.mock.calls.some(x => x[0] === 'tts-end'));
  });

  it('barge-in clears playback and drops stale audio', async () => {
    const f = await fake(); const { call, frames } = session();
    const agent = new DeepgramAgentCall(call, agentConfig(), undefined, { agentUrl: f.url });
    cleanup.push(() => agent.stop());
    await wait(() => !!f.socket()); f.json({ type: 'SettingsApplied' });
    f.json({ type: 'UserStartedSpeaking' });
    await wait(() => frames.some(x => x.event === 'clear'));
    f.socket()!.send(Buffer.alloc(320, 0x81), { binary: true });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(call.queuedBytes).toBe(0);
    f.json({ type: 'ConversationText', role: 'user', content: 'Test question' });
    f.socket()!.send(Buffer.alloc(320, 0x82), { binary: true });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(call.queuedBytes).toBe(0);
    f.json({ type: 'AgentThinking' });
    f.json({ type: 'ConversationText', role: 'assistant', content: 'Test answer' });
    f.socket()!.send(Buffer.alloc(320, 0x83), { binary: true });
    await wait(() => frames.some(frame => frame.event === 'media'));
    expect(frames.filter(frame => frame.event === 'media')).not.toHaveLength(0);
  });

  it('ends the call on Error event and on pending overflow', async () => {
    const f = await fake(); const first = session(); const log = vi.fn();
    const agent = new DeepgramAgentCall(first.call, agentConfig(), log, { agentUrl: f.url });
    cleanup.push(() => agent.stop());
    await wait(() => !!f.socket()); f.json({ type: 'Error', description: 'secret transcript', code: 'X' });
    await wait(() => first.call.currentState === 'ended');
    expect(log).toHaveBeenCalledWith('voice-error', { reason: 'agent-error-event', detail: 'X' });

    const g = await fake(); const second = session();
    const small = new DeepgramAgentCall(second.call, agentConfig({ maxInboundBytes: 160 }), undefined, { agentUrl: g.url });
    cleanup.push(() => small.stop());
    small.audio(Buffer.alloc(161));
    expect(second.call.currentState).toBe('ended');
  });

  it('ends the call when the socket closes', async () => {
    const f = await fake(); const { call } = session();
    const agent = new DeepgramAgentCall(call, agentConfig(), undefined, { agentUrl: f.url });
    cleanup.push(() => agent.stop());
    await wait(() => !!f.socket()); f.socket()!.close();
    await wait(() => call.currentState === 'ended');
  });
});

describe('agent tools', () => {
  const toolConfig = () => parseSipConfig({
    stt: { apiKey: 'k' }, tts: { apiKey: 'k' },
    voice: { enabled: true, engine: 'deepgram-agent', agent: { prompt: 'p', tools: true, think: { model: 'gpt-4o-mini' } } },
  });

  it('declares openclaw_task only when tools are enabled', () => {
    expect((buildSettings(agentConfig(), 'pcmu', 8000) as any).agent.think.functions).toBeUndefined();
    expect((buildSettings(toolConfig(), 'pcmu', 8000) as any).agent.think.functions).toEqual([OPENCLAW_TASK]);
  });

  it('routes FunctionCallRequest to the utterance hook and answers with FunctionCallResponse', async () => {
    const f = await fake(); const { call } = session(); const log = vi.fn();
    const utterance = vi.fn(async () => 'Es ist zwoelf Uhr.');
    const agent = new DeepgramAgentCall(call, toolConfig(), log, { agentUrl: f.url }, utterance);
    cleanup.push(() => agent.stop());
    await wait(() => !!f.socket());
    f.json({ type: 'FunctionCallRequest', functions: [{ id: 'f1', name: 'openclaw_task', arguments: '{"request":"Wie spaet ist es?"}', client_side: true }] });
    await wait(() => f.received.some(x => typeof x === 'string' && x.includes('FunctionCallResponse')));
    expect(utterance).toHaveBeenCalledWith('Wie spaet ist es?', expect.any(AbortSignal), call);
    expect(JSON.parse(f.received.find(x => typeof x === 'string' && x.includes('FunctionCallResponse')) as string))
      .toEqual({ type: 'FunctionCallResponse', id: 'f1', name: 'openclaw_task', content: 'Es ist zwoelf Uhr.' });
  });

  it('rejects unknown functions without calling the hook', async () => {
    const f = await fake(); const { call } = session(); const utterance = vi.fn();
    const agent = new DeepgramAgentCall(call, toolConfig(), undefined, { agentUrl: f.url }, utterance);
    cleanup.push(() => agent.stop());
    await wait(() => !!f.socket());
    f.json({ type: 'FunctionCallRequest', functions: [{ id: 'f2', name: 'shell', arguments: '{}', client_side: true }] });
    await wait(() => f.received.some(x => typeof x === 'string' && x.includes('FunctionCallResponse')));
    expect(utterance).not.toHaveBeenCalled();
  });
});
