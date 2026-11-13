/**
 * G.711 mu-law codec (ITU-T G.711), used by SIP/PSTN telephony and by the
 * Twilio Media Streams wire format (`audio/x-mulaw`, 8000 Hz).
 */
const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;
const MULAW_EXP_LUT = [0, 132, 396, 924, 1980, 4092, 8316, 16764];

/** Decode one mu-law byte to a signed 16-bit PCM sample. */
export function mulawDecodeSample(byte: number): number {
  const u = ~byte & 0xff;
  let sample = ((u & 0x0f) << 3) + MULAW_BIAS;
  sample <<= (u & 0x70) >> 4;
  sample -= MULAW_BIAS;
  const signed = (u & 0x80) !== 0 ? -sample : sample;
  return signed === 0 ? 0 : signed; // normalise -0, Object.is-visible in tests
}

/** Encode one signed 16-bit PCM sample to a mu-law byte. */
export function mulawEncodeSample(sample: number): number {
  let value = sample;
  let sign = 0;
  if (value < 0) {
    value = -value;
    sign = 0x80;
  }
  if (value > MULAW_CLIP) value = MULAW_CLIP;
  value += MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (value & mask) === 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Decode a mu-law byte buffer to little-endian PCM16. */
export function mulawToPcm16(mulaw: Uint8Array): Uint8Array {
  const out = new Uint8Array(mulaw.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < mulaw.length; i += 1) {
    view.setInt16(i * 2, mulawDecodeSample(mulaw[i] as number), true);
  }
  return out;
}

/** Encode little-endian PCM16 to mu-law. */
export function pcm16ToMulaw(pcm: Uint8Array): Uint8Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const out = new Uint8Array(Math.floor(pcm.byteLength / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = mulawEncodeSample(view.getInt16(i * 2, true));
  }
  return out;
}

/** Reference table variant, kept for tests and tooling that expect G.711 tables. */
export function mulawDecodeTable(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u & 0x70) >> 4;
  const mantissa = u & 0x0f;
  const sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  const signed = sample - MULAW_BIAS;
  const value = sign !== 0 ? -signed : signed;
  return value === 0 ? 0 : value;
}

export const MULAW_DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = mulawDecodeTable(i);
  return table;
})();

void MULAW_EXP_LUT;
