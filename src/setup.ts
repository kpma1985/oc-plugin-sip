import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { defineChannelSetupContract, type ChannelSetupWizard } from 'openclaw/plugin-sdk/channel-setup';
import { isIPv4 } from 'node:net';
import { resolveSipConfig } from './channelConfig.js';
import { validateForTransport } from './config.js';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Raw leaves only: never persist runtime defaults or materialize existing secrets. */
export function setupValue(cfg: OpenClawConfig, section: string, key: string): unknown {
  const channel = object(cfg.channels?.['sip']);
  const legacy = object(cfg.plugins?.entries?.['sip']?.config);
  return object(channel[section])[key] ?? object(legacy[section])[key];
}
export function patchSipSetup(cfg: OpenClawConfig, patch: Record<string, unknown>): OpenClawConfig {
  const channel = object(cfg.channels?.['sip']);
  const next = { ...channel, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = { ...object(channel[key]), ...object(value) };
    }
  }
  return { ...cfg, channels: { ...cfg.channels, sip: next } };
}
function defaultAccount(accountId?: string): string {
  if (accountId && accountId !== 'default') throw new Error('SIP supports only account "default"');
  return 'default';
}
function setupProblems(cfg: OpenClawConfig): string[] {
  // Runtime resolves secrets later. Validate structure without exposing/rewriting refs.
  let candidate = cfg;
  for (const [section, key] of [['sip', 'password'], ['stt', 'apiKey'], ['tts', 'apiKey']] as const) {
    const value = setupValue(cfg, section, key);
    if (value && typeof value === 'object') candidate = patchSipSetup(candidate, { [section]: { [key]: 'secret-reference' } });
  }
  try {
    const config = resolveSipConfig(candidate);
    const problems = validateForTransport(config);
    if (config.transport !== 'embedded') problems.push('SIP channel requires embedded transport');
    if (config.inbound.policy === 'allowlist' && !config.inbound.allowFrom.length) problems.push('inbound.allowFrom requires at least one E.164 caller');
    if (config.inbound.allowFrom.some(value => !/^\+[1-9]\d{1,14}$/.test(value))) problems.push('inbound.allowFrom must contain E.164 callers');
    return problems;
  } catch { return ['SIP configuration invalid; check channel settings']; }
}

export const sipSetupContract: ReturnType<typeof defineChannelSetupContract> = defineChannelSetupContract({
  fields: {},
  adapter: {
    resolveAccountId: ({ accountId }) => defaultAccount(accountId),
    validateInput: ({ cfg, accountId }) => {
      defaultAccount(accountId);
      return setupProblems(cfg).join('; ') || null;
    },
    applyAccountConfig: ({ cfg, accountId }) => {
      defaultAccount(accountId);
      const problems = setupProblems(cfg);
      if (problems.length) throw new Error(problems.join('; '));
      return patchSipSetup(cfg, { enabled: true });
    },
  },
});

function text(section: string, key: string, message: string, validate?: (value: string) => string | undefined): NonNullable<ChannelSetupWizard['textInputs']>[number] {
  return {
    inputKey: `${section}.${key}`, message, required: true,
    currentValue: ({ cfg }) => {
      const value = setupValue(cfg, section, key);
      return typeof value === 'string' ? value : undefined;
    },
    confirmCurrentValue: true, applyCurrentValue: false,
    keepPrompt: 'Keep the existing value?',
    validate: ({ value }) => validate?.(value) ?? (value.trim() ? undefined : 'A value is required'),
    normalizeValue: ({ value }) => value.trim(),
    applySet: ({ cfg, value }) => patchSipSetup(cfg, { [section]: { [key]: value } }),
  };
}
function credential(section: string, key: string, label: string): ChannelSetupWizard['credentials'][number] {
  return {
    inputKey: `${section}.${key}`, providerHint: 'sip', credentialLabel: label,
    envPrompt: 'Use an environment value?', keepPrompt: `Keep ${label}?`, inputPrompt: `Enter ${label}`,
    allowEnv: () => false,
    shouldPrompt: ({ cfg }) => section === 'sip' || setupValue(cfg, 'voice', 'enabled') === true,
    inspect: ({ cfg }) => {
      const value = setupValue(cfg, section, key);
      return { accountConfigured: Boolean(value), hasConfiguredValue: Boolean(value) };
    },
    applySet: ({ cfg, value }) => patchSipSetup(cfg, { [section]: { [key]: value } }),
  };
}

