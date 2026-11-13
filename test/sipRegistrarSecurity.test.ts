import { EventEmitter } from 'node:events';
import type { RemoteInfo } from 'node:dgram';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../vendor/sip-bridge/src/config/index.js';

const udp = vi.hoisted(() => ({ createSocket: vi.fn() }));
vi.mock('node:dgram', () => ({ default: udp }));
import { createSipUserAgent, type SipHandle } from '../vendor/sip-bridge/src/sip/userAgent.js';

class Socket extends EventEmitter {
  sent: string[] = [];
  bind(_port: number, _host: string, cb: () => void) { cb(); }
  send(buf: Buffer, _port: number, _host: string, cb?: (err: Error | null) => void) {
    this.sent.push(buf.toString()); cb?.(null);
  }
  close() {}
}
const config = {
  SIP_REGISTRAR: '192.0.2.10', SIP_DOMAIN: 'example.test', SIP_USER: 'alice',
  SIP_PASSWORD: 'secret', SDP_CONTACT_IP: '192.0.2.20', SIP_LISTEN_ADDR: '0.0.0.0:5062',
  SIP_EXPIRES: 3600, SIP_OPTIONS_INTERVAL: 10,
} as Config;
const endpoint = { address: '192.0.2.10', port: 5060, family: 'IPv4', size: 0 } as RemoteInfo;
function header(raw: string, name: string): string {
  return raw.match(new RegExp(`^${name}: (.+)`, 'm'))![1]!.trim();
}
function response(request: string, status = 200): string {
  return [`SIP/2.0 ${status} Test`, ...['Via', 'Call-ID', 'CSeq'].map(n => `${n}: ${header(request, n)}`),
    ...(status === 401 ? ['WWW-Authenticate: Digest realm="test", nonce="nonce"'] : []),
    'Content-Length: 0', '', ''].join('\r\n');
}
let socket: Socket;
let handle: SipHandle | undefined;
let log: Logger;
async function start() {
  const promise = createSipUserAgent(config, log);
  // IP-literal resolution is async, then mocked bind sends REGISTER synchronously.
  await Promise.resolve();
  return { promise, register: socket.sent[0]! };
}
function receive(raw: string, remote = endpoint) { socket.emit('message', Buffer.from(raw), remote); }
async function registered() {
  const startResult = await start();
  receive(response(startResult.register));
  handle = await startResult.promise;
  return startResult.register;
}
beforeEach(() => {
  vi.useFakeTimers(); socket = new Socket(); udp.createSocket.mockReturnValue(socket);
  log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
});
afterEach(() => { handle?.stop(); handle = undefined; vi.clearAllTimers(); vi.useRealTimers(); });

const mutations: [string, (raw: string) => string][] = [
  ['Call-ID', raw => raw.replace(/Call-ID: .+/, 'Call-ID: wrong')],
  ['CSeq number', raw => raw.replace(/CSeq: \d+/, 'CSeq: 999')],
  ['CSeq method', raw => raw.replace(/(CSeq: \d+ )\w+/, '$1NOTREGISTEROPTIONS')],
  ['sent-by', raw => raw.replace('192.0.2.20:5062', '192.0.2.20:9999')],
  ['branch', raw => raw.replace(/branch=[^;\r\n]+/, 'branch=wrong')],
  ['top Via', raw => raw.replace('Via: ', 'Via: SIP/2.0/UDP wrong:5060;branch=wrong, ')],
  ['duplicate Call-ID', raw => raw.replace('Content-Length:', 'Call-ID: wrong\r\nContent-Length:')],
  ['duplicate CSeq', raw => raw.replace('Content-Length:', 'CSeq: 999 OPTIONS\r\nContent-Length:')],
];

