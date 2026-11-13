import { describe, it, expect, vi } from 'vitest';
import { DeepgramAgentCall } from '../src/voice/deepgramAgent.js';
import { CallSession } from '../src/media/callSession.js';
import { parseSipConfig } from '../src/config.js';

describe('DeepgramAgentCall DTMF PIN Gate', () => {
  function makeSession() {
    return new CallSession({
      streamSid: 'MZpin1',
      codec: 'pcmu',
      onSend: () => {},
    });
  }

  it('blocks inbound audio until PIN is authenticated', () => {
    const config = parseSipConfig({
      inbound: {
        pin: {
          enabled: true,
          code: '4321',
          maxAttempts: 3,
        },
      },
      stt: { apiKey: 'dg-fake' },
      voice: {
        enabled: true,
        engine: 'deepgram-agent',
        agent: {
          think: { provider: 'open_ai', model: 'gpt-4o' },
          prompt: 'test',
        },
      },
    });

    const logs: string[] = [];
    const session = makeSession();
    const agent = new DeepgramAgentCall(session, config, (event) => logs.push(event));

    // Audio sent before PIN should be silently blocked
    const dummyAudio = new Uint8Array([0x55, 0x55]);
    agent.audio(dummyAudio);

    // Enter wrong PIN
    agent.dtmf('1');
    agent.dtmf('2');
    agent.dtmf('#');
    expect(logs).toContain('pin-rejected');

    // Enter correct PIN
    agent.dtmf('4');
    agent.dtmf('3');
    agent.dtmf('2');
    agent.dtmf('1');
    agent.dtmf('#');
    expect(logs).toContain('pin-accepted');

    agent.stop();
  });
});
