import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createMaskedLogger } from '../vendor/sip-bridge/src/logger/index.js';
import { createRtpHandler } from '../vendor/sip-bridge/src/rtp/rtpHandler.js';

describe('vendored RTP handler', () => {
  it('drops audio sent after dispose instead of crashing the process', async () => {
    const rtp = await createRtpHandler({
      portMin: 41000, portMax: 41100, log: createMaskedLogger([], new Writable({ write: (_chunk, _enc, done) => done() })), audioPt: 0, dtmfPt: 101, silenceByte: 0xff,
    });
    rtp.setRemote('127.0.0.1', 9);
    rtp.sendAudio(Buffer.alloc(160, 0xff));
    rtp.dispose();
    expect(() => rtp.sendAudio(Buffer.alloc(160, 0xff))).not.toThrow();
  });
});

// Direct delivery through the private receive boundary avoids timing-dependent UDP
// sleeps while still exercising the actual source learning/parser implementation.
import { vi } from 'vitest';
import { SrtpContext } from '../vendor/sip-bridge/src/srtp/srtpContext.js';
function packet(pt = 0, ssrc = 1, payload = Buffer.alloc(160, 0xff)): Buffer {
  const result = Buffer.alloc(12 + payload.length); result[0] = 0x80; result[1] = pt;
  result.writeUInt16BE(10, 2); result.writeUInt32BE(ssrc, 8); payload.copy(result, 12); return result;
}
const log = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
type Receiver = { onMessage: (buf: Buffer, remote: any) => void; remotePort: number; inboundSsrc: number | null; symmetricLearned: boolean };
const source = (port: number) => ({ address: '127.0.0.1', port, family: 'IPv4', size: 172 });

describe('RTP source learning is transactional', () => {
  it('cannot accept audio or acquire a source before setRemote', async () => {
    const rtp = await createRtpHandler({ portMin: 41200, portMax: 41300, log, audioPt: 0, dtmfPt: 101, silenceByte: 255 });
    try {
      const recv = rtp as unknown as Receiver; const audio = vi.fn(); rtp.on('audio', audio); rtp.startForwarding();
      recv.onMessage(packet(), source(9001));
      expect(audio).not.toHaveBeenCalled(); expect(recv.inboundSsrc).toBeNull(); expect(recv.symmetricLearned).toBe(false);
      rtp.setRemote('127.0.0.1', 9000); recv.onMessage(packet(), source(9001));
      expect(audio).toHaveBeenCalledTimes(1); expect(recv.remotePort).toBe(9001);
    } finally { rtp.dispose(); }
  });

  it('malformed headers, unknown PT, invalid DTMF and invalid padding cannot poison SSRC/port', async () => {
    const rtp = await createRtpHandler({ portMin: 41200, portMax: 41300, log, audioPt: 0, dtmfPt: 101, silenceByte: 255 });
    try {
      const recv = rtp as unknown as Receiver; rtp.setRemote('127.0.0.1', 9000); rtp.startForwarding();
      const invalid = [packet(99, 99), packet(101, 99, Buffer.alloc(3)), packet(101, 99, Buffer.from([99, 128, 0, 1])), packet(0, 99, Buffer.alloc(0))];
      for (const firstByte of [0x40, 0x8f, 0x90, 0xa0]) {
        const bad = packet(0, 99, Buffer.alloc(1)); bad[0] = firstByte; invalid.push(bad);
      }
      for (const bad of invalid) {
        recv.onMessage(bad, source(9002)); expect(recv.remotePort).toBe(9000); expect(recv.inboundSsrc).toBeNull(); expect(recv.symmetricLearned).toBe(false);
      }
      const audio = vi.fn(); rtp.on('audio', audio);
      const padded = packet(0, 1, Buffer.from([42, 0, 2])); padded[0] = padded[0]! | 0x20;
      recv.onMessage(padded, source(9001));
      expect(audio).toHaveBeenCalledExactlyOnceWith(Buffer.from([42]));
      recv.onMessage(packet(0, 2), source(9001)); recv.onMessage(packet(), source(9002));
      expect(audio).toHaveBeenCalledTimes(1); expect(recv.inboundSsrc).toBe(1); expect(recv.remotePort).toBe(9001);
    } finally { rtp.dispose(); }
  });

  it('SRTP auth failures cannot capture source; valid authenticated media can', async () => {
    const key = Buffer.alloc(16, 9); const salt = Buffer.alloc(14, 8);
    const rtp = await createRtpHandler({ portMin: 41200, portMax: 41300, log, audioPt: 0, dtmfPt: 101, silenceByte: 255, localSrtpKey: key, localSrtpSalt: salt, remoteSrtpKey: key, remoteSrtpSalt: salt });
    try {
      const recv = rtp as unknown as Receiver; rtp.setRemote('127.0.0.1', 9000); rtp.startForwarding();
      const encrypted = new SrtpContext(key, salt).encrypt(packet()); const forged = Buffer.from(encrypted); forged[forged.length - 1] = forged[forged.length - 1]! ^ 1;
      recv.onMessage(forged, source(9002));
      expect(recv.remotePort).toBe(9000); expect(recv.inboundSsrc).toBeNull(); expect(recv.symmetricLearned).toBe(false);
      const audio = vi.fn(); rtp.on('audio', audio); recv.onMessage(encrypted, source(9001));
      expect(audio).toHaveBeenCalledTimes(1); expect(recv.remotePort).toBe(9001); expect(recv.inboundSsrc).toBe(1);
      recv.onMessage(encrypted, source(9001)); expect(audio).toHaveBeenCalledTimes(1);
    } finally { rtp.dispose(); }
  });
});
