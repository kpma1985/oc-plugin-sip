import { it, expect, vi } from 'vitest';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { startSipPlugin } from '../src/index.js';
vi.mock('openclaw/plugin-sdk/secret-input-runtime', () => ({
  resolveConfiguredSecretInputString: vi.fn(async ({ value }: { value: { id: string } }) => ({
    value: value.id.endsWith('_USER') ? 'test-user' : 'test-password',
  })),
}));
vi.mock('openclaw/plugin-sdk/core', () => ({
  buildJsonChannelConfigSchema: (schema: any, options: any) => ({ schema, ...options }),
  createChatChannelPlugin: ({ base }: any) => base,
  defineChannelPluginEntry: ({ plugin, registerFull, ...rest }: any) => ({
    ...rest,
    register: (api: any) => { api.registerChannel({ plugin }); registerFull(api); }
  }),
}));
import entry, { registerSipRuntime } from '../src/plugin.js';
import { CallSession } from '../src/media/callSession.js';
import { speakAnnouncement } from '../src/voice/voiceCall.js';
vi.mock('../src/voice/voiceCall.js', () => ({ VoiceCall: vi.fn(), speakAnnouncement: vi.fn(async () => { }) }));

const ctxFor = (controller = new AbortController()) => ({
  accountId: 'default', abortSignal: controller.signal, setStatus: vi.fn(), getStatus: () => ({ accountId: 'default' }),
});

it('resolves Store credentials before starting SIP and skips shadowed legacy references', async () => {
  const ref = (id: string) => ({ source: 'store', provider: 'default', id });
  const api = {
    config: { channels: { sip: { enabled: true, sip: {
      user: ref('SIP_ACCOUNT01_USER'), password: ref('SIP_ACCOUNT01_PASSWORD'),
    } } } },
    pluginConfig: { sip: { user: ref('LEGACY_USER'), password: ref('LEGACY_PASSWORD') } },
    registerGatewayMethod: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() },
  } as unknown as OpenClawPluginApi;
  const stop = vi.fn(async () => {});
  const start = vi.fn(async (_config: unknown) => ({ stop }));
  const run = registerSipRuntime(api, start as unknown as typeof startSipPlugin);
  const controller = new AbortController();
  const done = run(ctxFor(controller));
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(start.mock.calls[0]?.[0]).toMatchObject({ sip: { user: 'test-user', password: 'test-password' } });
  controller.abort();
  await done;
  expect(stop).toHaveBeenCalledOnce();
});

it('registers real entry surfaces, disabled account never binds', async () => {
  const api = {
    pluginConfig: { enabled: false }, registerChannel: vi.fn(), registerGatewayMethod: vi.fn(),
    registerService: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as OpenClawPluginApi;
  expect(entry.register?.(api)).toBeUndefined();
  expect(api.registerChannel).toHaveBeenCalledWith(expect.objectContaining({ plugin: expect.objectContaining({ id: 'sip' }) }));
  expect(api.registerGatewayMethod).toHaveBeenCalledWith('sip.deepgram.models', expect.any(Function), { scope: 'operator.read' });
  expect(api.registerService).not.toHaveBeenCalled();
  const start = vi.fn();
  const run = registerSipRuntime(api, start as unknown as typeof startSipPlugin);
  const controller = new AbortController();
  const done = run(ctxFor(controller)); controller.abort(); await done;
  expect(start).not.toHaveBeenCalled();
});

it('startAccount stays pending until abort, reports status, then stops', async () => {
  const api = {
    pluginConfig: { enabled: true, transport: 'embedded' }, registerGatewayMethod: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as OpenClawPluginApi;
  const stop = vi.fn(async () => { });
  const start = vi.fn(async () => ({ stop }));
  const run = registerSipRuntime(api, start as unknown as typeof startSipPlugin);
  const controller = new AbortController(), ctx = ctxFor(controller);
  let settled = false;
  const done = run(ctx).then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  expect(ctx.setStatus).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
  controller.abort(); await done;
  expect(stop).toHaveBeenCalledTimes(1);
  expect(ctx.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({ connected: false }));
});

it('abort racing startup still stops the handle', async () => {
  const api = {
    pluginConfig: { enabled: true, transport: 'embedded' }, registerGatewayMethod: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as OpenClawPluginApi;
  const stop = vi.fn(async () => { });
  let ready!: (value: any) => void;
  const start = vi.fn(() => new Promise(resolve => { ready = resolve; }));
  const run = registerSipRuntime(api, start as unknown as typeof startSipPlugin);
  const controller = new AbortController();
  const done = run(ctxFor(controller)); controller.abort(); ready({ stop });
  await done; expect(stop).toHaveBeenCalledTimes(1);
});

it('rejection immediately hangs up without announcement or mark ACK', async () => {
  let hooks: any;
  const api = {
    pluginConfig: {
      enabled: true, transport: 'embedded', voice: { enabled: true },
      stt: { apiKey: 'fake' }, tts: { apiKey: 'fake' }
    }, registerGatewayMethod: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as OpenClawPluginApi;
  const hangup = vi.fn(), stop = vi.fn(async () => { });
  const start = vi.fn(async (_config: unknown, value: unknown) => { hooks = value; return { hangup, stop }; });
  const run = registerSipRuntime(api, start as unknown as typeof startSipPlugin);
  const controller = new AbortController(); const done = run(ctxFor(controller));
  await new Promise(resolve => setTimeout(resolve, 10));
  const session = new CallSession({ streamSid: 'reject', callSid: 'CAreject', from: '+49123', onSend: () => { } });
  session.activate(); const mark = vi.spyOn(session, 'mark');
  expect(hooks.admitCall(session, {})).toBe(false);
  await Promise.resolve(); await Promise.resolve();
  expect(speakAnnouncement).not.toHaveBeenCalled();
  expect(mark).not.toHaveBeenCalled();
  expect(hooks.onMark).toBeUndefined();
  expect(hangup).toHaveBeenCalledWith(session, 'sip-rejected');
  session.end('test'); controller.abort(); await done;
});
