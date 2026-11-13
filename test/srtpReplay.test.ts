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
