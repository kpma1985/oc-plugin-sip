import { G722Decoder, G722Encoder } from 'g722-spandsp';
import { MULAW_FRAME_BYTES, TELEPHONY_SAMPLE_RATE } from './twilioFrames.js';
import { mulawToPcm16, pcm16ToMulaw } from './ulaw.js';

export type AudioCodec = 'pcmu' | 'pcma' | 'g722';

export function codecFromFormat(encoding: string, sampleRate: number): AudioCodec | undefined {
  if (sampleRate === TELEPHONY_SAMPLE_RATE && encoding === 'audio/x-mulaw') return 'pcmu';
  if (sampleRate === TELEPHONY_SAMPLE_RATE && encoding === 'audio/x-alaw') return 'pcma';
  if (sampleRate === TELEPHONY_SAMPLE_RATE * 2 && encoding === 'audio/G722') return 'g722';
  return undefined;
}

export function alawDecodeSample(byte: number): number {
  const value = byte ^ 0x55;
  const segment = (value & 0x70) >> 4;
  let sample = (value & 15) << 4;
  sample += segment === 0 ? 8 : 0x108;
  if (segment > 1) sample <<= segment - 1;
  return value & 0x80 ? sample : -sample;
}

export function alawEncodeSample(sample: number): number {
  let value = sample;
  const mask = value >= 0 ? 0xd5 : 0x55;
  if (value < 0) value = -value - 1;
  value = Math.min(value, 0x7fff);
  let segment = 0;
  for (let limit = 0xff; value > limit && segment < 7; limit = (limit << 1) | 1) segment++;
  const quantized = segment < 2 ? (value >> 4) & 15 : (value >> (segment + 3)) & 15;
  return ((segment << 4) | quantized) ^ mask;
}

export function alawToPcm16(data: Uint8Array): Buffer {
  const result = Buffer.allocUnsafe(data.length * 2);
  for (let index = 0; index < data.length; index++) result.writeInt16LE(alawDecodeSample(data[index]!), index * 2);
  return result;
}

export function pcm16ToAlaw(data: Uint8Array): Buffer {
  if (data.length % 2) throw new Error('Incomplete PCM sample');
  const source = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const result = Buffer.allocUnsafe(data.length / 2);
  for (let index = 0; index < result.length; index++) result[index] = alawEncodeSample(source.readInt16LE(index * 2));
  return result;
}

export class CallCodec {
  readonly sampleRate: number;
  readonly frameBytes = MULAW_FRAME_BYTES;
  private readonly encoder?: G722Encoder;
  private readonly decoder?: G722Decoder;

  constructor(readonly codec: AudioCodec = 'pcmu') {
    this.sampleRate = codec === 'g722' ? TELEPHONY_SAMPLE_RATE * 2 : TELEPHONY_SAMPLE_RATE;
    if (codec === 'g722') {
      this.encoder = new G722Encoder();
      this.decoder = new G722Decoder();
    }
  }

  decode(data: Uint8Array): Buffer {
    if (this.codec === 'g722') return this.decoder!.decode(Buffer.from(data));
    if (this.codec === 'pcma') return alawToPcm16(data);
    return Buffer.from(mulawToPcm16(data));
  }

  encode(data: Uint8Array): Buffer {
    if (data.length % 2) throw new Error('Incomplete PCM sample');
    if (this.codec === 'g722') {
      if (data.length % 4) throw new Error('Incomplete G.722 sample pair');
      return this.encoder!.encode(Buffer.from(data));
    }
    if (this.codec === 'pcma') return pcm16ToAlaw(data);
    return Buffer.from(pcm16ToMulaw(data));
  }

  silence(): Buffer {
    if (this.codec === 'pcmu') return Buffer.alloc(this.frameBytes, 0xff);
    if (this.codec === 'pcma') return Buffer.alloc(this.frameBytes, 0xd5);
    return this.encode(Buffer.alloc(this.sampleRate / 50 * 2));
  }

  reset(): void { this.encoder?.reset(); this.decoder?.reset(); }
}
