import crypto from 'node:crypto';
import dgram from 'node:dgram';
import type { RemoteInfo } from 'node:dgram';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';

import type { Logger } from 'pino';

import type { Config } from '../config/index.js';
import { listenParts } from '../config/listenAddr.js';
import { USER_AGENT } from '../version.js';

export interface SipCallbacks {
  onInvite?: (raw: string, rinfo: RemoteInfo) => void;
  onAck?: (raw: string, rinfo: RemoteInfo) => void;
  onBye?: (raw: string, rinfo: RemoteInfo) => void;
  onCancel?: (raw: string, rinfo: RemoteInfo) => void;
}

/**
 * Handlers for an outbound (UAC) dialog the forwarder owns. Messages whose
 * Call-ID matches a registered dialog are routed here instead of the inbound
 * REGISTER/INVITE paths — responses to our INVITE/BYE/CANCEL, and in-dialog
 * requests from the callee (e.g. its BYE).
 */
export interface DialogHandlers {
  /** A SIP response (SIP/2.0 …) for this dialog's Call-ID. */
  onResponse?: (raw: string, rinfo: RemoteInfo) => void;
  /** An in-dialog request (method e.g. "BYE") for this dialog's Call-ID. */
  onRequest?: (method: string, raw: string, rinfo: RemoteInfo) => void;
}

export interface SipHandle {
  /** Resolved IPv4 address of the configured SIP registrar / upstream carrier proxy. */
  readonly registrarIp: string;
  stop(): void;
  /** Send a raw SIP message buffer to a remote address — used by CallManager to send INVITE responses and BYE */
  sendRaw(buf: Buffer, port: number, host: string): void;
  /** Send REGISTER with Expires:0 and Contact:* to deregister all bindings */
  unregister(): Promise<void>;
  /** Register an outbound dialog so its Call-ID's responses/requests route to it (B2BUA <Dial>). */
  registerDialog(callId: string, handlers: DialogHandlers): void;
  /** Remove an outbound dialog registration. */
  unregisterDialog(callId: string): void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function randomHex(n: number): string {
  return crypto.randomBytes(n).toString('hex');
}

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

function getLocalIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (!iface.internal && iface.family === 'IPv4') return iface.address;
    }
  }
  return '127.0.0.1';
}

function parseAuthChallenge(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  let m: RegExpExecArray | null;
  const re = /(\w+)="([^"]*)"/g;
  while ((m = re.exec(header)) !== null) result[m[1]] = m[2];
  return result;
}

function buildRegister(p: {
  user: string;
  domain: string;
  registrar: string;
  localIp: string;
  localPort: number;
  callId: string;
  fromTag: string;
  seq: number;
  expires: number;
  branch: string;
  auth?: string;
}): string {
  const sipUri = `sip:${p.user}@${p.domain}`;
  const registrarUri = `sip:${p.registrar}`;
  const contactUri = `sip:${p.user}@${p.localIp}:${p.localPort}`;
  const lines = [
    `REGISTER ${registrarUri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${p.localIp}:${p.localPort};branch=${p.branch};rport`,
    `Max-Forwards: 70`,
    `From: <${sipUri}>;tag=${p.fromTag}`,
    `To: <${sipUri}>`,
    `Call-ID: ${p.callId}`,
    `CSeq: ${p.seq} REGISTER`,
    `Contact: <${contactUri}>`,
    `Expires: ${p.expires}`,
    `User-Agent: ${USER_AGENT}`,
  ];
  if (p.auth) lines.push(`Authorization: ${p.auth}`);
  lines.push('Content-Length: 0', '');
  return lines.join('\r\n') + '\r\n';
}

function parseStatusLine(raw: string): { status: number; reason: string } {
  const m = raw.split('\r\n')[0].match(/^SIP\/2\.0 ([1-6]\d{2}) (.*)$/);
  return m ? { status: +m[1], reason: m[2] } : { status: 0, reason: 'unparseable' };
}

