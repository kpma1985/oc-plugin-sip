import { describe, expect, it, vi } from 'vitest';
import type { OpenClawConfig, OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { WizardPrompter } from 'openclaw/plugin-sdk/setup-runtime';
import entry from '../src/plugin.js';
import { patchSipSetup, setupValue, sipSetupContract, sipSetupWizard } from '../src/setup.js';
import { resolveSipConfig } from '../src/channelConfig.js';

const trunk = { user: 'test-user', password: '${TEST_SIP_PASSWORD}', domain: 'sip.example.test', registrar: 'registrar.example.test', publicIp: '192.0.2.10' };
const existing = (): OpenClawConfig => ({
  plugins: { entries: { sip: { config: { sip: trunk, media: { port: 9000 }, inbound: { allowFrom: ['+12025550123'], greeting: 'Existing' }, tts: { provider: 'elevenlabs', model: 'custom', voice: 'custom-voice', apiKey: '${TEST_TTS_KEY}' }, stt: { apiKey: '${TEST_STT_KEY}' } } } } },
  channels: { sip: { heartbeatVisibility: { showOk: false }, sip: { listenAddr: '127.0.0.1:5068' }, voice: { playbackPrebufferMs: 120, engine: 'deepgram-agent', agent: { prompt: 'Test', think: { model: 'gpt-4o-mini' } } } } },
});
const prompter = (): WizardPrompter => ({
  intro: vi.fn(), outro: vi.fn(), note: vi.fn(), progress: vi.fn(),
  confirm: vi.fn(async () => true), select: vi.fn(async params => params.initialValue ?? params.options[0]!.value),
  multiselect: vi.fn(async () => []), text: vi.fn(async () => { throw new Error('Unexpected text prompt'); }),
});

/** Replay documented declarative callbacks; SDK registration itself tested below. */
async function runWizard(cfg: OpenClawConfig, p: WizardPrompter): Promise<OpenClawConfig> {
  const context = () => ({ cfg, accountId: 'default', credentialValues: {}, runtime: {} as never, prompter: p, forceAllowFrom: false });
  const prepared = await sipSetupWizard.prepare?.(context());
  cfg = prepared?.cfg ?? cfg;
  for (const input of sipSetupWizard.textInputs ?? []) {
    const ctx = context();
    const currentValue = await input.currentValue?.(ctx);
    if (input.shouldPrompt && !await input.shouldPrompt({ ...ctx, currentValue })) continue;
    if (currentValue && await p.confirm({ message: 'Keep?', initialValue: true })) continue;
    const value = await p.text({ message: input.message });
    const error = input.validate?.({ ...ctx, value });
    if (error) throw new Error(error);
    cfg = await input.applySet!({ cfg, accountId: 'default', value });
  }
  for (const credential of sipSetupWizard.credentials) {
    const ctx = context(), state = credential.inspect(ctx);
    if (credential.shouldPrompt && !await credential.shouldPrompt({ ...ctx, state })) continue;
    if (state.hasConfiguredValue && await p.confirm({ message: credential.keepPrompt })) continue;
    const value = await p.text({ message: credential.inputPrompt, sensitive: true });
    cfg = await credential.applySet!({ ...ctx, value, resolvedValue: value });
  }
  const finalized = await sipSetupWizard.finalize?.(context());
  return finalized?.cfg ?? cfg;
}

describe('SIP guided setup', () => {
  it('real SDK exposes wizard and channel-owned adapter in setup registration', () => {
    const registerChannel = vi.fn();
    entry.register?.({ registrationMode: 'setup-only', config: {}, registerChannel } as unknown as OpenClawPluginApi);
    expect(registerChannel).toHaveBeenCalledOnce();
    const plugin = registerChannel.mock.calls[0]![0].plugin;
    expect(plugin.setupWizard).toBe(sipSetupWizard);
    expect(plugin.setupContract).toBe(sipSetupContract);
    expect(plugin.meta.docsPath).toContain('/README.md');
    expect(plugin.configSchema).toBeDefined();
  });
  it('keeps raw legacy credentials and settings; enables default account without defaults migration', async () => {
    const cfg = existing(), before = structuredClone(cfg), p = prompter();
    const result = await runWizard(cfg, p);
    expect(cfg).toEqual(before);
    expect(result.plugins).toBe(cfg.plugins);
    expect(p.text).not.toHaveBeenCalled();
    expect(setupValue(result, 'sip', 'password')).toBe(trunk.password);
    const config = resolveSipConfig(result);
    expect(config.enabled).toBe(true);
    expect(config.media.port).toBe(9000);
    expect(config.voice.playbackPrebufferMs).toBe(120);
    expect(config.inbound.greeting).toBe('Existing');
    expect(config.tts.model).toBe('custom');
    expect(config.tts.voice).toBe('custom-voice');
    expect(result.channels?.['sip']).not.toHaveProperty('stt');
    expect(result.channels?.['sip']).toHaveProperty('heartbeatVisibility.showOk', false);
  });
  it('collects fresh operator-supplied trunk and caller inputs; never hardcodes provider or phone', async () => {
    const p = prompter();
    p.confirm = vi.fn(async () => false); // explicitly choose no voice
    const answers = ['operator', 'domain.example.test', 'registrar.example.test', '192.0.2.20', '+12025550124', 'test-password'];
    p.text = vi.fn(async () => answers.shift()!);
    const result = await runWizard({}, p);
    expect(resolveSipConfig(result).enabled).toBe(true);
    expect(setupValue(result, 'sip', 'domain')).toBe('domain.example.test');
    expect(setupValue(result, 'sip', 'password')).toBe('test-password');
    expect(setupValue(result, 'tts', 'provider')).toBeUndefined();
    expect(setupValue(result, 'inbound', 'allowFrom')).toEqual(['+12025550124']);
    expect(answers).toHaveLength(0);
  });
  it('rejects named accounts, incomplete config and invalid caller/IP inputs', () => {
    expect(() => sipSetupContract.resolveAccountId?.({ cfg: {}, accountId: 'other' })).toThrow('default');
    expect(() => sipSetupContract.applyAccountConfig({ cfg: {}, accountId: 'default', input: {} })).toThrow('sip.user');
    const ip = sipSetupWizard.textInputs!.find(step => step.inputKey === 'sip.publicIp')!;
    expect(ip.validate!({ cfg: {}, accountId: 'default', credentialValues: {}, value: 'not-ip' })).toBeTruthy();
    const callers = sipSetupWizard.textInputs!.find(step => step.inputKey === 'allowFrom')!;
    expect(callers.validate!({ cfg: {}, accountId: 'default', credentialValues: {}, value: '0123' })).toBeTruthy();
  });
  it('preserves opaque secret refs in keep path and never sends resolved values to client', async () => {
    const cfg = patchSipSetup(existing(), { sip: { password: { source: 'env', provider: 'default', id: 'TEST_PASSWORD' } } });
    const state = sipSetupWizard.credentials[0]!.inspect({ cfg, accountId: 'default' });
    expect(state.hasConfiguredValue).toBe(true);
    expect(state.resolvedValue).toBeUndefined();
    const result = await runWizard(cfg, prompter());
    expect(setupValue(result, 'sip', 'password')).toBe(setupValue(cfg, 'sip', 'password'));
  });
  it('cancelled preparation leaves original config untouched', async () => {
    const cfg = existing(), before = structuredClone(cfg), p = prompter();
    p.select = vi.fn(async () => { throw new Error('cancelled'); });
    await expect(runWizard(cfg, p)).rejects.toThrow('cancelled');
    expect(cfg).toEqual(before);
  });
  it('requires explicit bridge switch and PCM format confirmation', async () => {
    const cfg = existing(), p = prompter();
    p.confirm = vi.fn(async params => params.message.startsWith('Enable voice replies'));
    await expect(runWizard(patchSipSetup(cfg, { transport: 'bridge' }), p)).rejects.toThrow('embedded');
    p.select = async params => params.options.find(option => option.value === 'custom')!.value;
    await expect(runWizard(cfg, p)).rejects.toThrow('confirmed mono PCM16-LE');
    expect(setupValue(cfg, 'tts', 'sourceSampleRate')).toBeUndefined();
  });
  it('contract enables existing settings without rewriting legacy credentials', () => {
    const cfg = existing();
    expect(sipSetupContract.validateInput?.({ cfg, accountId: 'default', input: {} })).toBeNull();
    const result = sipSetupContract.applyAccountConfig({ cfg, accountId: 'default', input: {} });
    expect(result.plugins).toBe(cfg.plugins);
    expect(result.channels?.['sip']).toHaveProperty('enabled', true);
    expect(result.channels?.['sip']).not.toHaveProperty('sip.password');
  });
});
