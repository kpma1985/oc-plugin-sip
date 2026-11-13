import { describe, expect, it } from 'vitest';
import manifest from '../openclaw.plugin.json' with { type: 'json' };
import { parseSipConfig, validateForTransport } from '../src/config.js';
import { resolveSipConfig } from '../src/channelConfig.js';
import { sttModelPresets, ttsModelPresets } from '../src/voice/providerPresets.js';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { speakAnnouncement } from '../src/voice/voiceCall.js';
import { CallSession } from '../src/media/callSession.js';

describe('provider presets', () => {
  it('resolves SIP presets without overwriting explicit trunk settings', () => {
    expect(parseSipConfig({}).sip).toMatchObject({ preset: 'sipgate', domain: 'sipconnect.sipgate.de', registrar: 'sipconnect.sipgate.de' });
    const trunk = { user: 'fixture', password: 'fixture-only', domain: 'sip.example', registrar: 'registrar.example' };
    for (const preset of ['sipgate', 'custom'] as const) {
      expect(parseSipConfig({ sip: { ...trunk, preset } }).sip).toMatchObject({ ...trunk, preset });
    }
    expect(() => parseSipConfig({ sip: { preset: 'custom' } })).toThrow('sip.domain is required');
    expect(() => parseSipConfig({ sip: { preset: 'custom', domain: 'sip.example' } })).toThrow('sip.registrar is required');
    expect(() => parseSipConfig({ sip: { preset: 'other' } })).toThrow();
  });
  it('selects built-in endpoints and models without inventing custom deployment IDs', () => {
    const config = parseSipConfig({});
    expect(config.stt).toMatchObject({ model: 'nova-3', baseUrl: 'wss://api.deepgram.com' });
    expect(config.tts).toMatchObject({ model: 'aura-2-viktoria-de', baseUrl: 'https://api.deepgram.com' });
    expect(parseSipConfig({ tts: { provider: 'elevenlabs' } }).tts).toMatchObject({
      model: 'eleven_multilingual_v2', baseUrl: 'https://api.elevenlabs.io',
    });
    const custom = parseSipConfig({ voice: { enabled: true }, tts: { provider: 'custom' } });
    expect(custom.tts.baseUrl).toBeUndefined();
    expect(custom.tts.model).toBeUndefined();
    expect(validateForTransport(custom)).toEqual(expect.arrayContaining([
      'tts.baseUrl is required for custom', 'tts.model is required for custom',
    ]));
  });

  it('merges configurable defaults and keeps explicit custom overrides', () => {
    const input = {
      providerPresets: {
        stt: { deepgram: { model: 'custom-stt' } },
        tts: { elevenlabs: { baseUrl: 'https://tts.example', model: 'custom-tts' } }
      },
      tts: { provider: 'elevenlabs', model: 'explicit-model', baseUrl: 'https://explicit.example' }
    };
    const snapshot = structuredClone(input);
    const config = parseSipConfig(input);
    expect(config.stt).toMatchObject({ model: 'custom-stt', baseUrl: 'wss://api.deepgram.com' });
    expect(config.tts).toMatchObject({ model: 'explicit-model', baseUrl: 'https://explicit.example' });
    expect(input).toEqual(snapshot);
    expect(parseSipConfig({
      providerPresets: input.providerPresets,
      tts: { provider: 'elevenlabs' }
    }).tts.model).toBe('custom-tts');
    expect(parseSipConfig({
      providerPresets: {
        stt: {
          deepgram: {
            model: undefined, baseUrl: undefined,
          }
        }
      }
    }).stt).toMatchObject({ model: 'nova-3', baseUrl: 'wss://api.deepgram.com' });
  });

  it('uses selected preset URL and custom model in actual TTS requests', async () => {
    for (const provider of ['deepgram', 'custom'] as const) {
      const config = parseSipConfig({
        tts: { provider, apiKey: 'fixture-only', voice: 'fixture-voice', sourceSampleRate: 24000 },
        providerPresets: { tts: { [provider]: { baseUrl: 'https://proxy.example/prefix/', model: 'custom-model' } } }
      });
      const session = new CallSession({ streamSid: 'preset-test', onSend: () => { } });
      session.activate();
      let url: URL | undefined;
      let body: Record<string, unknown> | undefined;
      try {
        await speakAnnouncement(session, config, 'Test.', new AbortController().signal, () => true, {
          fetch: async (input, init) => {
            url = new URL(String(input)); body = JSON.parse(String(init?.body));
            return new Response(new Uint8Array(provider === 'custom' ? 960 : 160), {
              headers: {
                'content-type': provider === 'deepgram' ? 'audio/mulaw' : 'application/octet-stream',
              }
            });
          },
        });
        expect(url?.origin).toBe('https://proxy.example');
        expect(url?.pathname).toBe(`/prefix/${provider === 'deepgram' ? 'v1/speak' : 'v1/audio/speech'}`);
        if (provider !== 'deepgram') expect(body?.model).toBe('custom-model');
      } finally { session.end('test'); }
    }
  });

  it('merges channel preset leaves without erasing legacy siblings', () => {
    const config = resolveSipConfig({
      channels: {
        sip: {
          providerPresets: { tts: { custom: { model: 'channel-deployment' } } },
        }
      }, plugins: {
        entries: {
          sip: {
            config: {
              tts: { provider: 'custom' }, providerPresets: {
                tts: {
                  custom: { baseUrl: 'https://proxy.example', model: 'legacy-deployment' },
                  elevenlabs: { model: 'custom-eleven' },
                }
              },
            }
          }
        }
      }
    } as unknown as OpenClawConfig);
    expect(config.tts).toMatchObject({ model: 'channel-deployment', baseUrl: 'https://proxy.example' });
    expect(config.providerPresets.tts.elevenlabs?.model).toBe('custom-eleven');
  });

  it('rejects unsafe protocols, empty models, unknown keys and credentials inside presets', () => {
    for (const input of [
      { stt: { baseUrl: 'ws://stt.example' } },
      { providerPresets: { stt: { deepgram: { baseUrl: 'https://stt.example' } } } },
      { providerPresets: { tts: { custom: { baseUrl: 'http://tts.example' } } } },
      { providerPresets: { tts: { custom: { apiKey: 'fixture-only' } } } },
      { stt: { model: '' } }, { tts: { model: '' } },
    ]) expect(() => parseSipConfig(input)).toThrow('invalid sip plugin config');
  });

  it('keeps manifest schemas equal, suggestions nonrestrictive and preset shape aligned', () => {
    expect(manifest.configSchema).toEqual(manifest.channelConfigs.sip.schema);
    const props = manifest.configSchema.properties;
    expect(props.stt.properties.model.examples).toEqual([...sttModelPresets]);
    expect(props.tts.properties.model.examples).toEqual([...ttsModelPresets]);
    for (const model of [props.stt.properties.model, props.tts.properties.model]) {
      expect(model).not.toHaveProperty('enum');
      expect(model).not.toHaveProperty('oneOf');
    }
    expect(props.stt.properties.baseUrl.pattern).toBe('^wss://');
    const presets = props.providerPresets.properties;
    expect(Object.keys(presets.stt.properties)).toEqual(['deepgram']);
    expect(Object.keys(presets.tts.properties).sort()).toEqual(['custom', 'deepgram', 'elevenlabs']);
    for (const schema of [presets.stt.properties.deepgram, ...Object.values(presets.tts.properties)]) {
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties)).toEqual(['baseUrl', 'model']);
    }
    expect(parseSipConfig({ stt: { model: 'unlisted-stt' }, tts: { model: 'unlisted-tts' } }).tts.model).toBe('unlisted-tts');
  });
});
