import dgram from 'node:dgram';
import { once } from 'node:events';
import { Writable } from 'node:stream';
import { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { parseSipConfig, validateForTransport } from '../src/config.js';
import { mapEmbeddedConfig } from '../src/embedded/config.js';
import { startEmbeddedTransport } from '../src/embedded/embeddedTransport.js';
import { startSipPlugin, echoHooks } from '../src/index.js';
import { MediaServer } from '../src/media/mediaServer.js';
import { MULAW_FRAME_BYTES } from '../src/media/twilioFrames.js';
import { createMaskedLogger } from '../vendor/sip-bridge/src/logger/index.js';
import { createSipUserAgent, type SipHandle } from '../vendor/sip-bridge/src/sip/userAgent.js';
import { createWsClient } from '../vendor/sip-bridge/src/ws/wsClient.js';

const raw = { sip: { user: 'test-user', password: 'test-password', publicIp: '127.0.0.1' } };
const config = () => parseSipConfig(raw);
const log = createMaskedLogger([], new Writable({ write(_chunk, _encoding, done) { done(); } }));
const sipStub = (): SipHandle => ({ registrarIp: '127.0.0.1', stop: vi.fn(), unregister: vi.fn(async () => { }), sendRaw: vi.fn(), registerDialog: vi.fn(), unregisterDialog: vi.fn() });
async function freePort(): Promise<number> {
  const socket = dgram.createSocket('udp4');
  socket.bind(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise<void>((resolve) => socket.close(resolve));
  return port;
}
async function assertPortReleased(port: number): Promise<void> {
  const socket = dgram.createSocket('udp4');
  try { socket.bind(port, '127.0.0.1'); await once(socket, 'listening'); }
  finally { await new Promise<void>((resolve) => socket.close(resolve)); }
}

describe('embedded config', () => {
  it('maps full config without loading vendor environment', () => {
    const mapped = mapEmbeddedConfig(config(), { address: '0.0.0.0', port: 12345 });
    expect(mapped).toMatchObject({ SIP_USER: 'test-user', SIP_PASSWORD: 'test-password', SIP_LISTEN_ADDR: '0.0.0.0:5060', SDP_CONTACT_IP: '127.0.0.1', WS_TARGET_URL: 'ws://127.0.0.1:12345/sip/media', AUDIO_MODE: 'twilio', SRTP_ENABLED: false, RTP_PORT_MIN: 10000, RTP_PORT_MAX: 10099, DIAL_ALLOWED_PREFIXES: '', AUTH_TOKEN: '' });
    expect(mapEmbeddedConfig(config(), { address: '::', port: 123 }).WS_TARGET_URL).toBe('ws://[::1]:123/sip/media');
    expect(mapEmbeddedConfig(config(), { address: '192.0.2.1', port: 123 }).WS_TARGET_URL).toBe('ws://192.0.2.1:123/sip/media');
    expect(mapped.VOICE_URL).toBeUndefined();
  });
  it.each(['127.0.0.1:0', '127.0.0.1:65536', '::1:5060', 'bad:5060'])('rejects listener %s', (listenAddr) => {
    expect(() => parseSipConfig({ sip: { listenAddr } })).toThrow();
  });
  it('validates IP, RTP bounds and credentials with best codec', () => {
    expect(() => parseSipConfig({ sip: { publicIp: '::1' } })).toThrow();
    expect(() => parseSipConfig({ media: { rtpPortMin: 1023 } })).toThrow();
    expect(() => parseSipConfig({ media: { rtpPortMax: 65536 } })).toThrow();
    expect(validateForTransport(parseSipConfig({ media: { rtpPortMin: 2000, rtpPortMax: 2000 } }))).toContain('media.rtpPortMax must be > media.rtpPortMin');
    expect(validateForTransport(parseSipConfig({ transport: 'bridge', audio: { mode: 'best' } }))).toEqual([]);
    expect(validateForTransport(parseSipConfig({}))).toHaveLength(3);
  });
});

describe('embedded lifecycle', () => {
  it('wires callbacks and runs all shutdown steps once even after failure', async () => {
    const order: string[] = [];
    const sip = sipStub();
    sip.unregister = vi.fn(async () => { order.push('unregister'); throw new Error('unregister failed'); });
    sip.stop = vi.fn(() => { order.push('stop'); });
    const callbacks = {};
    const setSipHandle = vi.fn();
    const handle = await startEmbeddedTransport(config(), { address: '127.0.0.1', port: 123 }, undefined, {
      createManager: () => ({ getCallbacks: () => callbacks, setSipHandle, terminateAll: async () => { order.push('terminate'); throw new Error('terminate failed'); } }),
      createAgent: async (_config, _log, received) => { expect(received).toBe(callbacks); return sip; },
    });
    expect(setSipHandle).toHaveBeenCalledWith(sip);
    const stopped = handle.stop();
    expect(handle.stop()).toBe(stopped);
    await expect(stopped).rejects.toThrow('SIP cleanup failed');
    expect(order).toEqual(['terminate', 'unregister', 'stop']);
  });
  it('aborts startup and cleans manager on timeout', async () => {
    const terminateAll = vi.fn(async () => { });
    await expect(startEmbeddedTransport(config(), { address: '127.0.0.1', port: 123 }, undefined, {
      startupTimeoutMs: 10,
      createManager: () => ({ getCallbacks: () => ({}), setSipHandle: vi.fn(), terminateAll }),
      createAgent: async (_config, _log, _callbacks, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))),
    })).rejects.toThrow('startup timeout');
    expect(terminateAll).toHaveBeenCalledOnce();
  });
  it('binds media before embedded and closes media even when stop fails', async () => {
    const handle = await startSipPlugin({ ...raw, media: { port: 18081 } }, {}, {
      startEmbeddedTransport: async (_config, address) => {
        expect(address.port).toBe(18081);
        return { stop: async () => { throw new Error('cleanup failure'); } };
      },
    });
    const socket = new WebSocket('ws://127.0.0.1:18081/sip/media');
    await once(socket, 'open');
    const closed = once(socket, 'close');
    await expect(handle.stop()).rejects.toThrow('SIP cleanup failed');
    await closed;
    expect(handle.server.address).toBeNull();
  });
  it('cleans media when embedded startup rejects; bridge skips SIP', async () => {
    await expect(startSipPlugin({ ...raw, media: { port: 18082 } }, {}, { startEmbeddedTransport: async () => { throw new Error('startup failed'); } })).rejects.toThrow('startup failed');
    const factory = vi.fn();
    const bridge = await startSipPlugin({ transport: 'bridge', media: { port: 18082 } }, echoHooks(), { startEmbeddedTransport: factory });
    try { expect(factory).not.toHaveBeenCalled(); } finally { await bridge.stop(); }
  });
});

