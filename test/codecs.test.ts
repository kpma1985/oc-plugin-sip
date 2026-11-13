import { describe, expect, it } from 'vitest';
import { CallCodec, alawDecodeSample, alawEncodeSample, codecFromFormat } from '../src/media/codecs.js';
import { CallSession } from '../src/media/callSession.js';
import { MULAW_FRAME_BYTES, TELEPHONY_SAMPLE_RATE } from '../src/media/twilioFrames.js';

describe('negotiated SIP codecs', () => {
  it('accepts only matching codec and sample rate', () => {
    expect(codecFromFormat('audio/G722', TELEPHONY_SAMPLE_RATE * 2)).toBe('g722');
    expect(codecFromFormat('audio/x-alaw', TELEPHONY_SAMPLE_RATE)).toBe('pcma');
    expect(codecFromFormat('audio/x-mulaw', TELEPHONY_SAMPLE_RATE)).toBe('pcmu');
    expect(codecFromFormat('audio/G722', TELEPHONY_SAMPLE_RATE)).toBeUndefined();
  });

  it.each(['pcmu', 'pcma', 'g722'] as const)('%s encodes and decodes one 20 ms frame', codec => {
    const media = new CallCodec(codec);
    const samples = media.sampleRate / 50;
    const pcm = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index++) pcm.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 1000 * index / media.sampleRate)), index * 2);
    const encoded = media.encode(pcm);
    expect(encoded).toHaveLength(MULAW_FRAME_BYTES);
    const decoded = media.decode(encoded);
    expect(decoded).toHaveLength(pcm.length);
    expect(media.silence()).toHaveLength(MULAW_FRAME_BYTES);
    media.reset();
    expect(media.encode(pcm)).toEqual(encoded);
  });

  it('A-law encoder stays within G.711 quantisation error over the full 16-bit range', () => {
    for (let sample = -32768; sample <= 32767; sample += 7) {
      const decoded = alawDecodeSample(alawEncodeSample(sample));
      expect(Math.abs(decoded - sample)).toBeLessThanOrEqual(Math.max(16, Math.abs(sample) / 16) + 1);
    }
  });

  it('returns codec-compatible silence after a partial frame and resets on barge-in', () => {
    const outbound: string[] = [];
    const session = new CallSession({ streamSid: 'g722', codec: 'g722', onSend: text => outbound.push(text) });
    session.activate();
    session.sendAudioChunk(Buffer.alloc(13));
    session.mark('done');
    expect(session.media.codec).toBe('g722');
    expect(session.queuedBytes).toBeGreaterThan(0);
    session.interrupt();
    expect(session.queuedBytes).toBe(0);
    expect(JSON.parse(outbound.at(-1)!).event).toBe('clear');
    session.end('done');
  });

  it('encodes G.722 silence instead of sending zero-filled RTP payloads', () => {
    const codec = new CallCodec('g722');
    const decoder = new CallCodec('g722');
    const noise = decoder.decode(Buffer.alloc(MULAW_FRAME_BYTES));
    decoder.reset();
    const silence = decoder.decode(codec.silence());
    const peak = (pcm: Buffer) => {
      let maximum = 0;
      for (let index = 0; index < pcm.length; index += 2) {
        maximum = Math.max(maximum, Math.abs(pcm.readInt16LE(index)));
      }
      return maximum;
    };
    expect(peak(noise)).toBeGreaterThan(20000);
    expect(peak(silence)).toBeLessThan(100);
  });
});