export const sipSetupWizard: ChannelSetupWizard = {
  channel: 'sip',
  status: {
    configuredLabel: 'SIP configured', unconfiguredLabel: 'SIP not configured',
    resolveConfigured: ({ cfg }) => setupProblems(cfg).length === 0,
  },
  resolveAccountIdForConfigure: ({ accountOverride }) => defaultAccount(accountOverride),
  resolveShouldPromptAccountIds: () => false,
  introNote: { title: 'SIP Telephony', lines: ['One account: default. Existing settings and credentials are preserved.', 'Embedded SIP needs a public IPv4 and open SIP/RTP ports. No connectivity tests run during setup.'] },
  prepare: async ({ cfg, prompter }) => {
    const voice = await prompter.confirm({ message: 'Enable voice replies (STT and TTS required)?', initialValue: setupValue(cfg, 'voice', 'enabled') === true });
    // Do not silently change an explicitly selected unsupported transport.
    if (object(cfg.channels?.['sip'])['transport'] === 'bridge' ||
      (object(cfg.channels?.['sip'])['transport'] === undefined && object(cfg.plugins?.entries?.['sip']?.config)['transport'] === 'bridge')) {
      if (!await prompter.confirm({ message: 'The SIP channel requires embedded transport. Change transport to embedded?', initialValue: false })) throw new Error('SIP channel requires embedded transport');
    }
    let next = patchSipSetup(cfg, { transport: 'embedded', voice: { enabled: voice } });
    if (voice) {
      const current = setupValue(cfg, 'tts', 'provider');
      const provider = await prompter.select({ message: 'TTS provider', options: ['deepgram', 'elevenlabs', 'custom'].map(value => ({ value, label: value })), initialValue: typeof current === 'string' ? current : undefined });
      next = patchSipSetup(next, { tts: { provider } });
      if (provider === 'custom' && setupValue(next, 'tts', 'sourceSampleRate') !== 24000) {
        if (!await prompter.confirm({ message: 'Does this TTS endpoint return mono PCM16-LE at 24000 Hz? Confirm only after verifying.', initialValue: false })) {
          throw new Error('Custom TTS requires confirmed mono PCM16-LE at 24000 Hz');
        }
        next = patchSipSetup(next, { tts: { sourceSampleRate: 24000 } });
      }
    }
    return { cfg: next };
  },
  stepOrder: 'text-first',
  textInputs: [
    text('sip', 'user', 'SIP user'),
    text('sip', 'domain', 'SIP domain'),
    text('sip', 'registrar', 'SIP registrar'),
    text('sip', 'publicIp', 'Public IPv4 for SIP/RTP', value => isIPv4(value) ? undefined : 'IPv4 required'),
    {
      inputKey: 'allowFrom', message: 'Allowed callers (E.164, comma or space separated)', required: true,
      shouldPrompt: ({ cfg }) => setupValue(cfg, 'inbound', 'policy') !== 'open',
      currentValue: ({ cfg }) => { const value = setupValue(cfg, 'inbound', 'allowFrom'); return Array.isArray(value) ? value.join(', ') : undefined; },
      confirmCurrentValue: true, applyCurrentValue: false,
      validate: ({ value }) => value.trim().split(/[\s,;]+/).every(entry => /^\+[1-9]\d{1,14}$/.test(entry)) ? undefined : 'E.164 required',
      applySet: ({ cfg, value }) => patchSipSetup(cfg, { inbound: { allowFrom: value.trim().split(/[\s,;]+/) } }),
    },
    ...['model', 'voice'].map(key => ({
      ...text('tts', key, `TTS ${key}`),
      shouldPrompt: ({ cfg }: { cfg: OpenClawConfig }) => setupValue(cfg, 'voice', 'enabled') === true && ['elevenlabs', 'custom'].includes(String(setupValue(cfg, 'tts', 'provider'))),
    })),
  ],
  credentials: [credential('sip', 'password', 'SIP password'), credential('stt', 'apiKey', 'STT API key'), credential('tts', 'apiKey', 'TTS API key')],
  finalize: ({ cfg }) => {
    const problems = setupProblems(cfg);
    if (problems.length) throw new Error(problems.join('; '));
    return { cfg: patchSipSetup(cfg, { enabled: true }) };
  },
  disable: cfg => patchSipSetup(cfg, { enabled: false }),
};
