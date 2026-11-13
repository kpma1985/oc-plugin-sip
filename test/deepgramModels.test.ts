import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverDeepgramModels, registerDeepgramModelDiscovery, type DeepgramModelGatewayApi } from '../src/index.js';
import { discoverDeepgramThinkModels } from '../src/voice/deepgramModels.js';

const payload = {
  stt: [
    { name: 'Display only', canonical_name: 'nova-3', languages: ['de', 'en-US'], streaming: true },
    { canonical_name: 'batch', languages: ['de'], streaming: false },
    { canonical_name: 'regional', languages: ['de-AT'], streaming: true },
  ],
  tts: [{ name: 'Viktoria', canonical_name: 'aura-2-viktoria-de', languages: ['de-DE'] }],
};
const response = (data: unknown = payload): Response => Response.json(data);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Deepgram live model discovery (no external API)', () => {
  it('uses fixed HTTPS GET, Token auth, canonical identifiers and streaming-only STT', async () => {
    const mock = vi.fn<typeof fetch>(async () => response());
    const result = await discoverDeepgramModels({ apiKey: 'fake', language: 'de-DE' }, { fetch: mock });
    expect(mock.mock.calls[0]?.[0]).toBe('https://api.deepgram.com/v1/models');
    expect(mock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Token fake' } });
    expect(result.stt.map(m => m.canonicalName)).toEqual(['nova-3']);
    expect(result.tts.map(m => m.canonicalName)).toEqual(['aura-2-viktoria-de']);
    expect(JSON.stringify(result)).not.toContain('Display only');
  });
  it('matches case-insensitively; base fallback does not claim other dialect support', async () => {
    const mock: typeof fetch = async () => response();
    expect((await discoverDeepgramModels({ apiKey: 'fake', language: 'DE-de', streamingOnly: false }, { fetch: mock })).stt).toHaveLength(2);
    expect((await discoverDeepgramModels({ apiKey: 'fake', language: 'en-us' }, { fetch: mock })).stt).toHaveLength(1);
    expect(await discoverDeepgramModels({ apiKey: 'fake', language: 'fr' }, { fetch: mock })).toEqual({ stt: [], tts: [] });
  });
  it('deduplicates canonical models, merging languages and streaming capability', async () => {
    const result = await discoverDeepgramModels({ apiKey: 'fake' }, {
      fetch: async () => response({
        stt: [{ canonical_name: 'nova', languages: ['en'], streaming: false }, { canonical_name: 'nova', languages: ['de'], streaming: true }], tts: [],
      })
    });
    expect(result.stt).toEqual([{ canonicalName: 'nova', languages: ['en', 'de'], streaming: true }]);
  });
  it.each([
    {}, { stt: [], tts: 'bad' },
    { stt: [{ canonical_name: 'nova', languages: ['de'] }], tts: [] },
    { stt: [], tts: [{ canonical_name: 'bad name', languages: ['de'] }] },
    { stt: [], tts: [{ canonical_name: 'aura', languages: [123] }] },
  ])('rejects malformed catalog without reflecting payload', async data => {
    await expect(discoverDeepgramModels({ apiKey: 'fake' }, { fetch: async () => response(data) })).rejects.toThrow('invalid catalog');
  });
  it('sanitizes HTTP and transport errors; refuses redirects and wrong format', async () => {
    await expect(discoverDeepgramModels({ apiKey: 'fake' }, { fetch: async () => new Response('private provider payload', { status: 401 }) })).rejects.toThrow('Deepgram model discovery: HTTP 401');
    await expect(discoverDeepgramModels({ apiKey: 'fake' }, { fetch: async () => { throw new Error('fake key and private payload'); } })).rejects.toThrow('Deepgram model discovery: request failed');
    await expect(discoverDeepgramModels({ apiKey: 'fake' }, { fetch: async () => new Response('{}') })).rejects.toThrow('invalid response');
    await expect(discoverDeepgramModels({ apiKey: 'fake' }, { fetch: async () => new Response('', { status: 302 }) })).rejects.toThrow('HTTP 302');
  });
  it('bounds declared and streamed body sizes', async () => {
    await expect(discoverDeepgramModels({ apiKey: 'fake' }, { fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }) })).rejects.toThrow('response limit');
    await expect(discoverDeepgramModels({ apiKey: 'fake' }, { fetch: async () => new Response(new Uint8Array(1048577), { headers: { 'content-type': 'application/json' } }) })).rejects.toThrow('response limit');
  });
  it('aborts before fetch and during body; timeout also bounds a non-cooperative fetch', async () => {
    const controller = new AbortController(); controller.abort(new Error('private reason'));
    const mock = vi.fn<typeof fetch>(async () => response());
    await expect(discoverDeepgramModels({ apiKey: 'fake', signal: controller.signal }, { fetch: mock })).rejects.toThrow('aborted');
    expect(mock).not.toHaveBeenCalled();
    await expect(discoverDeepgramModels({ apiKey: 'fake', timeoutMs: 10 }, { fetch: () => new Promise(() => undefined) })).rejects.toThrow('timeout');
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ cancel });
    const live = new AbortController();
    const request = discoverDeepgramModels({ apiKey: 'fake', signal: live.signal }, { fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) });
    await Promise.resolve(); live.abort(); await expect(request).rejects.toThrow('aborted'); expect(cancel).toHaveBeenCalled();
    const stalled = new ReadableStream<Uint8Array>({});
    await expect(discoverDeepgramModels({ apiKey: 'fake', timeoutMs: 10 }, { fetch: async () => new Response(stalled, { headers: { 'content-type': 'application/json' } }) })).rejects.toThrow('timeout');
  });
  it('validates options without fetching', async () => {
    const mock = vi.fn<typeof fetch>();
    for (const options of [{ apiKey: '' }, { apiKey: 'fake\n' }, { apiKey: 'fake', language: 'bad language' }, { apiKey: 'fake', timeoutMs: 0 }]) {
      await expect(discoverDeepgramModels(options, { fetch: mock })).rejects.toThrow('Deepgram model discovery');
    }
    expect(mock).not.toHaveBeenCalled();
  });
  it('caches by credential identity, copies output, expires and caps cache; injection bypasses it', async () => {
    const mock = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', mock);
    const first = await discoverDeepgramModels({ apiKey: 'fake-cache-a' }); first.stt.length = 0;
    expect((await discoverDeepgramModels({ apiKey: 'fake-cache-a', language: 'de-DE' })).stt).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(1);
    await discoverDeepgramModels({ apiKey: 'fake-cache-b' }); expect(mock).toHaveBeenCalledTimes(2);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300001);
    await discoverDeepgramModels({ apiKey: 'fake-cache-a' }); expect(mock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 32; i++) await discoverDeepgramModels({ apiKey: `fake-cache-${i}` });
    await discoverDeepgramModels({ apiKey: 'fake-cache-a' }); expect(mock).toHaveBeenCalledTimes(36);
    await discoverDeepgramModels({ apiKey: 'fake-cache-a' }, { fetch: mock }); expect(mock).toHaveBeenCalledTimes(37);
  });
  it('registers explicit read-scoped RPC using server credentials only', async () => {
    let handler!: Parameters<DeepgramModelGatewayApi['registerGatewayMethod']>[1];
    const register = vi.fn<DeepgramModelGatewayApi['registerGatewayMethod']>((name, fn) => { if (name === 'sip.deepgram.models') handler = fn; });
    const mock = vi.fn<typeof fetch>(async () => response());
    registerDeepgramModelDiscovery({ registerGatewayMethod: register }, () => 'fake-server', { fetch: mock });
    expect(register.mock.calls[0]?.[0]).toBe('sip.deepgram.models'); expect(register.mock.calls[0]?.[2]).toEqual({ scope: 'operator.read' });
    const respond = vi.fn(); await handler({ params: { apiKey: 'browser-key' }, respond });
    expect(respond).toHaveBeenLastCalledWith(false, undefined, expect.objectContaining({ code: 'INVALID_REQUEST' })); expect(mock).not.toHaveBeenCalled();
    await handler({ params: { language: 'de-DE' }, respond }); expect(respond).toHaveBeenLastCalledWith(true, expect.objectContaining({ stt: expect.any(Array) }));
    registerDeepgramModelDiscovery({ registerGatewayMethod: register }, () => { throw new Error('private'); }, { fetch: mock });
    await handler({ params: {}, respond }); expect(respond).toHaveBeenLastCalledWith(false, undefined, { code: 'UNAVAILABLE', message: 'Deepgram model discovery unavailable' });
  });
  it('lists public think models without credentials, validated, sorted and deduplicated', async () => {
    const mock = vi.fn<typeof fetch>(async () => Response.json({ models: [
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'open_ai' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', extra: true },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'open_ai' },
    ] }));
    const models = await discoverDeepgramThinkModels({}, { fetch: mock });
    expect(mock.mock.calls[0]?.[0]).toBe('https://agent.deepgram.com/v1/agent/settings/think/models');
    expect(mock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(JSON.stringify(mock.mock.calls[0]?.[1])).not.toMatch(/Token|authorization/i);
    expect(models).toEqual([
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'open_ai' },
    ]);
    await expect(discoverDeepgramThinkModels({}, { fetch: async () => Response.json({ models: [{ id: 'x y', name: 'x', provider: 'open_ai' }] }) })).rejects.toThrow('invalid catalog');
    await expect(discoverDeepgramThinkModels({}, { fetch: async () => new Response('private', { status: 500 }) })).rejects.toThrow('HTTP 500');
    await expect(discoverDeepgramThinkModels({ timeoutMs: 10 }, { fetch: () => new Promise(() => undefined) })).rejects.toThrow('timeout or aborted');
  });
  it('registers read-scoped think model RPC that rejects parameters', async () => {
    let handler!: Parameters<DeepgramModelGatewayApi['registerGatewayMethod']>[1];
    const register = vi.fn<DeepgramModelGatewayApi['registerGatewayMethod']>((name, fn) => { if (name === 'sip.deepgram.thinkModels') handler = fn; });
    const mock = vi.fn<typeof fetch>(async () => Response.json({ models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'open_ai' }] }));
    registerDeepgramModelDiscovery({ registerGatewayMethod: register }, () => undefined, { fetch: mock });
    expect(register).toHaveBeenCalledWith('sip.deepgram.thinkModels', expect.any(Function), { scope: 'operator.read' });
    const respond = vi.fn();
    await handler({ params: { url: 'https://evil.example' }, respond });
    expect(respond).toHaveBeenLastCalledWith(false, undefined, expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(mock).not.toHaveBeenCalled();
    await handler({ params: {}, respond });
    expect(respond).toHaveBeenLastCalledWith(true, { models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'open_ai' }] });
  });
});