describe('registrar REGISTER response binding', () => {
  it.each(mutations)('ignores mismatched %s then accepts the real response', async (_name, mutate) => {
    const { promise, register } = await start();
    let resolved = false; void promise.then(() => { resolved = true; });
    receive(mutate(response(register))); await Promise.resolve();
    expect(resolved).toBe(false); expect(log.info).toHaveBeenCalledTimes(1);
    receive(response(register)); handle = await promise;
    expect(log.info).toHaveBeenCalledTimes(2);
  });
  it.each([{ ...endpoint, address: '192.0.2.99' }, { ...endpoint, port: 5061 }])('ignores wrong endpoint %j', async remote => {
    const { promise, register } = await start();
    receive(response(register, 401), remote); expect(socket.sent).toHaveLength(1);
    receive(response(register)); handle = await promise;
  });
  it('does not consume provisional responses and consumes final responses once', async () => {
    const { promise, register } = await start();
    receive(response(register, 100)); expect(log.info).toHaveBeenCalledTimes(1);
    receive(response(register)); handle = await promise;
    receive(response(register)); receive(response(register, 401));
    expect(log.info).toHaveBeenCalledTimes(2); expect(socket.sent).toHaveLength(1);
  });
  it('expires REGISTER even after provisional response and ignores late finals', async () => {
    const { promise, register } = await start();
    const rejected = expect(promise).rejects.toThrow('REGISTER timeout');
    receive(response(register, 100));
    await vi.advanceTimersByTimeAsync(32000); await rejected;
    receive(response(register)); expect(log.info).toHaveBeenCalledTimes(1);
  });
  it('retires challenged transactions, rejects stale replay, and bounds authentication retries', async () => {
    const { promise, register } = await start();
    const rejected = expect(promise).rejects.toThrow('authentication retry limit');
    receive(response(register, 401)); expect(socket.sent).toHaveLength(2);
    receive(response(register, 401)); receive(response(register)); expect(socket.sent).toHaveLength(2);
    receive(response(socket.sent[1]!, 401)); expect(socket.sent).toHaveLength(3);
    receive(response(socket.sent[2]!, 401)); await rejected;
    expect(socket.sent).toHaveLength(3);
  });
});

describe('registrar OPTIONS response binding', () => {
  it.each(mutations)('mismatched %s cannot suppress a timeout', async (_name, mutate) => {
    await registered(); await vi.advanceTimersByTimeAsync(10000);
    const options = socket.sent[1]!; expect(options).toMatch(/^OPTIONS /);
    receive(mutate(response(options)));
    await vi.advanceTimersByTimeAsync(5000);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'options_failure' }), expect.any(String));
  });
  it.each([{ ...endpoint, address: '192.0.2.99' }, { ...endpoint, port: 5061 }])('wrong endpoint %j cannot suppress timeout', async remote => {
    await registered(); await vi.advanceTimersByTimeAsync(10000);
    receive(response(socket.sent[1]!), remote); await vi.advanceTimersByTimeAsync(5000);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'options_failure' }), expect.any(String));
  });
  it('provisional responses do not clear the timer; expired replies cannot reset failures', async () => {
    await registered(); await vi.advanceTimersByTimeAsync(10000);
    const stale = socket.sent[1]!; receive(response(stale, 100));
    await vi.advanceTimersByTimeAsync(5000); receive(response(stale));
    await vi.advanceTimersByTimeAsync(5000); receive(response(stale));
    await vi.advanceTimersByTimeAsync(5000);
    expect(socket.sent.filter(s => s.startsWith('REGISTER '))).toHaveLength(2);
  });
  it('counts each final only once and accepts matching finals after provisional', async () => {
    await registered(); await vi.advanceTimersByTimeAsync(10000);
    const first = socket.sent[1]!; receive(response(first, 100)); receive(response(first, 503));
    receive(response(first, 503)); expect(socket.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10000); receive(response(socket.sent[2]!, 503));
    expect(socket.sent.filter(s => s.startsWith('REGISTER '))).toHaveLength(2);
  });
  it('matching success cancels its timeout and deregistration responses cannot restart registration', async () => {
    const initial = await registered(); await vi.advanceTimersByTimeAsync(10000);
    receive(response(socket.sent[1]!)); await vi.advanceTimersByTimeAsync(5000);
    expect(log.warn).not.toHaveBeenCalled();
    await handle!.unregister(); receive(response(socket.sent[2]!)); receive(response(initial));
    expect(log.info).toHaveBeenCalledTimes(2);
  });
});