function getHeader(raw: string, name: string): string | null {
  const m = raw.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return m ? m[1].trim() : null;
}

// ── pure helper — exported for unit tests ─────────────────────────────────────

export function applyOptionsResponse(
  consecutiveFailures: number,
  status: number,
  isError: boolean,
): { newCount: number; triggerRegister: boolean } {
  const threshold = 2;
  const isAuth = status === 401 || status === 407;
  const isFailure = isError || status === 404 || status >= 500;
  if (isAuth) return { newCount: 0, triggerRegister: false };
  if (isFailure) {
    const next = consecutiveFailures + 1;
    if (next >= threshold) return { newCount: 0, triggerRegister: true };
    return { newCount: next, triggerRegister: false };
  }
  return { newCount: 0, triggerRegister: false };
}

// ── main export ───────────────────────────────────────────────────────────────

export async function createSipUserAgent(
  config: Config,
  log: Logger,
  callbacks?: SipCallbacks,
  signal?: AbortSignal,
): Promise<SipHandle> {
  signal?.throwIfAborted();
  const registrar = config.SIP_REGISTRAR; // e.g. sipconnect.sipgate.de
  const registrarPort = config.SIP_REGISTRAR_PORT ?? 5060;

  // Accept an IP-literal registrar (dns.resolve4 only takes hostnames) — needed
  // for the sipp e2e harness which points SIP_REGISTRAR at 127.0.0.1.
  const registrarIp = await resolveRegistrar(registrar, signal);
  signal?.throwIfAborted();
  const localIp = config.SDP_CONTACT_IP ?? getLocalIp();
  // Bind host + Via/Contact port come from SIP_LISTEN_ADDR (default 0.0.0.0:5060).
  const { host: bindHost, port: localPort } = listenParts(config.SIP_LISTEN_ADDR);
  const callId = `${randomHex(10)}@sipgate-sip-stream-bridge`;
  const fromTag = randomHex(6);
  let cseq = 1;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;
  let optionsTimer: ReturnType<typeof setInterval> | null = null;
  let settled = false;
  let stopped = false;

  const socket = dgram.createSocket('udp4');
  // One live transaction per method; new requests retire superseded transactions.
  // RFC 3261 non-INVITE Timer F is 64*T1 (32 seconds with default T1).
  const transactions = new Map<string, {
    seq: string; branch: string; sentBy: string; deadline: number;
    authRetries: number; timer: ReturnType<typeof setTimeout>;
  }>();
  const maxAuthRetries = 2;

  function retireTransaction(method: string): void {
    const transaction = transactions.get(method);
    if (transaction) clearTimeout(transaction.timer);
    transactions.delete(method);
  }

  function trackTransaction(method: string, seq: number, branch: string, authRetries = 0): void {
    retireTransaction(method);
    const timeout = method === 'OPTIONS' ? 5000 : 32000;
    const transaction = {
      seq: String(seq), branch, sentBy: `${localIp}:${localPort}`,
      deadline: Date.now() + timeout, authRetries,
      timer: setTimeout(() => {
        if (transactions.get(method) !== transaction) return;
        retireTransaction(method);
        if (method === 'OPTIONS') handleOptionsResponse(0, new Error('OPTIONS timeout'));
        else registrationFailed(new Error('REGISTER timeout'));
      }, timeout),
    };
    transactions.set(method, transaction);
  }

  // Installed before binding/sending; also handles registration failures after startup.
  let registrationFailed: (error: Error) => void = () => {};

  // Outbound (UAC) dialogs owned by the B2BUA forwarder, keyed by Call-ID.
  const dialogs = new Map<string, DialogHandlers>();

  function sendRegister(authHeader?: string, authRetries = 0): void {
    if (stopped) return;
    const branch = `z9hG4bK${randomHex(6)}`;
    const seq = cseq++;
    const msg = buildRegister({
      user: config.SIP_USER,
      domain: config.SIP_DOMAIN,
      registrar,
      localIp,
      localPort,
      callId,
      fromTag,
      seq,
      expires: config.SIP_EXPIRES,
      branch,
      auth: authHeader,
    });
    trackTransaction('REGISTER', seq, branch, authRetries);
    const buf = Buffer.from(msg);
    socket.send(buf, registrarPort, registrarIp, (err) => {
      if (err) {
        log.error({ err, event: 'sip_send_error' }, 'Failed to send REGISTER');
        socket.emit('error', err);
      }
    });
  }

  function buildOptions(seq: number, branch: string): string {
    const sipUri = `sip:${config.SIP_USER}@${config.SIP_DOMAIN}`;
    const registrarUri = `sip:${registrar}`;
    const lines = [
      `OPTIONS ${registrarUri} SIP/2.0`,
      `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch};rport`,
      'Max-Forwards: 70',
      `From: <${sipUri}>;tag=${fromTag}`,
      `To: <${sipUri}>`,
      `Call-ID: ${callId}`,
      `CSeq: ${seq} OPTIONS`,
      `User-Agent: ${USER_AGENT}`,
      'Content-Length: 0',
      '',
    ];
    return lines.join('\r\n') + '\r\n';
  }

  function handleOptionsResponse(status: number, err: Error | null): void {
    const result = applyOptionsResponse(consecutiveFailures, status, err !== null);
    consecutiveFailures = result.newCount;
    if (result.triggerRegister) {
      log.warn({ event: 'options_reregister' }, 'OPTIONS keepalive: 2 consecutive failures — re-registering');
      sendRegister();
    } else if (err !== null || status === 404 || status >= 500) {
      log.warn({ event: 'options_failure', consecutiveFailures }, 'OPTIONS keepalive failure');
    } else if (status === 401 || status === 407) {
      log.debug({ event: 'options_auth', status }, 'OPTIONS 401/407 — server reachable');
    } else {
      log.debug({ event: 'options_ok' }, 'OPTIONS keepalive success');
    }
  }

  log.info({ event: 'ua_starting', registrar, localIp, localPort }, 'Starting SIP registrar (UDP)');

  return new Promise<SipHandle>((resolve, reject) => {
    function cleanup(): void {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener('abort', abort);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (optionsTimer) clearInterval(optionsTimer);
      for (const method of transactions.keys()) retireTransaction(method);
      dialogs.clear();
      socket.removeAllListeners('message');
      try { socket.close(); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error;
      }
    }
    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    registrationFailed = (error) => {
      if (!settled) fail(error);
      else log.error({ err: error, event: 'sip_register_failed' }, error.message);
    };
    function abort(): void {
      fail(signal?.reason instanceof Error ? signal.reason : new Error('SIP startup aborted'));
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    socket.on('error', (err) => {
      log.error({ err, event: 'sip_udp_error' }, 'SIP UDP socket error');
      fail(err);
    });

    socket.on('message', (buf, rinfo) => {
      const raw = buf.toString();
      const firstLine = raw.split('\r\n')[0];

      // Route anything belonging to an outbound (UAC) dialog to its owner first.
      const msgCallId = getHeader(raw, 'Call-ID') ?? '';
      const dialog = msgCallId !== '' ? dialogs.get(msgCallId) : undefined;
      if (dialog) {
        if (firstLine.startsWith('SIP/2.0')) {
          dialog.onResponse?.(raw, rinfo);
        } else {
          dialog.onRequest?.(firstLine.split(' ')[0], raw, rinfo);
        }
        return;
      }

      if (firstLine.startsWith('SIP/2.0')) {
        // Registrar responses must match both the configured endpoint and the
        // complete outstanding transaction, not just a method substring.
        if (rinfo.address !== registrarIp || rinfo.port !== registrarPort) return;
        const headers = raw.split('\r\n\r\n', 1)[0];
        const uniqueHeader = (name: string): string | null => {
          const values = [...headers.matchAll(new RegExp(`^${name}:[ \t]*([^\r\n]+)`, 'gim'))];
          return values.length === 1 ? values[0][1].trim() : null;
        };
        const cseqVal = uniqueHeader('CSeq');
        const parsedCseq = cseqVal?.match(/^(\d+) (REGISTER|OPTIONS)$/);
        if (!parsedCseq || uniqueHeader('Call-ID') !== callId) return;
        const method = parsedCseq[2];
        const transaction = transactions.get(method);
        if (!transaction || parsedCseq[1] !== transaction.seq) return;
        // Via is a list: only the top entry identifies this transaction. Ignore
        // received/rport additions, but require an unambiguous branch and sent-by.
        const via = getHeader(headers, 'Via')?.split(',')[0];
        const parsedVia = via?.match(/^SIP\/2\.0\/UDP ([^;\s]+)((?:;.*)?)$/);
        const branches = parsedVia ? [...parsedVia[2].matchAll(/;branch=([^;\s,]+)/g)] : [];
        if (!parsedVia || parsedVia[1] !== transaction.sentBy || branches.length !== 1 ||
            branches[0][1] !== transaction.branch) return;
        if (Date.now() >= transaction.deadline) return;
        const { status, reason } = parseStatusLine(raw);
        if (status < 200 || status > 699) return; // provisional responses do not consume or extend timers
        retireTransaction(method); // consume before any callbacks / auth retry
        if (method === 'OPTIONS') {
          handleOptionsResponse(status, null);
          return;
        }
        if (status === 401 || status === 407) {
          const challengeHeader = getHeader(raw, status === 401 ? 'WWW-Authenticate' : 'Proxy-Authenticate');
          if (!challengeHeader) {
            log.error({ event: 'auth_missing', status }, `Got ${status} without auth challenge header`);
            registrationFailed(new Error(`SIP ${status} without challenge`));
            return;
          }
          if (transaction.authRetries >= maxAuthRetries) {
            registrationFailed(new Error('SIP REGISTER authentication retry limit exceeded'));
            return;
          }
          const params = parseAuthChallenge(challengeHeader);
          const registrarUri = `sip:${registrar}`;
          const ha1 = md5(`${config.SIP_USER}:${params['realm']}:${config.SIP_PASSWORD}`);
          const ha2 = md5(`REGISTER:${registrarUri}`);
          const response = md5(`${ha1}:${params['nonce']}:${ha2}`);
          const auth = `Digest username="${config.SIP_USER}", realm="${params['realm']}", nonce="${params['nonce']}", uri="${registrarUri}", response="${response}", algorithm=MD5`;
          log.debug({ event: 'auth_challenge', status }, `Responding to ${status} auth challenge`);
          sendRegister(auth, transaction.authRetries + 1);
        } else if (status === 200) {
          log.info({ event: 'sip_registered', expires: config.SIP_EXPIRES }, 'SIP 200 OK — registration confirmed');
          const refreshMs = Math.floor(config.SIP_EXPIRES * 0.9) * 1000;
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            log.debug({ event: 'sip_reregister' }, 'Re-registering before expiry');
            sendRegister();
          }, refreshMs);
          if (optionsTimer) clearInterval(optionsTimer);
          optionsTimer = setInterval(() => {
            const branch = `z9hG4bK${randomHex(6)}`;
            if (transactions.has('OPTIONS')) return; // do not overlap keepalives
            const seq = cseq++;
            const optBuf = Buffer.from(buildOptions(seq, branch));
            trackTransaction('OPTIONS', seq, branch);
            socket.send(optBuf, registrarPort, registrarIp, (err) => {
              if (err && transactions.get('OPTIONS')?.branch === branch) {
                retireTransaction('OPTIONS');
                handleOptionsResponse(0, err);
              }
              // else: wait for response via socket.on('message')
            });
          }, config.SIP_OPTIONS_INTERVAL * 1000);
          if (!settled) {
            settled = true;
            signal?.removeEventListener('abort', abort);
            resolve({
              registrarIp,
              stop() { cleanup(); },
              sendRaw(sendBuf: Buffer, port: number, host: string): void {
                socket.send(sendBuf, port, host, (err) => {
                  if (err) log.error({ err, event: 'sip_send_raw_error' }, 'sendRaw failed');
                });
              },
              registerDialog(dialogCallId: string, handlers: DialogHandlers): void {
                dialogs.set(dialogCallId, handlers);
              },
              unregisterDialog(dialogCallId: string): void {
                dialogs.delete(dialogCallId);
              },
              unregister(): Promise<void> {
                // Deregistration is send-only: retire registration so its response
                // (or a delayed previous response) cannot restart refresh timers.
                retireTransaction('REGISTER');
                const branch = `z9hG4bK${randomHex(6)}`;
                const sipUri = `sip:${config.SIP_USER}@${config.SIP_DOMAIN}`;
                const registrarUri = `sip:${registrar}`;
                const msg = [
                  `REGISTER ${registrarUri} SIP/2.0`,
                  `Via: SIP/2.0/UDP ${localIp}:${localPort};branch=${branch};rport`,
                  'Max-Forwards: 70',
                  `From: <${sipUri}>;tag=${fromTag}`,
                  `To: <${sipUri}>`,
                  `Call-ID: ${callId}`,
                  `CSeq: ${cseq++} REGISTER`,
                  'Contact: *',
                  'Expires: 0',
                  'Content-Length: 0',
                  '',
                ].join('\r\n') + '\r\n';
                return new Promise<void>((resolveSend, rejectSend) => {
                  socket.send(Buffer.from(msg), registrarPort, registrarIp, (err) => {
                    if (err) {
                      log.error({ err, event: 'sip_unregister_error' }, 'unregister send failed');
                      rejectSend(err);
                    } else resolveSend();
                  });
                });
              },
            });
          }
        } else {
          log.error({ event: 'sip_register_failed', status, reason }, `SIP registration rejected: ${status} ${reason}`);
          registrationFailed(new Error(`SIP ${status} ${reason}`));
        }
      } else if (firstLine.startsWith('INVITE ')) {
        callbacks?.onInvite?.(raw, rinfo);
      } else if (firstLine.startsWith('ACK ')) {
        callbacks?.onAck?.(raw, rinfo);
      } else if (firstLine.startsWith('BYE ')) {
        callbacks?.onBye?.(raw, rinfo);
      } else if (firstLine.startsWith('CANCEL ')) {
        callbacks?.onCancel?.(raw, rinfo);
      } else if (firstLine.startsWith('OPTIONS ')) {
        // Respond 200 OK to OPTIONS keepalive (defends against sipgate liveness probes)
        const via = getHeader(raw, 'Via') ?? '';
        const from = getHeader(raw, 'From') ?? '';
        const to = getHeader(raw, 'To') ?? '';
        const callIdVal = getHeader(raw, 'Call-ID') ?? '';
        const cseqVal = getHeader(raw, 'CSeq') ?? '';
        const response = [
          'SIP/2.0 200 OK',
          `Via: ${via}`,
          `From: ${from}`,
          `To: ${to}`,
          `Call-ID: ${callIdVal}`,
          `CSeq: ${cseqVal}`,
          `User-Agent: ${USER_AGENT}`,
          'Content-Length: 0',
          '',
        ].join('\r\n') + '\r\n';
        socket.send(Buffer.from(response), rinfo.port, rinfo.address);
      }
      // other methods (REGISTER requests from proxies etc.) silently ignored
    });

    socket.bind(localPort, bindHost, () => {
      if (!stopped) sendRegister();
    });
  });
}

async function resolveRegistrar(registrar: string, signal?: AbortSignal): Promise<string> {
  if (net.isIPv4(registrar)) return registrar;
  const resolver = new dns.Resolver();
  const cancel = () => resolver.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    const addresses = await resolver.resolve4(registrar);
    if (!addresses[0]) throw new Error('SIP registrar has no IPv4 address');
    return addresses[0];
  } finally { signal?.removeEventListener('abort', cancel); }
}
