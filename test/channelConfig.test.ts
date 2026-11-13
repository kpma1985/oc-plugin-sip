import { describe, expect, it, vi } from 'vitest';
import type { OpenClawConfig, OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import manifest from '../openclaw.plugin.json' with { type: 'json' };
import { resolveSipConfig } from '../src/channelConfig.js';
import { parseSipConfig } from '../src/config.js';
import entry, { registerSipRuntime } from '../src/plugin.js';
import type { startSipPlugin } from '../src/index.js';

const cfg = (channel: unknown, legacy?: unknown): OpenClawConfig => ({
  channels: { sip: channel }, plugins: { entries: { sip: { config: legacy } } },
} as OpenClawConfig);

describe('SIP channel config ownership', () => {
  it('preserves legacy config and accepts old empty channel placeholder', () => {
    const legacy = { enabled: true, tts: { provider: 'elevenlabs', voice: 'test-voice' }, voice: { playbackPrebufferMs: 100 } };
    expect(resolveSipConfig(cfg(undefined, legacy))).toEqual(parseSipConfig(legacy));
    expect(resolveSipConfig(cfg({}, legacy))).toEqual(parseSipConfig(legacy));
  });

  it('overlays explicit leaves before defaults, replaces arrays, preserves credentials', () => {
    const legacy = {
      enabled: true, sip: { user: 'fixture', password: 'fixture-only' },
      inbound: { allowFrom: ['+49123'], greeting: 'old' },
      tts: { provider: 'elevenlabs', apiKey: 'fixture-only', voice: 'test-voice' },
      voice: { playbackPrebufferMs: 100 }
    };
    const resolved = resolveSipConfig(cfg({ enabled: false, inbound: { allowFrom: [], greeting: 'new' } }, legacy));
    expect(resolved.enabled).toBe(false);
    expect(resolved.inbound.allowFrom).toEqual([]);
    expect(resolved.inbound.greeting).toBe('new');
    expect(resolved.sip).toMatchObject(legacy.sip);
    expect(resolved.tts).toMatchObject({ ...legacy.tts, model: 'eleven_multilingual_v2' });
    expect(resolved.voice.playbackPrebufferMs).toBe(100);
  });

  it('rejects invalid channel values rather than falling back or logging credentials', () => {
    for (const channel of [null, [], { unknown: true }, { sip: null }, { tts: { apiKey: { source: 'env', provider: 'default', id: 'KEY' } } }]) {
      expect(() => resolveSipConfig(cfg(channel, { enabled: true }))).toThrow('invalid sip plugin config');
    }
    try { resolveSipConfig(cfg({ sip: { password: 'fixture-only', publicIp: 'bad' } })); }
    catch (error) { expect(String(error)).not.toContain('fixture-only'); }
  });

  it('runtime and account adapter consume UI channel path with same effective config', async () => {
    const config = cfg({ enabled: true, inbound: { greeting: 'channel greeting' }, voice: { playbackPrebufferMs: 120 } },
      { enabled: false, sip: { user: 'fixture', password: 'fixture-only' } });
    const services: any[] = [];
    const channels: any[] = [];
    const api = {
      registrationMode: 'full', config, pluginConfig: config.plugins?.entries?.sip?.config,
      registerChannel: (value: any) => channels.push(value.plugin), registerService: (value: any) => services.push(value),
      registerGatewayMethod: vi.fn(), runtime: {}, logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as OpenClawPluginApi;
    entry.register?.(api);
    const channel = channels[0];
    expect(channel.config.resolveAccount(config)).toEqual({ accountId: 'default', ...resolveSipConfig(config) });
    expect(channel.configSchema.schema).toEqual(manifest.channelConfigs.sip.schema);
    expect(channel.configSchema.runtime.safeParse({ voice: { playbackPrebufferMs: 21 } }).success).toBe(false);
    expect(channel.configSchema.runtime.safeParse({})).toEqual({ success: true, data: {} });
    const invalid = channel.configSchema.runtime.safeParse({ sip: { publicIp: 'bad' } });
    expect(invalid.success).toBe(false);
    expect(invalid.issues[0].path).toEqual(['sip', 'publicIp']);
    const stop = vi.fn(async () => { });
    const start = vi.fn(async (_config: unknown) => ({ stop, hangup: vi.fn() }));
    const run = registerSipRuntime(api, start as unknown as typeof startSipPlugin);
    const controller = new AbortController();
    const done = run({ accountId: 'default', cfg: config, abortSignal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(start.mock.calls[0]?.[0]).toEqual(resolveSipConfig(config));
    controller.abort(); await done;
    expect(stop).toHaveBeenCalledOnce();
  });

  it('manifest channel and legacy schemas/hints match; all credentials masked', () => {
    expect(manifest.channelConfigs.sip.schema).toEqual(manifest.configSchema);
    expect(manifest.channelConfigs.sip.uiHints).toEqual(manifest.uiHints);
    const hints: Record<string, { label?: string; advanced?: boolean }> = manifest.uiHints;
    for (const path of [
      'enabled', 'sip', 'sip.preset', 'sip.user', 'sip.password',
      'inbound', 'inbound.agentId', 'inbound.greeting', 'inbound.policy',
      'inbound.allowFrom', 'inbound.maxConcurrent', 'inbound.toolsAllow',
      'voice', 'voice.enabled', 'voice.engine', 'voice.agent.prompt',
      'voice.agent.greeting', 'voice.agent.think.provider', 'voice.agent.think.model',
      'voice.agent.tools', 'stt', 'stt.provider', 'stt.apiKey', 'stt.language',
      'stt.model', 'tts', 'tts.provider', 'tts.apiKey', 'tts.model', 'tts.voice',
      'audio', 'audio.mode',
    ]) {
      expect(hints[path]?.label, path).toBeTruthy();
      expect(hints[path]?.advanced, path).not.toBe(true);
    }
    for (const path of [
      'transport', 'sip.domain', 'sip.registrar', 'sip.publicIp', 'sip.listenAddr',
      'sip.srtp', 'media', 'media.host', 'media.port', 'media.path',
      'media.rtpPortMin', 'media.rtpPortMax', 'stt.baseUrl',
      'stt.connectionTimeoutMs', 'stt.maxBufferedBytes', 'stt.endpointing',
      'stt.utteranceEndMs', 'tts.baseUrl', 'tts.timeoutMs', 'tts.sourceSampleRate',
      'voice.playbackPrebufferMs', 'voice.maxInboundBytes', 'voice.maxOutboundBytes',
      'voice.agent.baseUrl', 'voice.agent.think.temperature',
      'voice.agent.think.endpoint.url', 'voice.agent.think.endpoint.headers', 'providerPresets',
    ]) {
      expect(hints[path]?.advanced, path).toBe(true);
    }
    for (const path of ['sip.password', 'stt.apiKey', 'tts.apiKey'] as const) {
      expect(manifest.channelConfigs.sip.uiHints[path].sensitive).toBe(true);
    }
    expect(Object.keys(manifest.channelConfigs.sip.schema.properties)).toEqual(Object.keys(parseSipConfig({})));
    expect(manifest.configSchema.properties.tts.properties.provider.enum).toContain('elevenlabs');
    expect(manifest.configSchema.properties.voice.properties.playbackPrebufferMs.multipleOf).toBe(20);
  });
});
