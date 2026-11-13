/**
 * Media WebSocket endpoint. Two producers can attach:
 *  - transport "embedded": our own SIP UAS (vendor/sip-bridge) connects locally
 *  - transport "bridge":   an external Twilio-Media-Streams gateway (e.g.
 *    sipgate-sip-stream-bridge) connects over loopback or the LAN.
 *
 * Both speak the same protocol, so the agent side never learns which one is in
 * use. This module owns protocol parsing, call registration and audio pacing;
 * consumers only see CallSession objects and typed events.
 */
import { EventEmitter } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';

import { CallRegistry, CallSession } from './callSession.js';
import { codecFromFormat } from './codecs.js';
import {
  decodeMediaPayload,
  TELEPHONY_SAMPLE_RATE,
  parseMediaStreamsFrame,
  type TwilioDtmfEvent,
  type TwilioMarkEvent,
  type TwilioMediaEvent,
  type TwilioStartEvent,
} from './twilioFrames.js';

export interface MediaServerOptions {
  host: string;
  port: number;
  path: string;
  authToken?: string;
  onLog?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface MediaServerEvents {
  call: [CallSession, Record<string, string>];
  audio: [CallSession, Uint8Array];
  dtmf: [CallSession, string];
  mark: [CallSession, string];
  end: [string, string, CallSession];
  error: [Error];
}

export class MediaServer extends EventEmitter<MediaServerEvents> {
  readonly registry = new CallRegistry();

  private server: WebSocketServer | null = null;
  private stopping: Promise<void> | null = null;
  private readonly options: MediaServerOptions;

  constructor(options: MediaServerOptions) {
    super();
    this.options = options;
  }

  /** Bind the media endpoint. Rejects when host/port/path are unusable. */
  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const { host, port, path } = this.options;
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host,
        port,
        path,
        verifyClient: (info, callback) => {
          if (!this.options.authToken) {
            callback(true);
            return;
          }
          const authHeader = info.req.headers['authorization'];
          let token: string | undefined;
          if (authHeader?.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
          } else {
            try {
              const parsedUrl = new URL(info.req.url ?? '', `http://${info.req.headers.host ?? 'localhost'}`);
              token = parsedUrl.searchParams.get('token') ?? undefined;
            } catch {
              // bad url
            }
          }
          if (token && token === this.options.authToken) {
            callback(true);
          } else {
            this.options.onLog?.('media-unauthorized', {
              remote: info.req.socket.remoteAddress ?? 'unknown',
            });
            callback(false, 401, 'Unauthorized');
          }
        },
      });
      server.once('listening', () => {
        this.server = server;
        resolve();
      });
      server.once('error', (err: Error) => {
        server.close();
        reject(err);
      });
      server.on('connection', (socket, request) =>
        this.attach(socket, request.socket.remoteAddress ?? 'unknown'),
      );
    });
  }

  get address(): { address: string; port: number } | null {
    const addr = this.server?.address();
    return typeof addr === 'object' && addr !== null ? { address: addr.address, port: addr.port } : null;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.registry.terminateAll('server-stop');
    const server = this.server;
    this.server = null;
    this.stopping = new Promise<void>((resolve, reject) => {
      if (!server) { resolve(); return; }
      for (const socket of server.clients) socket.terminate();
      server.close((error) => error ? reject(error) : resolve());
    });
    return this.stopping;
  }

  /** Diagnostics must not become an unhandled EventEmitter error (or throw from a listener). */
  private reportError(error: unknown): void {
    try {
      if (this.listenerCount('error'))
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
    catch { /* diagnostic hooks are not a process failure boundary */ }
  }
  private log(message: string, fields?: Record<string, unknown>): void {
    try {
      this.options.onLog?.(message, fields);
    }
    catch (error) {
      this.reportError(error);
    }
  }
  private attach(socket: WebSocket, remote: string): void {
    let session: CallSession | null = null;
    const fail = (error: unknown): void => {
      try {
        session?.end('media-message-error');
      }
      catch (cleanupError) {
        this.reportError(cleanupError);
      }
      finally {
        socket.terminate();
      }
      this.reportError(error);
    };
    this.log('media-connection-open', { remote });
    socket.on('message', (data) => {
      try {
        const event = parseMediaStreamsFrame(String(data));
        if (!event)
          return;
        // A socket can only address its own call, never another client's stream ID.
        if (event.event !== 'start' && 'streamSid' in event &&
          (!session || event.streamSid !== session.streamSid || session.currentState === 'ended'))
          return;
        switch (event.event) {
          case 'start': {
            // Reject before constructing/registering a session or invoking any call hooks.
            if (session || this.registry.get(event.streamSid)) {
              socket.terminate();
              return;
            }
            const start = (event as TwilioStartEvent).start;
            const format = start.mediaFormat;
            const codec = format ? codecFromFormat(format.encoding ?? '', format.sampleRate ?? 0) : 'pcmu';
            if (!codec || (format?.channels !== undefined && format.channels !== 1)) {
              throw new Error('Unsupported mono media stream codec or sample rate');
            }
            const custom = start.customParameters ?? {};
            const started = new CallSession({
              streamSid: event.streamSid,
              codec,
              callSid: start.callSid,
              from: custom['From'] ?? custom['from'] ?? custom['caller'],
              to: custom['To'] ?? custom['to'] ?? custom['dialed'],
              onSend: (payload) => {
                try {
                  if (socket.readyState !== socket.OPEN)
                    return;
                  if (socket.bufferedAmount + Buffer.byteLength(payload) > 262144) {
                    started.end('media-backpressure');
                    return;
                  }
                  socket.send(payload, error => { if (error)
                    fail(error); });
                }
                catch (error) {
                  fail(error);
                }
              },
              onEnd: (reason) => {
                this.registry.remove(started);
                try {
                  this.emit('end', started.streamSid, reason, started);
                }
                catch (error) {
                  this.reportError(error);
                }
                finally {
                  socket.terminate();
                }
              },
            });
            session = started;
            this.registry.add(started);
            started.activate();
            this.options.onLog?.('call-start', { streamSid: started.streamSid, remote });
            this.emit('call', started, custom);
            break;
          }
          case 'media':
            if (session)
              this.emit('audio', session, decodeMediaPayload(event as TwilioMediaEvent));
            break;
          case 'dtmf':
            if (session)
              this.emit('dtmf', session, (event as TwilioDtmfEvent).dtmf.digit);
            break;
          case 'mark':
            if (session)
              this.emit('mark', session, (event as TwilioMarkEvent).mark.name);
            break;
          case 'stop':
            session?.end('gateway-stop');
            break;
          default:
            break;
        }
      }
      catch (error) {
        fail(error);
      }
    });
    socket.on('close', () => {
      try {
        session?.end('websocket-close');
      }
      catch (error) {
        this.reportError(error);
      }
      this.log('media-connection-close', { remote });
    });
    socket.on('error', fail);
  }
}
