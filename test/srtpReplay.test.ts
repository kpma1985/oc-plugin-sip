import { describe, it, expect } from 'vitest';
import { SrtpContext } from '../vendor/sip-bridge/src/srtp/srtpContext.js';

const masterKey = Buffer.alloc(16, 0x11);
const masterSalt = Buffer.alloc(14, 0x22);

function rtpPacket(seq: number, ssrc = 0x12345678, payload = Buffer.from('payload')): Buffer {
  const pkt = Buffer.alloc(12 + payload.length);
  pkt[0] = 0x80;
  pkt[1] = 0x00;
  pkt.writeUInt16BE(seq, 2);
  pkt.writeUInt32BE(1000, 4);
  pkt.writeUInt32BE(ssrc, 8);
  payload.copy(pkt, 12);
  return pkt;
}

describe('SrtpContext', () => {
  it('round-trips sequential packets', () => {
    const enc = new SrtpContext(masterKey, masterSalt);
    const dec = new SrtpContext(masterKey, masterSalt);
    const plain = rtpPacket(1);
    expect(dec.decrypt(enc.encrypt(plain)).equals(plain)).toBe(true);
  });

  it('rejects a replayed packet inside the window', () => {
    const enc = new SrtpContext(masterKey, masterSalt);
    const dec = new SrtpContext(masterKey, masterSalt);
    const srtp = enc.encrypt(rtpPacket(1));
    expect(dec.decrypt(srtp).length).toBeGreaterThan(0);
    expect(() => dec.decrypt(srtp)).toThrow(/replayed/i);
  });

  it('accepts out-of-order packets within the 64-packet window', () => {
    const enc = new SrtpContext(masterKey, masterSalt);
    const dec = new SrtpContext(masterKey, masterSalt);
    const p1 = enc.encrypt(rtpPacket(10));
    const p2 = enc.encrypt(rtpPacket(12));
    const p3 = enc.encrypt(rtpPacket(11));
    expect(dec.decrypt(p1).length).toBeGreaterThan(0);
    expect(dec.decrypt(p2).length).toBeGreaterThan(0);
    expect(dec.decrypt(p3).length).toBeGreaterThan(0);
  });

  it('rejects packets older than the 64-packet window', () => {
    const enc = new SrtpContext(masterKey, masterSalt);
    const dec = new SrtpContext(masterKey, masterSalt);
    const old = enc.encrypt(rtpPacket(1));
    const newest = enc.encrypt(rtpPacket(200));
    expect(dec.decrypt(newest).length).toBeGreaterThan(0);
    expect(() => dec.decrypt(old)).toThrow(/replayed/i);
  });

  it('still rejects a tampered auth tag before replay checks', () => {
    const enc = new SrtpContext(masterKey, masterSalt);
    const dec = new SrtpContext(masterKey, masterSalt);
    const srtp = enc.encrypt(rtpPacket(5));
    const tampered = Buffer.from(srtp);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => dec.decrypt(tampered)).toThrow(/authentication tag/i);
  });
});

