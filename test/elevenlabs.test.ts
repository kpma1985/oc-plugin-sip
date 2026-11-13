import { describe, expect, it, vi } from 'vitest';
import { parseSipConfig, validateForTransport } from '../src/config.js';
import { CallSession } from '../src/media/callSession.js';
import { speakAnnouncement } from '../src/voice/voiceCall.js';
import { buildSettings } from '../src/voice/deepgramAgent.js';

function config(engine: 'openclaw' | 'deepgram-agent' = 'deepgram-agent', model = 'eleven_turbo_v2_5') {
  return parseSipConfig({
    transport: 'bridge', stt: { apiKey: 'fixture-deepgram' },
    tts: { provider: 'elevenlabs', model, voice: 'voice/id', apiKey: 'fixture-elevenlabs' },
    voice: { enabled: true, engine, agent: { prompt: 'Test', think: { model: 'gpt-4o-mini' } } },
  });
}

describe('ElevenLabs via Deepgram only', () => {
  it('rejects native use without making a request', async () => {
    const input = config('openclaw');
    expect(validateForTransport(input)).toContain('elevenlabs requires voice.engine "deepgram-agent"; native ElevenLabs TTS is disabled');
    const fetch = vi.fn();
    const call = new CallSession({ streamSid: 'test', onSend: vi.fn() });
    await expect(speakAnnouncement(call, input, 'Test', new AbortController().signal, () => true, { fetch }))
      .rejects.toThrow('Native ElevenLabs TTS is disabled');
    expect(fetch).not.toHaveBeenCalled();
    call.end('test');
  });

  it.each(['eleven_turbo_v2_5', 'eleven_v3'])('builds documented Deepgram settings for %s', model => {
    const input = config('deepgram-agent', model);
    expect(validateForTransport(input)).toEqual([]);
    expect(buildSettings(input, 'pcmu', 8000).agent).toMatchObject({
      speak: {
        provider: { type: 'eleven_labs', model_id: model },
        endpoint: {
          url: model === 'eleven_v3'
            ? 'https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid'
            : 'wss://api.elevenlabs.io/v1/text-to-speech/voice%2Fid/multi-stream-input',
          headers: { 'xi-api-key': 'fixture-elevenlabs' },
        },
      }
    });
  });

  it('requires ElevenLabs credentials and voice for the Deepgram route', () => {
    const input = config();
    delete input.tts.apiKey;
    delete input.tts.voice;
    expect(validateForTransport(input)).toEqual(expect.arrayContaining([
      'tts.apiKey is required for elevenlabs via Deepgram',
      'tts.voice is required for elevenlabs via Deepgram',
    ]));
  });
});
