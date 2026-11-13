import { describe, expect, it } from 'vitest';
import { decodeMediaPayload, parseMediaStreamsFrame } from '../src/media/twilioFrames.js';

const parse = (frame: unknown) => parseMediaStreamsFrame(JSON.stringify(frame));
const start = (metadata: unknown) => ({ event: 'start', streamSid: 'MZ1', start: metadata });
const invalidTypes = [42, true, false, [], ['+4930123'], {}, { number: '+4930123' }, null];

describe('untrusted media input', () => {
  it.each(['From', 'from', 'caller', 'To', 'to', 'dialed', 'arbitrary'])(
    'rejects non-string %s metadata before session creation', key => {
      for (const value of invalidTypes) {
        expect(parse(start({ customParameters: { [key]: value } }))).toBeNull();
      }
    },
  );
  it('requires object-shaped start, custom parameters, and formats when present', () => {
    for (const value of [null, [], '', 0, false]) {
      expect(parse(start(value))).toBeNull();
      expect(parse(start({ customParameters: value }))).toBeNull();
      expect(parse(start({ mediaFormat: value }))).toBeNull();
    }
  });
  it('validates identifiers without coercion, including nested identifiers', () => {
    for (const value of [...invalidTypes, '', '   ', 'x'.repeat(257)]) {
      expect(parse({ ...start({}), streamSid: value })).toBeNull();
      expect(parse(start({ callSid: value }))).toBeNull();
      expect(parse(start({ streamSid: value }))).toBeNull();
    }
    expect(parse(start({ streamSid: 'different' }))).toBeNull();
    expect(parse(start({ accountSid: null }))).toBeNull();
  });
  it('bounds custom parameter count, names, values, and caller/dialed strings', () => {
    for (const customParameters of [
      { From: 'x'.repeat(2049) }, { To: 'x'.repeat(2049) },
      { ['x'.repeat(257)]: 'v' }, { '': 'v' },
      Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`k${i}`, 'v'])),
    ]) expect(parse(start({ customParameters }))).toBeNull();
  });
  it('validates exact media format field types without restricting supported codecs', () => {
    for (const mediaFormat of [
      {}, { encoding: 'audio/x-mulaw' }, { encoding: 1, sampleRate: 8000 },
      { encoding: 'audio/x-mulaw', sampleRate: '8000' },
      { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: '1' },
      { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: null },
      { encoding: 'audio/x-mulaw', sampleRate: 0 },
      { encoding: 'audio/x-mulaw', sampleRate: 8000.5 },
    ]) expect(parse(start({ mediaFormat }))).toBeNull();
    for (const [encoding, sampleRate] of [['audio/x-mulaw', 8000], ['audio/x-alaw', 8000], ['audio/G722', 16000]]) {
      const frame = start({ mediaFormat: { encoding, sampleRate, channels: 1 } });
      expect(parse(frame)).toEqual(frame);
    }
  });
  it('validates optional tracks and connected metadata', () => {
    for (const tracks of [null, {}, 'inbound', [1], ['invalid'], ['inbound', 'outbound', 'inbound']]) {
      expect(parse(start({ tracks }))).toBeNull();
    }
    for (const field of ['protocol', 'version', 'sequenceNumber']) {
      for (const value of [null, [], {}, 1, true, '', 'x'.repeat(257)]) {
        expect(parse({ event: 'connected', [field]: value })).toBeNull();
      }
    }
  });
  it('rejects malformed nested control events and optional fields', () => {
    for (const event of ['media', 'mark', 'dtmf', 'stop']) {
      for (const value of [null, [], '', 42, true]) {
        expect(parse({ event, streamSid: 'MZ1', [event]: value })).toBeNull();
      }
    }
    for (const nested of [
      { event: 'media', media: { payload: 'AA==', timestamp: 1 } },
      { event: 'media', media: { payload: 'AA==', chunk: null } },
      { event: 'media', media: { payload: 'AA==', track: {} } },
      { event: 'mark', mark: { name: '' } },
      { event: 'mark', mark: { name: 'x'.repeat(257) } },
      { event: 'dtmf', dtmf: { digit: 1 } },
      { event: 'dtmf', dtmf: { digit: '12' } },
      { event: 'dtmf', dtmf: { digit: '7', track: [] } },
      { event: 'stop', stop: { callSid: {} } },
      { event: 'stop', stop: { accountSid: false } },
    ]) expect(parse({ streamSid: 'MZ1', ...nested })).toBeNull();
  });
  it('rejects invalid or oversized base64 and frames before decoding', () => {
    for (const payload of [null, {}, 42, '!', 'A', 'AA=', 'A===', '=AAA', 'AA==junk', 'AA==\n', '__8=', 'A'.repeat(65_540)]) {
      expect(parse({ event: 'media', streamSid: 'MZ1', media: { payload } })).toBeNull();
    }
    expect(parse(start({ unused: 'x'.repeat(262_144) }))).toBeNull();
    for (const payload of ['', 'AA==', 'AA', 'AAA=', 'AAA', 'AAAA']) {
      const frame = { event: 'media', streamSid: 'MZ1', media: { payload } };
      const parsed = parse(frame);
      expect(parsed).toEqual(frame);
      if (parsed?.event === 'media') expect(() => decodeMediaPayload(parsed)).not.toThrow();
    }
  });
  it('preserves valid Twilio, embedded SIP, and legacy minimal frames', () => {
    for (const frame of [
      { event: 'start', streamSid: 'MZ1' }, start({}),
      start({ streamSid: 'MZ1', accountSid: '', callSid: 'sip-call-id', tracks: ['inbound', 'outbound'],
        customParameters: { From: 'sip:+4930123@example.org', To: '+4930456', sipCallId: 'opaque', extra: '' },
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 } }),
      { event: 'connected', protocol: 'Call', version: '1.0.0' },
      { event: 'mark', streamSid: 'MZ1', mark: { name: 'tts-1' } },
      { event: 'dtmf', streamSid: 'MZ1', dtmf: { digit: '#', track: 'inbound_track' } },
      { event: 'clear', streamSid: 'MZ1' }, { event: 'stop', streamSid: 'MZ1' },
      { event: 'stop', streamSid: 'MZ1', stop: { accountSid: '', callSid: 'CA1' } },
    ]) expect(parse(frame)).toEqual(frame);
  });
  it('never throws for a deterministic adversarial JSON corpus', () => {
    const values: unknown[] = [null, false, true, 0, 42, '', 'x', [], {}, [null], { trim: 1 }, { payload: null }];
    for (const value of values) {
      expect(() => parse(value)).not.toThrow();
      for (const event of ['start', 'media', 'mark', 'dtmf', 'stop', 'connected', 'clear', null, {}]) {
        expect(() => parse({ event, streamSid: 'MZ1', start: value, media: value, mark: value, dtmf: value, stop: value })).not.toThrow();
      }
    }
    for (const raw of ['{', '[', 'null', '[]', 'true', '1', '"text"', '\u0000', '['.repeat(5000) + '0' + ']'.repeat(5000)]) {
      expect(() => parseMediaStreamsFrame(raw)).not.toThrow();
      expect(parseMediaStreamsFrame(raw)).toBeNull();
    }
    let seed = 0x1337;
    for (let i = 0; i < 1000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = values[seed % values.length];
      const key = ['From', 'To', 'from', 'to', 'caller', 'dialed'][seed % 6]!;
      expect(() => parse(start({ customParameters: { [key]: value }, mediaFormat: value }))).not.toThrow();
    }
  });
});