describe('SRTP RFC 3711 interoperability and adversarial state', () => {
  it('derives RFC 3711 Appendix B.3 session keys (not merely self-roundtrips)', () => {
    const ctx = new SrtpContext(Buffer.from('e1f97a0d3e018be0d64fa32c06de4139', 'hex'), Buffer.from('0ec675ad498afeebb6960b3aabe6', 'hex'));
    const keys = ctx as unknown as { encKey: Buffer; authKey: Buffer; saltKey: Buffer };
    expect(keys.encKey.toString('hex')).toBe('c61e7a93744f39ee10734afe3ff7a087');
    expect(keys.authKey.toString('hex')).toBe('cebe321f6ff7716b6fd4ab49af256a156d38baa4');
    expect(keys.saltKey.toString('hex')).toBe('30cbbc08863d8c85d49db34a9ae1');
  });

  it('matches RFC 3711 Appendix B.2 AES-CM keystream / IV placement', () => {
    const ctx = new SrtpContext(masterKey, masterSalt);
    // Appendix B.2 supplies session keys directly rather than master keys.
    const keys = ctx as unknown as { encKey: Buffer; saltKey: Buffer };
    keys.encKey = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
    keys.saltKey = Buffer.from('f0f1f2f3f4f5f6f7f8f9fafbfcfd', 'hex');
    const encrypted = ctx.encrypt(rtpPacket(0, 0, Buffer.alloc(32)));
    expect(encrypted.subarray(12, 44).toString('hex')).toBe('e03ead0935c95e80e166b16dd92b4eb4d23513162b02d0f72a43a2fe4a5f97ab');
  });

  it('handles true wrap, rejects forged wrap, accepts late pre-wrap packets without rolling back', () => {
    const enc = new SrtpContext(masterKey, masterSalt);
    const dec = new SrtpContext(masterKey, masterSalt);
    const late = enc.encrypt(rtpPacket(65534));
    dec.decrypt(enc.encrypt(rtpPacket(65535)));
    const next = enc.encrypt(rtpPacket(0));
    const forged = Buffer.from(next); forged[forged.length - 1] = forged[forged.length - 1]! ^ 1;
    expect(() => dec.decrypt(forged)).toThrow(/authentication/);
    expect(dec.decrypt(next)).toEqual(rtpPacket(0));
    expect(dec.decrypt(late)).toEqual(rtpPacket(65534));
    expect(dec.decrypt(enc.encrypt(rtpPacket(1)))).toEqual(rtpPacket(1));
    expect(() => dec.decrypt(late)).toThrow(/replayed/);
  });

  it('keeps replay bitmap at 64 bits during a long sequential stream', () => {
    const enc = new SrtpContext(masterKey, masterSalt);
    const dec = new SrtpContext(masterKey, masterSalt);
    for (let i = 0; i < 4096; i++) dec.decrypt(enc.encrypt(rtpPacket(i)));
    expect((dec as unknown as { replayWindow: bigint }).replayWindow).toBe((1n << 64n) - 1n);
  });

  it('rejects malformed version, CSRC, extension and plaintext padding', () => {
    for (const firstByte of [0x40, 0x8f, 0x90, 0xa0]) {
      const pkt = rtpPacket(1, 1, Buffer.from([0])); pkt[0] = firstByte;
      const enc = new SrtpContext(masterKey, masterSalt);
      expect(() => enc.encrypt(pkt)).toThrow(/Malformed/);
      expect(() => new SrtpContext(masterKey, masterSalt).decrypt(Buffer.concat([pkt, Buffer.alloc(10)]))).toThrow();
    }
  });
});

it('authenticated invalid padding does not burn replay/sequence state', async () => {
  const { createHmac } = await import('node:crypto');
  const enc = new SrtpContext(masterKey, masterSalt); const dec = new SrtpContext(masterKey, masterSalt);
  const valid = enc.encrypt(rtpPacket(65535, 1, Buffer.from([0])));
  // Set P on an encrypted zero byte, then authentically sign it. The decrypted
  // pad count is zero, so this must fail even with a correct authentication tag.
  const malformed = Buffer.from(valid); malformed[0] = malformed[0]! | 0x20;
  const authKey = (enc as unknown as { authKey: Buffer }).authKey;
  createHmac('sha1', authKey).update(malformed.subarray(0, -10)).update(Buffer.alloc(4)).digest().copy(malformed, malformed.length - 10, 0, 10);
  expect(() => dec.decrypt(malformed)).toThrow(/padding/);
  expect(dec.decrypt(valid)).toEqual(rtpPacket(65535, 1, Buffer.from([0])));
  expect(dec.decrypt(enc.encrypt(rtpPacket(0)))).toEqual(rtpPacket(0));
});
