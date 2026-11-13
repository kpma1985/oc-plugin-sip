import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';

export interface DeepgramModel {
  /** Provider canonical identifier; use this value in stt.model / tts.model. */
  canonicalName: string;
  languages: string[];
}
export interface DeepgramSttModel extends DeepgramModel { streaming: boolean }
export interface DeepgramModelCatalog { stt: DeepgramSttModel[]; tts: DeepgramModel[] }
export interface DeepgramModelOptions {
  /** Resolved server-side credential, never a browser-supplied key. */
  apiKey: string;
  language?: string;
  /** Defaults true; applies only to STT. */
  streamingOnly?: boolean;
  signal?: AbortSignal;
  /** 1..60000 ms, defaults 10000; covers headers and body. */
  timeoutMs?: number;
}
export interface DeepgramModelDependencies {
  /** Trusted test injection. Endpoint is deliberately not configurable. */
  fetch?: typeof fetch;
}

const modelSchema = z.object({
  canonical_name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  languages: z.array(z.string().min(2).max(35).regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$|^multi$/)).max(256),
});
const catalogSchema = z.object({
  stt: z.array(modelSchema.extend({ streaming: z.boolean() })).max(4096),
  tts: z.array(modelSchema).max(4096),
});
const salt = randomBytes(32);
const cache = new Map<string, { expires: number; catalog: DeepgramModelCatalog }>();
const ttlMs = 300000;
const maxEntries = 32;
const maxBytes = 1048576;

function failure(message: string): Error { return new Error(`Deepgram model discovery: ${message}`); }
function filter(catalog: DeepgramModelCatalog, options: DeepgramModelOptions): DeepgramModelCatalog {
  const requested = options.language?.toLowerCase();
  const matches = (model: DeepgramModel): boolean => !requested || model.languages.some(language => {
    const tag = language.toLowerCase();
    return tag === requested || tag === requested.split('-')[0];
  });
  return structuredClone({
    stt: catalog.stt.filter(model => matches(model) && (options.streamingOnly === false || model.streaming)),
    tts: catalog.tts.filter(matches),
  });
}

/** Live public catalog, not project/custom models. No logging, redirects or stale fallback.
 * Completed responses cached for five minutes, at most 32 credential identities.
 * No inflight sharing: one caller's cancellation never aborts another caller.
 */
export async function discoverDeepgramModels(options: DeepgramModelOptions,
  dependencies: DeepgramModelDependencies = {}): Promise<DeepgramModelCatalog> {
  if (typeof options.apiKey !== 'string' || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) throw failure('credential required');
  if (options.language !== undefined && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$|^multi$/.test(options.language)) throw failure('invalid language');
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw failure('invalid timeout');
  if (options.signal?.aborted) throw failure('aborted');
  // Keyed digest with process-random salt: raw credentials never enter cache keys.
  // Injected fetch bypasses global cache, preventing test/production contamination.
  const identity = createHmac('sha256', salt).update(options.apiKey).digest('hex');
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
  const hit = dependencies.fetch ? undefined : cache.get(identity);
  if (hit) return filter(hit.catalog, options);
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => { controller.abort(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(failure(timedOut ? 'timeout' : 'aborted')), { once: true });
  });
  const request = async (): Promise<DeepgramModelCatalog> => {
    const response = await (dependencies.fetch ?? fetch)('https://api.deepgram.com/v1/models', {
      method: 'GET', headers: { Authorization: `Token ${options.apiKey}`, Accept: 'application/json' },
      redirect: 'error', signal: controller.signal,
    });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw failure('aborted'); }
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw failure(`HTTP ${response.status}`); }
    if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      void response.body?.cancel().catch(() => undefined); throw failure('invalid response');
    }
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      void response.body.cancel().catch(() => undefined); throw failure('response limit');
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw failure('aborted');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw failure('response limit');
      chunks.push(value);
    }
    let parsed: z.infer<typeof catalogSchema>;
    try { parsed = catalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch { throw failure('invalid catalog'); }
    const unique = <T extends DeepgramModel>(models: T[]): T[] => {
      const result = new Map<string, T>();
      for (const model of models) {
        const previous = result.get(model.canonicalName);
        if (previous) {
          previous.languages = [...new Set([...previous.languages, ...model.languages])];
          if ('streaming' in previous && 'streaming' in model) previous.streaming = previous.streaming || model.streaming;
        } else result.set(model.canonicalName, model);
      }
      return [...result.values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
    };
    return {
      stt: unique(parsed.stt.map(model => ({ canonicalName: model.canonical_name, languages: model.languages, streaming: model.streaming }))),
      tts: unique(parsed.tts.map(model => ({ canonicalName: model.canonical_name, languages: model.languages }))),
    };
  };
  try {
    const catalog = await Promise.race([request(), aborted]);
    if (!dependencies.fetch) {
      cache.delete(identity);
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
      cache.set(identity, { expires: Date.now() + ttlMs, catalog });
    }
    return filter(catalog, options);
  } catch (error) {
    if (controller.signal.aborted) throw failure(timedOut ? 'timeout' : 'aborted');
    if (error instanceof Error && /^Deepgram model discovery: (HTTP \d{3}|invalid response|response limit|invalid catalog)$/.test(error.message)) throw error;
    throw failure('request failed');
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    controller.abort(); void reader?.cancel().catch(() => undefined);
  }
}

