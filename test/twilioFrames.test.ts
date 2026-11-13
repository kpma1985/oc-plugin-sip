import { describe, expect, it } from 'vitest';

import {
  MULAW_FRAME_BYTES,
  buildClearFrame,
  buildMarkFrame,
  buildMediaFrame,
  decodeMediaPayload,
  frameMulaw,
  parseMediaStreamsFrame,
} from '../src/media/twilioFrames.js';

describe('Twilio Media Streams frames', () => {
  it('parses every event type the bridge emits', () => {
    expect(parseMediaStreamsFrame('{"event":"connected"}')?.event).toBe('connected');
    expect(parseMediaStreamsFrame('{"event":"start","streamSid":"MZ1"}')?.event).toBe('start');
    expect(parseMediaStreamsFrame('{"event":"media","streamSid":"MZ1","media":{"payload":"AA=="}}')?.event).toBe('media');
    expect(parseMediaStreamsFrame('{"event":"mark","streamSid":"MZ1","mark":{"name":"tts-1"}}')?.event).toBe('mark');
    expect(parseMediaStreamsFrame('{"event":"clear","streamSid":"MZ1"}')?.event).toBe('clear');
    expect(parseMediaStreamsFrame('{"event":"dtmf","streamSid":"MZ1","dtmf":{"digit":"1"}}')?.event).toBe('dtmf');
    expect(parseMediaStreamsFrame('{"event":"stop","streamSid":"MZ1"}')?.event).toBe('stop');
  });

  it('ignores malformed and unknown frames', () => {
    expect(parseMediaStreamsFrame('not json')).toBeNull();
    expect(parseMediaStreamsFrame('[]')).toBeNull();
    expect(parseMediaStreamsFrame('{"event":"nope"}')).toBeNull();
  });

  it.each(['media', 'mark', 'dtmf'])('rejects malformed %s fields', event => {
    for (const value of [undefined, null, [], {}, { payload: 123, name: 123, digit: 123 }]) {
      expect(parseMediaStreamsFrame(JSON.stringify({ event, streamSid: 'MZ1', [event]: value }))).toBeNull();
    }
  });

  it.each(['start', 'media', 'mark', 'clear', 'dtmf', 'stop'])('rejects missing or invalid stream ID for %s', event => {
    for (const streamSid of [undefined, null, '', 123]) {
      expect(parseMediaStreamsFrame(JSON.stringify({ event, streamSid }))).toBeNull();
    }
  });

  it('round-trips mu-law payloads through base64', () => {
    const audio = new Uint8Array(MULAW_FRAME_BYTES);
    for (let i = 0; i < audio.length; i += 1) audio[i] = (i * 7) & 0xff;
    const frame = buildMediaFrame('MZ1', audio);
    const parsed = parseMediaStreamsFrame(frame);
    if (parsed?.event !== 'media') throw new Error('expected media event');
    expect(parsed.streamSid).toBe('MZ1');
    expect(Array.from(decodeMediaPayload(parsed))).toEqual(Array.from(audio));
  });

  it('builds mark and clear control frames', () => {
    expect(JSON.parse(buildMarkFrame('MZ1', 'tts-1'))).toEqual({ event: 'mark', streamSid: 'MZ1', mark: { name: 'tts-1' } });
    expect(JSON.parse(buildClearFrame('MZ1'))).toEqual({ event: 'clear', streamSid: 'MZ1' });
  });

  it('frames audio into 20 ms chunks with a short tail', () => {
    const audio = new Uint8Array(MULAW_FRAME_BYTES * 3 + 40);
    const frames = frameMulaw(audio);
    expect(frames).toHaveLength(4);
    expect(frames[0]?.length).toBe(MULAW_FRAME_BYTES);
    expect(frames[3]?.length).toBe(40);
  });
});
