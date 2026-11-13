import { describe, expect, it } from 'vitest';
import { parseSdpOffer, buildSdpAnswer, acceptSdpAnswer } from '../vendor/sip-bridge/src/sip/sdp.js';
import { createRtpHandler } from '../vendor/sip-bridge/src/rtp/rtpHandler.js';
import { parseSipConfig } from '../src/config.js';
import { mapEmbeddedConfig } from '../src/embedded/config.js';
const key = Buffer.alloc(30, 42).toString('base64');
const offer = (crypto = '', protocol = 'RTP/SAVP') => `v=0\r\nc=IN IP4 192.0.2.10\r\nm=audio 9000 ${protocol} 0 101\r\na=rtpmap:101 telephone-event/8000\r\n${crypto}\r\n`;
describe('SDES fail-closed negotiation and policy', () => {
  it.each(['', `a=crypto:1 AES_CM_128_HMAC_SHA1_32 inline:${key}`, 'a=crypto:1 AES_128_CM_HMAC_SHA1_80 inline:abcd', `a=crypto:1 AES_128_CM_HMAC_SHA1_80 inline:${key}AAAA`, `a=crypto:1 AES_128_CM_HMAC_SHA1_80 inline:${key}|2^20|1:4`, `a=crypto:1 AES_128_CM_HMAC_SHA1_80 inline:${key} UNENCRYPTED_SRTP`])('rejects absent, unsupported or malformed crypto %s', crypto => {
    expect(parseSdpOffer(offer(crypto))).toBeNull();
  });
  it('never downgrades SAVP when encryption is disabled or key material is absent', () => {
    const parsed = parseSdpOffer(offer(`a=crypto:1 AES_128_CM_HMAC_SHA1_80 inline:${key}`))!;
    expect(parsed.remoteSrtpKey).toHaveLength(16); expect(parsed.remoteSrtpSalt).toHaveLength(14);
    expect(() => buildSdpAnswer('127.0.0.1', 9001, parsed, 'twilio', false)).toThrow();
    expect(() => buildSdpAnswer('127.0.0.1', 9001, { ...parsed, remoteSrtpKey: undefined }, 'twilio', true)).toThrow();
    const answer = buildSdpAnswer('127.0.0.1', 9001, parsed, 'twilio', true, Buffer.alloc(16), Buffer.alloc(14));
    expect(answer.sdp).toContain('RTP/SAVP'); expect(answer.localSrtpKey).toHaveLength(16);
    expect(() => acceptSdpAnswer(answer.sdp)).toThrow('Outbound leg does not support SRTP');
  });
  it('refuses partial or malformed media key material before binding any socket', async () => {
    const options = { portMin: 42000, portMax: 42010, log: {} as any, audioPt: 0, dtmfPt: 101, silenceByte: 255 };
    await expect(createRtpHandler({ ...options, localSrtpKey: Buffer.alloc(16) })).rejects.toThrow('Incomplete SRTP keys');
    await expect(createRtpHandler({ ...options, localSrtpKey: Buffer.alloc(16), localSrtpSalt: Buffer.alloc(14), remoteSrtpKey: Buffer.alloc(15), remoteSrtpSalt: Buffer.alloc(14) })).rejects.toThrow('Invalid SRTP key length');
  });
  it('distinguishes disabled, opportunistic and required embedded policies', () => {
    const map = (sip: object) => mapEmbeddedConfig(parseSipConfig({ sip }), { address: '127.0.0.1', port: 9000 });
    expect(map({})).toMatchObject({ SRTP_ENABLED: false, SRTP_REQUIRED: false });
    expect(map({ srtp: true })).toMatchObject({ SRTP_ENABLED: true, SRTP_REQUIRED: false });
    expect(map({ srtpRequired: true })).toMatchObject({ SRTP_ENABLED: true, SRTP_REQUIRED: true });
  });
});