describe('real loopback media and UDP cleanup (no trunk)', () => {
  it('vendor WS carries caller, media, DTMF, echo and marks', async () => {
    const server = new MediaServer({ host: '127.0.0.1', port: 0, path: '/sip/media' });
    await server.start();
    const call = once(server, 'call');
    const client = await createWsClient(mapEmbeddedConfig(config(), server.address!).WS_TARGET_URL!, {
      streamSid: 'MZtest', callSid: 'CAtest', from: '+49123', to: '+49456', sipCallId: 'test',
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
    }, log);
    try {
      const [session, custom] = await call;
      expect(session.from).toBe('+49123'); expect(session.to).toBe('+49456'); expect(custom.From).toBe('+49123');
      const frame = Buffer.alloc(MULAW_FRAME_BYTES, 0xff);
      const audio = once(server, 'audio'); client.sendAudio(frame);
      const [, received] = await audio; expect(Buffer.from(received)).toEqual(frame);
      const dtmf = once(server, 'dtmf'); client.sendDtmf('5'); expect((await dtmf)[1]).toBe('5');
      const echo = new Promise<Buffer>((resolve) => client.onAudio(resolve));
      echoHooks().onAudio!(session, frame); expect(await echo).toEqual(frame);
      client.onMark((name) => client.sendMark(name));
      const mark = once(server, 'mark'); session.mark('done'); expect((await mark)[1]).toBe('done');
      session.interrupt();
    } finally { client.stop(); await server.stop(); }
    expect(server.registry.size).toBe(0);
  });
  it('aborted registration releases real bound UDP socket', async () => {
    const port = await freePort();
    const mapped = mapEmbeddedConfig(config(), { address: '127.0.0.1', port: 123 });
    mapped.SIP_LISTEN_ADDR = `127.0.0.1:${port}`; mapped.SIP_REGISTRAR = '127.0.0.1';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('test startup timeout')), 30);
    try { await expect(createSipUserAgent(mapped, log, undefined, controller.signal)).rejects.toThrow('test startup timeout'); }
    finally { clearTimeout(timer); }
    await assertPortReleased(port);
  });
  it('pre-abort rejects without opening UDP', async () => {
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(createSipUserAgent(mapEmbeddedConfig(config(), { address: '127.0.0.1', port: 123 }), log, undefined, controller.signal)).rejects.toThrow('cancelled');
  });
  it.each(['403 Forbidden', '401 Unauthorized'])('rejected registration %s releases socket', async (status) => {
    const port = await freePort();
    const mapped = mapEmbeddedConfig(config(), { address: '127.0.0.1', port: 123 });
    mapped.SIP_LISTEN_ADDR = `127.0.0.1:${port}`;
    mapped.SIP_REGISTRAR = '127.0.0.1';
    mapped.SIP_REGISTRAR_PORT = await freePort();
    const peer = dgram.createSocket('udp4');
    peer.bind(mapped.SIP_REGISTRAR_PORT, '127.0.0.1'); await once(peer, 'listening');
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('test deadline')), 1000);
    peer.once('message', (buf, remote) => {
      const headers = ['Via', 'Call-ID', 'CSeq'].map(name => buf.toString().match(new RegExp(`^${name}:.*$`, 'm'))![0].trim());
      peer.send(Buffer.from([`SIP/2.0 ${status}`, ...headers, 'Content-Length: 0', '', ''].join('\r\n')), remote.port, remote.address);
    });
    try {
      await expect(createSipUserAgent(mapped, log, undefined, controller.signal)).rejects.toThrow(status.startsWith('403') ? 'SIP 403' : 'without challenge');
      await assertPortReleased(port);
    } finally {
      clearTimeout(deadline);
      await new Promise<void>((resolve) => peer.close(resolve));
    }
  });
  it('rejects unsupported bridge format', async () => {
    const server = new MediaServer({ host: '127.0.0.1', port: 0, path: '/sip/media' });
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.address!.port}/sip/media`);
    try {
      await once(socket, 'open');
      const error = new Promise<Error>((resolve) => server.once('error', resolve));
      const closed = once(socket, 'close');
      socket.send(JSON.stringify({ event: 'start', streamSid: 'MZbad', start: { mediaFormat: { encoding: 'audio/G722', sampleRate: 8000, channels: 1 } } }));
      expect((await error).message).toContain('Unsupported mono media stream codec');
      await closed;
      expect(server.registry.size).toBe(0);
    } finally { socket.terminate(); await server.stop(); }
  });
  it('masks serialized secrets in parent and child logs', () => {
    const chunks: string[] = [];
    const logger = createMaskedLogger(['test-password', 'test-user'], new Writable({
      write(chunk, _encoding, done) { chunks.push(String(chunk)); done(); },
    }));
    logger.info({ password: 'test-password' }, 'test-user');
    logger.child({ component: 'call' }).error({ err: new Error('test-password') }, 'test-user');
    expect(chunks).toHaveLength(2);
    expect(chunks.join('')).not.toContain('test-password');
    expect(chunks.join('')).not.toContain('test-user');
    expect(chunks.join('')).toContain('***');
  });
});
