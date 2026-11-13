import { describe, expect, it } from 'vitest';

import { MULAW_DECODE_TABLE, mulawDecodeSample, mulawEncodeSample, mulawToPcm16, pcm16ToMulaw } from '../src/media/ulaw.js';

describe('G.711 mu-law', () => {
  it('decodes silence and extremes', () => {
    expect(mulawDecodeSample(0xff)).toBe(0);
    expect(mulawDecodeSample(0x7f)).toBe(0);
    expect(mulawDecodeSample(0x00)).toBe(-32124);
    expect(mulawDecodeSample(0x80)).toBe(32124);
  });

  it('matches the lookup table for every byte', () => {
    for (let byte = 0; byte < 256; byte += 1) {
      expect(MULAW_DECODE_TABLE[byte]).toBe(mulawDecodeSample(byte));
    }
  });

  it('round-trips PCM16 within the codec quantisation error', () => {
    const pcm = new Int16Array(2048);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.round(Math.sin(i / 12) * 20000);
    const bytes = pcm16ToMulaw(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    const back = mulawToPcm16(bytes);
    expect(back.length).toBe(pcm.length * 2);

    const view = new DataView(back.buffer);
    for (let i = 0; i < pcm.length; i += 1) {
      const decoded = view.getInt16(i * 2, true);
      const reference = pcm[i] as number;
      // mu-law is lossy: ~2% of full scale for large samples, absolute for small ones.
      expect(Math.abs(decoded - reference)).toBeLessThanOrEqual(Math.max(64, Math.abs(reference) / 20));
    }
  });

  it('encodes sign symmetrically (mu-law stores the sign bit inverted)', () => {
    expect(mulawEncodeSample(1000) & 0x80).toBe(0x80);
    expect(mulawEncodeSample(-1000) & 0x80).toBe(0);
    expect(mulawEncodeSample(0)).toBe(0xff);
    expect(mulawEncodeSample(-1)).toBe(0x7f);
  });
});
