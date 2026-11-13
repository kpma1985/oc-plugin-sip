import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallManager } from '../vendor/sip-bridge/src/bridge/callManager.js';
import { parseSipConfig } from '../src/config.js';
import { mapEmbeddedConfig } from '../src/embedded/config.js';

const peer = { address: '192.0.2.10', port: 5060, family: 'IPv4', size: 0 };
function request(method = 'INVITE', seq = 10, branch = 'z9hG4bKoriginal', fromTag = 'caller', toTag = '', id = 'known') {
  return `${method} sip:callee@example.com SIP/2.0\r\nVia: SIP/2.0/UDP 192.0.2.10:5060;branch=${branch}\r\nFrom: <sip:caller@example.com>;tag=${fromTag}\r\nTo: <sip:callee@example.com>${toTag ? `;tag=${toTag}` : ''}\r\nCall-ID: ${id}\r\nCSeq: ${seq} ${method}\r\nContent-Length: 0\r\n\r\n`;
}
function harness(extra = {}) {
  const config = mapEmbeddedConfig(parseSipConfig({ sip: { user: 'u', password: 'p' } }), { address: '127.0.0.1', port: 12345 });
  const log: any = Object.fromEntries(['info', 'warn', 'error', 'debug', 'trace', 'child'].map(k => [k, vi.fn()])); log.child.mockReturnValue(log);
  const manager: any = new CallManager({ ...config, ...extra }, log);
  const sendRaw = vi.fn(); manager.setSipHandle({ registrarIp: peer.address, sendRaw });
  const terminate = vi.spyOn(manager, 'terminateSession').mockImplementation(() => {});
  return { manager, sendRaw, terminate };
}
afterEach(() => vi.useRealTimers());
describe('inbound SIP transaction authorization', () => {
  it('retains no pending state for many unique rejected peers or malformed trusted offers', async () => {
    const { manager, sendRaw } = harness();
    try {
      for (let i = 0; i < 1000; i++) await manager.handleInvite(request('INVITE', 10, 'z9hG4bKoriginal', 'caller', '', `bad-${i}`), { ...peer, address: '198.51.100.99' });
      expect(manager.pendingInvites.size).toBe(0); expect(sendRaw).not.toHaveBeenCalled();
      for (let i = 0; i < 100; i++) await manager.handleInvite(request('INVITE', 10, 'z9hG4bKoriginal', 'caller', '', `trusted-${i}`), peer);
      expect(manager.pendingInvites.size).toBe(0); expect(manager.cancelledInvites.size).toBe(0);
      expect(sendRaw.mock.calls.filter(([b]) => b.toString().startsWith('SIP/2.0 488'))).toHaveLength(100);
    } finally { await manager.terminateAll(); }
  });
  it('cleans pending state even when response sending throws', async () => {
    const { manager, sendRaw } = harness(); sendRaw.mockImplementation(() => { throw new Error('send failed'); });
    try { await expect(manager.handleInvite(request(), peer)).rejects.toThrow('send failed'); expect(manager.pendingInvites.size).toBe(0); }
    finally { await manager.terminateAll(); }
  });
  it('rejects plain RTP under required policy and SAVP when encryption is disabled before allocation', async () => {
    for (const [extra, protocol] of [[{ SRTP_ENABLED: true, SRTP_REQUIRED: true }, 'RTP/AVP'], [{ SRTP_ENABLED: false }, 'RTP/SAVP']] as const) {
      const { manager, sendRaw } = harness(extra);
      const body = `v=0\r\nc=IN IP4 192.0.2.10\r\nm=audio 9000 ${protocol} 0\r\na=crypto:1 AES_128_CM_HMAC_SHA1_80 inline:${Buffer.alloc(30).toString('base64')}\r\n`;
      try {
        await manager.handleInvite(request().replace('Content-Length: 0', `Content-Length: ${body.length}`) + body, peer);
        expect(sendRaw.mock.calls.map(([b]) => b.toString().split('\r\n')[0])).toEqual(['SIP/2.0 100 Trying', 'SIP/2.0 488 Not Acceptable Here']);
        expect(manager.sessions.size).toBe(0); expect(manager.pendingInvites.size).toBe(0);
      } finally { await manager.terminateAll(); }
    }
  });
  it('discloses stored SDP only to the original peer and INVITE transaction', async () => {
    const { manager, sendRaw } = harness();
    manager.sessions.set('known', { signalingPeer: peer, inviteRaw: request(), localTag: 'local', remoteTag: 'caller', sdpAnswer: 'SECRET-SDES-SDP' });
    try {
      await manager.handleInvite(request(), { ...peer, address: '198.51.100.99' });
      await manager.handleInvite(request(), { ...peer, port: 7777 });
      for (const raw of [request('INVITE', 11), request('INVITE', 10, 'z9hG4bKforged'), request('INVITE', 10, 'z9hG4bKoriginal', 'forged'), request('INVITE', 10, 'z9hG4bKoriginal', 'caller', 'forged'), request() + 'changed SDP']) await manager.handleInvite(raw, peer);
      expect(sendRaw).not.toHaveBeenCalled();
      await manager.handleInvite(request(), peer);
      expect(sendRaw).toHaveBeenCalledTimes(1); expect(sendRaw.mock.calls[0]![0].toString()).toContain('SECRET-SDES-SDP');
    } finally { manager.sessions.clear(); await manager.terminateAll(); }
  });
  it('requires peer, both tags, method and advancing CSeq for BYE', async () => {
    const { manager, sendRaw, terminate } = harness();
    manager.sessions.set('known', { signalingPeer: peer, inviteRaw: request(), localTag: 'local', remoteTag: 'caller', remoteCseq: 10 });
    try {
      for (const raw of [request('BYE', 10, 'z9hG4bKbye', 'caller', 'local'), request('BYE', 11, 'z9hG4bKbye', 'wrong', 'local'), request('BYE', 11, 'z9hG4bKbye', 'caller', 'wrong'), request('BYE', 11, 'z9hG4bKbye', 'caller', 'local').replace('11 BYE', '11 INVITE')]) manager.handleBye(raw, peer);
      manager.handleBye(request('BYE', 11, 'z9hG4bKbye', 'caller', 'local'), { ...peer, port: 7777 });
      expect(terminate).not.toHaveBeenCalled(); expect(sendRaw).not.toHaveBeenCalled();
      manager.handleBye(request('BYE', 11, 'z9hG4bKbye', 'caller', 'local'), peer);
      expect(terminate).toHaveBeenCalledTimes(1);
    } finally { manager.sessions.clear(); await manager.terminateAll(); }
  });
  it('binds CANCEL to pending INVITE and never terminates an established dialog', async () => {
    const { manager, sendRaw, terminate } = harness();
    manager.pendingInvites.set('known', { raw: request(), ...peer, expires: Date.now() + 30000 });
    try {
      manager.handleCancel(request('CANCEL', 11), peer);
      manager.handleCancel(request('CANCEL', 10, 'z9hG4bKwrong'), peer);
      manager.handleCancel(request('CANCEL'), { ...peer, port: 9999 });
      expect(sendRaw).not.toHaveBeenCalled(); expect(manager.cancelledInvites.size).toBe(0);
      manager.handleCancel(request('CANCEL'), peer);
      expect(manager.cancelledInvites.has('known')).toBe(true); expect(sendRaw).toHaveBeenCalledTimes(2);
      sendRaw.mockClear(); manager.sessions.set('known', {});
      manager.handleCancel(request('CANCEL'), peer);
      expect(sendRaw).not.toHaveBeenCalled(); expect(terminate).not.toHaveBeenCalled();
    } finally { manager.sessions.clear(); await manager.terminateAll(); }
  });
});
