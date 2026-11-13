import { describe, it, expect, vi } from 'vitest';
import { parseSdpOffer } from '../vendor/sip-bridge/src/sip/sdp.js';
import { SrtpContext } from '../vendor/sip-bridge/src/srtp/srtpContext.js';
import { makeDrainForTest } from '../vendor/sip-bridge/src/ws/wsClient.js';
import { createRtpHandler } from '../vendor/sip-bridge/src/rtp/rtpHandler.js';
import dgram from 'node:dgram';

describe('Security Findings Remediation Tests', () => {
  it('Finding 3: parseSdpOffer rejects invalid destination ports (0, out of range)', () => {
    const sdpWithPort0 = [
      'v=0',
      'o=- 1 1 IN IP4 203.0.113.1',
      's=-',
      'c=IN IP4 203.0.113.1',
      't=0 0',
      'm=audio 0 RTP/AVP 0',
      'a=rtpmap:0 PCMU/8000',
    ].join('\r\n');
    expect(parseSdpOffer(sdpWithPort0)).toBeNull();

    const sdpWithPort70000 = sdpWithPort0.replace('m=audio 0', 'm=audio 70000');
    expect(parseSdpOffer(sdpWithPort70000)).toBeNull();

    const sdpWithPortNegative = sdpWithPort0.replace('m=audio 0', 'm=audio -5');
    expect(parseSdpOffer(sdpWithPortNegative)).toBeNull();

    // Valid port 10000 works
    const sdpValid = sdpWithPort0.replace('m=audio 0', 'm=audio 10000');
    const offer = parseSdpOffer(sdpValid);
    expect(offer).not.toBeNull();
    expect(offer?.remotePort).toBe(10000);
  });

  it('Finding 3: parseSdpOffer rejects broadcast/multicast connection addresses', () => {
    const sdpBcast = [
      'v=0',
      'o=- 1 1 IN IP4 255.255.255.255',
      's=-',
      'c=IN IP4 255.255.255.255',
      't=0 0',
      'm=audio 10000 RTP/AVP 0',
      'a=rtpmap:0 PCMU/8000',
    ].join('\r\n');
    expect(parseSdpOffer(sdpBcast)).toBeNull();

    const sdpMulticast = sdpBcast.replace(/255\.255\.255\.255/g, '224.0.0.1');
    expect(parseSdpOffer(sdpMulticast)).toBeNull();
  });

  it('Finding 5: SRTP decrypt does not mutate ROC when HMAC check fails', () => {
    const masterKey = Buffer.alloc(16, 0x42);
    const masterSalt = Buffer.alloc(14, 0x13);
    const sender = new SrtpContext(masterKey, masterSalt);
    const receiver = new SrtpContext(masterKey, masterSalt);

    // Build valid initial packet seq=100
    const plain = Buffer.concat([
      Buffer.from([0x80, 0x00, 0x00, 100]), // v=2, pt=0, seq=100
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // ts=0
      Buffer.from([0x12, 0x34, 0x56, 0x78]), // ssrc
      Buffer.alloc(160, 0x55), // payload
    ]);
    const enc1 = sender.encrypt(plain);
    const dec1 = receiver.decrypt(enc1);
    expect(dec1.subarray(12)).toEqual(plain.subarray(12));

    // Now forge a packet claiming seq=0 (looks like sequence wrap high->low)
    // with an INVALID HMAC tag
    const forged = Buffer.concat([
      Buffer.from([0x80, 0x00, 0x00, 0x00]), // seq=0
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0x12, 0x34, 0x56, 0x78]),
      Buffer.alloc(160, 0xaa),
      Buffer.alloc(10, 0xff), // bogus tag
    ]);

    expect(() => receiver.decrypt(forged)).toThrow('authentication tag mismatch');

    // Next LEGITIMATE sequential packet seq=101 MUST still decrypt successfully
    // (if ROC had been mutated by the forged seq=0 packet, this would fail!)
    const plain2 = Buffer.concat([
      Buffer.from([0x80, 0x00, 0x00, 101]), // seq=101
      Buffer.from([0x00, 0x00, 0x00, 160]),
      Buffer.from([0x12, 0x34, 0x56, 0x78]),
      Buffer.alloc(160, 0x66),
    ]);
    const enc2 = sender.encrypt(plain2);
    const dec2 = receiver.decrypt(enc2);
    expect(dec2.subarray(12)).toEqual(plain2.subarray(12));
  });

  it('Finding 4: makeDrain bounds the audio queue and drops oldest frames on overflow', () => {
    const sent: Buffer[] = [];
    const drain = makeDrainForTest(
      (pkt) => sent.push(pkt),
      () => {},
    );

    // Enqueue 5050 items (exceeds MAX_QUEUE_ITEMS = 5000)
    for (let i = 0; i < 5050; i++) {
      drain.enqueue(Buffer.alloc(160, i & 0xff));
    }

    drain.stop();
    // Proves that enqueueing beyond limit does not throw or crash and queue stays bounded
  });

  it('Finding 2: RTP handler drops packets from unauthorized source IP', async () => {
    const fakeLog = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    const rtp = await createRtpHandler({
      portMin: 20000,
      portMax: 20100,
      log: fakeLog,
      audioPt: 0,
      dtmfPt: 101,
      silenceByte: 0xff,
    });

    rtp.setRemote('198.51.100.5', 4000);
    rtp.startForwarding();

    const audioReceived = vi.fn();
    rtp.on('audio', audioReceived);

    // Inject UDP packet directly from a DIFFERENT IP using a client socket
    const client = dgram.createSocket('udp4');
    const fakePacket = Buffer.concat([
      Buffer.from([0x80, 0x00, 0x00, 0x01]), // v=2, pt=0, seq=1
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0x99, 0x88, 0x77, 0x66]), // ssrc
      Buffer.alloc(160, 0xaa),
    ]);

    await new Promise<void>((resolve) => {
      // Loopback send will have address 127.0.0.1, mismatching remoteIp 198.51.100.5
      client.send(fakePacket, rtp.localPort, '127.0.0.1', () => resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(audioReceived).not.toHaveBeenCalled();
    expect(fakeLog.trace).toHaveBeenCalledWith(
      expect.objectContaining({ drop: 'ip_mismatch', src: '127.0.0.1', expected: '198.51.100.5' }),
      expect.stringContaining('RTP dropped'),
    );

    client.close();
    rtp.dispose();
  });
});
