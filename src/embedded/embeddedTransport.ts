import { Writable } from 'node:stream';
import { CallManager } from '../../vendor/sip-bridge/src/bridge/callManager.js';
import { createMaskedLogger } from '../../vendor/sip-bridge/src/logger/index.js';
import { createSipUserAgent, type SipHandle } from '../../vendor/sip-bridge/src/sip/userAgent.js';
import type { SipPluginConfig } from '../config.js';
import { mapEmbeddedConfig } from './config.js';

export interface EmbeddedHandle { stop(): Promise<void>; terminateCall?(callSid: string, reason: string): boolean }
export interface EmbeddedDependencies {
  createManager: (...args: ConstructorParameters<typeof CallManager>) => Pick<CallManager, 'getCallbacks' | 'setSipHandle' | 'terminateAll'> & Partial<Pick<CallManager, 'terminateByCallSid'>>;
  createAgent: typeof createSipUserAgent;
  startupTimeoutMs: number;
}
const defaults: EmbeddedDependencies = {
  createManager: (config, log) => new CallManager(config, log),
  createAgent: createSipUserAgent,
  startupTimeoutMs: 15_000,
};

/** Execute every cleanup step, preserving every failure. */
export async function cleanupAll(steps: Array<() => void | Promise<void>>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try { await step(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'SIP cleanup failed');
}

export async function startEmbeddedTransport(
  config: SipPluginConfig,
  address: { address: string; port: number },
  onLog?: (message: string, fields?: Record<string, unknown>) => void,
  overrides: Partial<EmbeddedDependencies> = {},
): Promise<EmbeddedHandle> {
  const deps = { ...defaults, ...overrides };
  const mapped = mapEmbeddedConfig(config, address);
  const destination = onLog ? new Writable({
    write(chunk, _encoding, done) {
      try {
        const entry = JSON.parse(String(chunk)) as Record<string, unknown>;
        onLog(String(entry['msg'] ?? 'sip'), entry);
        done();
      } catch (error) { done(error instanceof Error ? error : new Error(String(error))); }
    },
  }) : process.stdout;
  const log = createMaskedLogger([mapped.SIP_PASSWORD, mapped.SIP_USER], destination);
  const manager = deps.createManager(mapped, log);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('SIP registration startup timeout')), deps.startupTimeoutMs);
  let sip: SipHandle | undefined;
  try {
    sip = await deps.createAgent(mapped, log, manager.getCallbacks(), controller.signal);
    manager.setSipHandle(sip);
  } catch (error) {
    try { await cleanupAll([() => manager.terminateAll(), () => sip?.stop()]); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'SIP startup and cleanup failed'); }
    throw error;
  } finally { clearTimeout(timer); }
  const handle = sip;
  let stopping: Promise<void> | undefined;
  return {
    terminateCall: (callSid, reason) => manager.terminateByCallSid?.(callSid, reason) ?? false,
    stop: () => stopping ??= cleanupAll([
      () => manager.terminateAll(), () => handle.unregister(), () => handle.stop(),
    ])
  };
}
