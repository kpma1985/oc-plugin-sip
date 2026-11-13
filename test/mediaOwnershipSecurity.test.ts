import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { VoiceCall } from '../src/voice/voiceCall.js';
import { createServer } from 'node:net';
import { startSipPlugin, type SipPluginHandle } from '../src/index.js';
import { MediaServer } from '../src/media/mediaServer.js';
import { CallRegistry, CallSession } from '../src/media/callSession.js';
import { SipAdmission, callerE164 } from '../src/channel.js';
import { parseSipConfig } from '../src/config.js';
import { buildMediaFrame } from '../src/media/twilioFrames.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0)) await stop(); });
async function open(server: MediaServer): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address!.port}/sip/media`);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}
const start = (ws: WebSocket, sid = 'same', caller = '+4912345') => ws.send(JSON.stringify({ event: 'start', streamSid: sid, start: { customParameters: { from: caller } } }));
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
async function closed(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>(resolve => ws.once('close', () => resolve()));
}
async function plugin(hooks: Parameters<typeof startSipPlugin>[1] = {}, extra = {}, dependencies: Parameters<typeof startSipPlugin>[2] = {}): Promise<SipPluginHandle> {
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const h = await startSipPlugin({ transport: 'bridge', media: { port }, ...extra }, hooks, dependencies);
  cleanup.push(h.stop); return h;
}
const call = (sid: string, from: unknown = '+4912345') => new CallSession({ streamSid: sid, from: from as string, onSend() {} });
describe('immutable media ownership', () => {
  it.each([1, 2])('rejects duplicate sockets before admission with capacity %i and isolates either close order', async capacity => {
    const policy = new SipAdmission(parseSipConfig({ voice: { enabled: true }, inbound: { maxConcurrent: capacity, allowFrom: ['+4912345'] } }));
    const admit = vi.fn((s, c) => policy.admit(s, c));
    const audio = vi.fn(), dtmf = vi.fn(), mark = vi.fn(), end = vi.fn((s) => policy.end(s));
    const h = await plugin({ admitCall: admit, onAudio: audio, onDtmf: dtmf, onMark: mark, onSessionEnd: end });
    const owner = await open(h.server); start(owner); await settle();
    const session = h.server.registry.get('same')!;
    const duplicate = await open(h.server); const duplicateClosed = closed(duplicate);
    start(duplicate, 'same', '+4999999');
    duplicate.send(buildMediaFrame('same', Buffer.alloc(160)));
    duplicate.send(JSON.stringify({ event: 'dtmf', streamSid: 'same', dtmf: { digit: '9' } }));
    await duplicateClosed;
    expect(admit).toHaveBeenCalledTimes(1); expect(end).not.toHaveBeenCalled();
    expect(h.server.registry.get('same')).toBe(session); expect(policy.caller(session)).toBe('+4912345');
    owner.send(buildMediaFrame('same', Buffer.alloc(160)));
    owner.send(JSON.stringify({ event: 'dtmf', streamSid: 'same', dtmf: { digit: '7' } }));
    owner.send(JSON.stringify({ event: 'mark', streamSid: 'same', mark: { name: 'owner' } }));
    await settle();
    expect(audio).toHaveBeenCalledTimes(1); expect(audio.mock.calls[0]![0]).toBe(session);
    expect(dtmf).toHaveBeenCalledExactlyOnceWith(session, '7'); expect(mark).toHaveBeenCalledExactlyOnceWith(session, 'owner');
    // Legitimate owner close first while the duplicate's rejection/close is also in flight.
    const another = await open(h.server); const anotherClosed = closed(another);
    start(another, 'same', '+4999999');
    const ownerClosed = closed(owner); owner.close();
    await Promise.all([ownerClosed, anotherClosed]); await settle();
    expect(end).toHaveBeenCalledTimes(1); expect(h.server.registry.size).toBe(0);
    const next = await open(h.server); start(next, 'next'); await settle();
    expect(h.server.registry.get('next')).toBeDefined(); next.close();
  });
  it.each([1, 2])('binds voice audio/DTMF to the legitimate object with %i slots', async capacity => {
    const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => upstream.once('listening', resolve));
    cleanup.push(() => new Promise<void>(resolve => {
      for (const client of upstream.clients) client.terminate();
      upstream.close(() => resolve());
    }));
    const routed: Array<[CallSession, string]> = [];
    const audio = vi.spyOn(VoiceCall.prototype, 'audio').mockImplementation(function(this: VoiceCall) {
      routed.push([(this as any).session, 'audio']);
    });
    const dtmf = vi.spyOn(VoiceCall.prototype, 'dtmf').mockImplementation(function(this: VoiceCall) {
      routed.push([(this as any).session, 'dtmf']);
    });
    try {
      const h = await plugin({}, { voice: { enabled: true }, inbound: { maxConcurrent: capacity }, stt: { apiKey: 'test' }, tts: { apiKey: 'test' } },
        { voice: { listenUrl: `ws://127.0.0.1:${(upstream.address() as { port: number }).port}` } });
      const owner = await open(h.server); start(owner); await settle();
      const session = h.server.registry.get('same')!;
      const duplicate = await open(h.server); const done = closed(duplicate); start(duplicate, 'same', '+4999999');
      duplicate.send(buildMediaFrame('same', Buffer.alloc(160)));
      duplicate.send(JSON.stringify({ event: 'dtmf', streamSid: 'same', dtmf: { digit: '9' } }));
      await done;
      owner.send(buildMediaFrame('same', Buffer.alloc(160)));
      owner.send(JSON.stringify({ event: 'dtmf', streamSid: 'same', dtmf: { digit: '7' } }));
      await settle(); expect(routed).toEqual([[session, 'audio'], [session, 'dtmf']]);
      expect(session.currentState).toBe('active'); owner.close(); await closed(owner);
    } finally { audio.mockRestore(); dtmf.mockRestore(); }
  });
  it('registry and admission never accept or remove a different object with the same ID', () => {
    const a = call('same'), b = call('same', '+4999999');
    const registry = new CallRegistry(); registry.add(a);
    expect(() => registry.add(b)).toThrow(/Duplicate/); registry.remove(b); expect(registry.get('same')).toBe(a);
    const policy = new SipAdmission(parseSipConfig({ voice: { enabled: true }, inbound: { maxConcurrent: 2, allowFrom: ['+4912345'] } }));
    expect(policy.admit(a, {})).toBe(true); expect(policy.admit(b, {})).toBe(false);
    expect(policy.caller(b)).toBeUndefined(); policy.end(b); expect(policy.caller(a)).toBe('+4912345');
    policy.end(a); expect(policy.admit(b, {})).toBe(false);
  });
  it.each([123, {}, [], true, 'x'.repeat(1025)])('caller normalization contains malformed metadata %j', value => {
    expect(callerE164(call('bad', value), {})).toBeUndefined();
    expect(callerE164(new CallSession({ streamSid: 'bad', onSend() {} }), { from: value } as any)).toBeUndefined();
  });
});
describe('per-message exception containment', () => {
  it.each(['admit', 'init', 'audio', 'dtmf', 'mark', 'end'] as const)('contains throwing %s hook and releases only offending resources', async failure => {
    const policy = new SipAdmission(parseSipConfig({ voice: { enabled: true }, inbound: { maxConcurrent: 2, allowFrom: ['+4912345'] } }));
    let bad: CallSession | undefined;
    const explode = (session: CallSession) => { if (session.streamSid === 'bad') throw new Error('test failure'); };
    const h = await plugin({
      admitCall(s, c) { if (s.streamSid === 'bad') bad = s; const accepted = policy.admit(s, c); if (failure === 'admit') explode(s); return accepted; },
      onCall(s) { if (failure === 'init') explode(s); },
      onAudio(s) { if (failure === 'audio') explode(s); },
      onDtmf(s) { if (failure === 'dtmf') explode(s); },
      onMark(s) { if (failure === 'mark') explode(s); },
      onSessionEnd(s) { policy.end(s); if (failure === 'end') explode(s); },

    });
    const owner = await open(h.server); start(owner, 'owner'); await settle();
    const ownerSession = h.server.registry.get('owner')!;
    const offender = await open(h.server); const offenderClosed = closed(offender); start(offender, 'bad');
    await settle();
    if (offender.readyState === WebSocket.OPEN) {
      if (failure === 'audio') offender.send(buildMediaFrame('bad', Buffer.alloc(160)));
      if (failure === 'dtmf') offender.send(JSON.stringify({ event: 'dtmf', streamSid: 'bad', dtmf: { digit: '7' } }));
      if (failure === 'mark') offender.send(JSON.stringify({ event: 'mark', streamSid: 'bad', mark: { name: 'x' } }));
      if (failure === 'end') offender.send(JSON.stringify({ event: 'stop', streamSid: 'bad' }));
    }
    await offenderClosed; expect(h.server.registry.get('bad')).toBeUndefined();
    expect(policy.caller(bad!)).toBeUndefined(); expect(policy.caller(ownerSession)).toBe('+4912345');
    expect(h.server.registry.get('owner')).toBe(ownerSession);
    const next = await open(h.server); start(next, 'next'); await settle(); expect(h.server.registry.get('next')).toBeDefined();
    next.close(); owner.close();
  });
  it('rolls back admission when voice construction throws', async () => {
    const policy = new SipAdmission(parseSipConfig({ voice: { enabled: true }, inbound: { maxConcurrent: 1, allowFrom: ['+4912345'] } }));
    const admit = vi.fn((s, c) => policy.admit(s, c));
    const h = await plugin({ admitCall: admit, onSessionEnd: s => policy.end(s) },
      { voice: { enabled: true }, stt: { apiKey: 'test' }, tts: { apiKey: 'test' } }, { voice: { listenUrl: 'not a URL' } });
    for (const sid of ['first', 'second']) {
      const ws = await open(h.server); const done = closed(ws); start(ws, sid); await done;
      expect(h.server.registry.size).toBe(0);
    }
    expect(admit.mock.results.map(r => r.value)).toEqual([true, true]);
  });
  it('contains synchronous call-start logging exceptions without disturbing a healthy call', async () => {
    const server = new MediaServer({ host: '127.0.0.1', port: 0, path: '/sip/media', onLog(event, fields) {
      if (event === 'call-start' && fields?.streamSid === 'bad') throw new Error('log failure');
    } });
    await server.start(); cleanup.push(() => server.stop());
    const owner = await open(server); start(owner, 'owner'); await settle();
    const session = server.registry.get('owner');
    const offender = await open(server); const done = closed(offender); start(offender, 'bad'); await done;
    expect(server.registry.get('bad')).toBeUndefined(); expect(server.registry.get('owner')).toBe(session);
    owner.close();
  });
  it('contains thrown event listeners and unsupported codecs without an error listener', async () => {
    const server = new MediaServer({ host: '127.0.0.1', port: 0, path: '/sip/media' });
    await server.start(); cleanup.push(() => server.stop());
    server.on('call', s => { if (s.streamSid === 'bad') throw new Error('listener failure'); });
    for (const unsupported of [false, true]) {
      const ws = await open(server); const done = closed(ws);
      if (unsupported) ws.send(JSON.stringify({ event: 'start', streamSid: 'codec', start: { mediaFormat: { encoding: 'bad', sampleRate: 8000 } } }));
      else start(ws, 'bad');
      await done; expect(server.registry.size).toBe(0);
    }
    const next = await open(server); start(next, 'next'); await settle(); expect(server.registry.size).toBe(1); next.close();
  });
});