export interface DeepgramThinkModel { id: string; name: string; provider: string }

const thinkSchema = z.object({
  models: z.array(z.object({
    id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    name: z.string().min(1).max(128),
    provider: z.string().min(1).max(32).regex(/^[a-z][a-z0-9_]*$/),
  }).passthrough()).max(1024),
});
let thinkCache: { expires: number; models: DeepgramThinkModel[] } | undefined;

/** Public, unauthenticated Deepgram Voice Agent think-model catalog. Fixed URL, bounded,
 * no redirects, five-minute cache. Injected fetch bypasses the cache. */
export async function discoverDeepgramThinkModels(options: { signal?: AbortSignal; timeoutMs?: number } = {},
  dependencies: DeepgramModelDependencies = {}): Promise<DeepgramThinkModel[]> {
  const fail = (message: string): Error => new Error(`Deepgram think model discovery: ${message}`);
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw fail('invalid timeout');
  if (!dependencies.fetch && thinkCache && thinkCache.expires > Date.now()) return structuredClone(thinkCache.models);
  const controller = new AbortController();
  const abort = (): void => { controller.abort(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(fail('timeout or aborted')), { once: true });
  });
  aborted.catch(() => undefined);
  try {
    const response = await Promise.race([(dependencies.fetch ?? fetch)('https://agent.deepgram.com/v1/agent/settings/think/models', {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal,
    }), aborted]);
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw fail(`HTTP ${response.status}`); }
    const text = await Promise.race([response.text(), aborted]);
    if (text.length > maxBytes) throw fail('response limit');
    let parsed: z.infer<typeof thinkSchema>;
    try { parsed = thinkSchema.parse(JSON.parse(text)); } catch { throw fail('invalid catalog'); }
    const seen = new Set<string>();
    const models = parsed.models
      .map(({ id, name, provider }) => ({ id, name, provider }))
      .filter(model => { const key = `${model.provider}\n${model.id}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
    if (!dependencies.fetch) thinkCache = { expires: Date.now() + ttlMs, models };
    return structuredClone(models);
  } catch (error) {
    if (controller.signal.aborted) throw fail('timeout or aborted');
    if (error instanceof Error && error.message.startsWith('Deepgram think model discovery:')) throw error;
    throw fail('request failed');
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort();
  }
}

/** Structural subset assignable to OpenClaw 2026.9.9 registerGatewayMethod.
 * Registered by src/plugin.ts; discovery is RPC, not native dynamic dropdown UI.
 */
export interface DeepgramModelGatewayApi {
  registerGatewayMethod(name: string, handler: (options: {
    params: Record<string, unknown>;
    signal?: AbortSignal;
    respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
  }) => Promise<void>, options: { scope: 'operator.read' }): void;
}
export function registerDeepgramModelDiscovery(api: DeepgramModelGatewayApi,
  getApiKey: () => string | undefined, dependencies: DeepgramModelDependencies = {}): void {
  api.registerGatewayMethod('sip.deepgram.models', async ({ params, respond, signal }) => {
    if (Object.keys(params).some(key => key !== 'language' && key !== 'streamingOnly') ||
      (params.language !== undefined && typeof params.language !== 'string') ||
      (params.streamingOnly !== undefined && typeof params.streamingOnly !== 'boolean')) {
      respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid model discovery parameters' }); return;
    }
    try {
      const catalog = await discoverDeepgramModels({
        apiKey: getApiKey() ?? '', signal,
        language: params.language as string | undefined, streamingOnly: params.streamingOnly as boolean | undefined
      }, dependencies);
      respond(true, catalog);
    } catch {
      respond(false, undefined, { code: 'UNAVAILABLE', message: 'Deepgram model discovery unavailable' });
    }
  }, { scope: 'operator.read' });
  api.registerGatewayMethod('sip.deepgram.thinkModels', async ({ params, respond, signal }) => {
    if (Object.keys(params).length) {
      respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid think model parameters' }); return;
    }
    try {
      respond(true, { models: await discoverDeepgramThinkModels({ signal }, dependencies) });
    } catch {
      respond(false, undefined, { code: 'UNAVAILABLE', message: 'Deepgram think model discovery unavailable' });
    }
  }, { scope: 'operator.read' });
}
