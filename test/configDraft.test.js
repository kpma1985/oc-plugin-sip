import { expect, it } from 'vitest';
import { mergeSelectionPatches, selection, selectionError } from '../src/ui/configDraft.js';

it('resolves explicit channel selections before legacy settings', () => {
  const config = {
    channels: { sip: { voice: { engine: 'deepgram-agent' } } },
    plugins: { entries: { sip: { config: { voice: { engine: 'openclaw' } } } } },
  };
  expect(selection(config, 'voice', 'engine', 'openclaw')).toBe('deepgram-agent');
  expect(selection(config, 'sip', 'preset', 'sipgate')).toBe('sipgate');
});

it('patches leaves without sending secrets or adjacent settings', () => {
  expect(mergeSelectionPatches({}, [
    ['voice', 'engine', 'openclaw'], ['sip', 'preset', 'sipgate'],
  ])).toEqual({
    channels: {
      sip: {
        voice: { engine: 'openclaw' }, sip: { preset: 'sipgate' },
      }
    }
  });
});

it('removes Standard agent override from both ownership paths', () => {
  const config = {
    channels: { sip: { inbound: { agentId: 'channel' } } },
    plugins: { entries: { sip: { config: { inbound: { agentId: 'legacy' } } } } },
  };
  expect(mergeSelectionPatches(config, [['inbound', 'agentId', '']])).toEqual({
    channels: { sip: { inbound: { agentId: null } } },
    plugins: { entries: { sip: { config: { inbound: { agentId: null } } } } },
  });
  expect(mergeSelectionPatches({ channels: { sip: { inbound: { agentId: 'channel' } } } },
    [['inbound', 'agentId', '']])).toEqual({ channels: { sip: { inbound: { agentId: null } } } });
});

it('rejects invalid active voice engine combinations before saving', () => {
  const config = { channels: { sip: { voice: { enabled: true }, tts: { provider: 'elevenlabs' } } } };
  expect(selectionError(config, [['voice', 'engine', 'openclaw']])).toMatch(/ElevenLabs/);
  expect(selectionError(config, [['voice', 'engine', 'deepgram-agent']])).toMatch(/prompt/);
  expect(selectionError({ channels: { sip: { voice: { enabled: false } } } },
    [['voice', 'engine', 'deepgram-agent']])).toBeNull();
  const partial = {
    plugins: {
      entries: {
        sip: {
          config: {
            stt: { apiKey: 'masked' }, voice: { agent: { prompt: 'existing', think: { model: 'existing' } } },
            tts: { model: 'existing' },
          }
        }
      }
    },
    channels: { sip: { voice: { enabled: true, agent: { tools: true } } } },
  };
  expect(selectionError(partial, [['voice', 'engine', 'deepgram-agent']])).toBeNull();
});
