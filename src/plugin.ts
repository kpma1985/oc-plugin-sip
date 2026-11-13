import { buildJsonChannelConfigSchema, createChatChannelPlugin, defineChannelPluginEntry, type OpenClawPluginApi, type OpenClawPluginDefinition } from 'openclaw/plugin-sdk/core';
import manifest from '../openclaw.plugin.json' with { type: 'json' };
import { authoredSipConfigSchema } from './config.js';
import { resolveSipConfig } from './channelConfig.js';
import { sipSetupContract, sipSetupWizard } from './setup.js';
import { startSipPlugin, type SipPluginHandle } from './index.js';
import { dispatchSipTurn, SipAdmission } from './channel.js';
import { registerDeepgramModelDiscovery } from './voice/deepgramModels.js';
import { isSipStoreRef, resolveSipSecretInputs, sipConfigForValidation } from './sipSecrets.js';
import type { CallSession } from './media/callSession.js';

type SipRunContext = {
  accountId: string; cfg?: unknown; abortSignal: AbortSignal;
  getStatus?: () => Record<string, unknown>; setStatus?: (next: any) => void;
};
type SipRun = (ctx: SipRunContext) => Promise<void>;
let activeRun: SipRun | undefined;
const HEARTBEAT_MS = 60_000;

const waitUntilAbort = (signal: AbortSignal): Promise<void> => new Promise(resolve => {
  if (signal.aborted) return resolve();
  signal.addEventListener('abort', () => resolve(), { once: true });
});

export function registerSipRuntime(api: OpenClawPluginApi,
  start: typeof startSipPlugin = startSipPlugin): SipRun {
  registerDeepgramModelDiscovery(api, () => {
    const config = resolveSipConfig({ ...api.config, channels: {
      ...api.config?.channels, sip: sipConfigForValidation(api.config?.channels?.['sip']),
    } } as typeof api.config, sipConfigForValidation(api.pluginConfig));
    return config.stt.apiKey ?? (config.tts.provider === 'deepgram' ? config.tts.apiKey : undefined);
  });
  const run: SipRun = async ctx => {
    const hostConfig = (ctx.cfg ?? api.config) as typeof api.config;
    const authored = hostConfig?.channels?.['sip'];
    const legacy = api.pluginConfig ?? hostConfig?.plugins?.entries?.['sip']?.config;
    const checked = resolveSipConfig({ ...hostConfig, channels: {
      ...hostConfig?.channels, sip: sipConfigForValidation(authored),
    } } as typeof api.config, sipConfigForValidation(legacy));
    if (!checked.enabled) { await waitUntilAbort(ctx.abortSignal); return; }
    const legacyCopy = structuredClone(legacy) as { sip?: Record<string, unknown> } | undefined;
    const channelTrunk = (authored as { sip?: Record<string, unknown> } | undefined)?.sip;
    for (const field of ['user', 'password']) {
      if (channelTrunk?.[field] !== undefined && legacyCopy?.sip) delete legacyCopy.sip[field];
    }
    const hasRefs = (input: unknown): boolean => {
      const sip = (input as { sip?: Record<string, unknown> } | undefined)?.sip;
      return isSipStoreRef(sip?.['user']) || isSipStoreRef(sip?.['password']);
    };
    const channelInput = hasRefs(authored)
      ? await resolveSipSecretInputs(hostConfig, authored, 'channels.sip') : authored;
    const legacyInput = hasRefs(legacyCopy)
      ? await resolveSipSecretInputs(hostConfig, legacyCopy, 'plugins.entries.sip.config') : legacyCopy;
    const config = resolveSipConfig({ ...hostConfig, channels: {
      ...hostConfig?.channels, sip: channelInput,
    } } as typeof api.config, legacyInput);
    if (!config.enabled) { await waitUntilAbort(ctx.abortSignal); return; }
    if (config.transport !== 'embedded') throw new Error('SIP SDK channel requires embedded transport: bridge has no verified SIP hangup control');
    let handle: SipPluginHandle | undefined;
    let stopping = false;
    const admission = new SipAdmission(config);
    const hangup = (session: CallSession, reason: string): void => {
      if (handle) handle.hangup(session, reason);
      else session.end(reason);
    };
    const report = (connected: boolean): void => {
      ctx.setStatus?.({
        ...(ctx.getStatus?.() ?? {}), accountId: ctx.accountId, connected,
        lastTransportActivityAt: Date.now(),
      });
    };
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      handle = await start(config, {
        admitCall: (session, custom) => {
          if (stopping) { hangup(session, 'sip-stopping'); return false; }
          if (admission.admit(session, custom)) { report(true); return true; }
          hangup(session, config.voice.enabled ? 'sip-rejected' : 'sip-voice-disabled');
          return false;
        },
        onUtterance: (text, signal, session) => {
          const caller = admission.caller(session);
          if (!caller) throw new Error('SIP call not admitted');
          report(true);
          return dispatchSipTurn(api, config, caller, text, signal);
        },
        onSessionEnd: (session) => {
          admission.end(session);
        },
        onLog: (message, fields) => api.logger.info(fields ? `${message} ${JSON.stringify(fields)}` : message),
      });
      report(true);
      heartbeat = setInterval(() => report(true), HEARTBEAT_MS);
      heartbeat.unref?.();
      await waitUntilAbort(ctx.abortSignal);
    } finally {
      stopping = true;
      if (heartbeat) clearInterval(heartbeat);
      const current = handle; handle = undefined;
      await current?.stop();
      report(false);
    }
  };
  activeRun = run;
  return run;
}

const plugin = createChatChannelPlugin({
  base: {
    id: 'sip',
    meta: {
      id: 'sip', label: 'SIP Telephony', selectionLabel: 'SIP Telephony',
      docsPath: 'https://github.com/kpma1985/oc-plugin-sip/blob/main/README.md', blurb: 'Inbound voice over own SIP trunk.'
    },
    setupContract: sipSetupContract,
    setupWizard: sipSetupWizard,
    capabilities: { chatTypes: ['direct'] },
    gateway: {
      startAccount: (ctx: SipRunContext) => {
        if (!activeRun) return Promise.reject(new Error('SIP runtime not registered'));
        return activeRun(ctx);
      },
    },
    configSchema: buildJsonChannelConfigSchema(manifest.channelConfigs.sip.schema, {
      uiHints: manifest.channelConfigs.sip.uiHints,
      runtime: {
        safeParse: value => {
          const result = authoredSipConfigSchema.safeParse(value);
          // Defaults belong after the legacy overlay, not in persisted channel input.
          return result.success ? { success: true, data: value } : {
            success: false,
            issues: result.error.issues.map(issue => ({
              path: issue.path.map(part => typeof part === 'number' ? part : String(part)),
              message: issue.message, code: issue.code,
            })),
          };
        },
      },
    }),
    config: {
      listAccountIds: () => ['default'], resolveAccount: cfg => ({
        accountId: 'default',
        ...resolveSipConfig({ ...cfg, channels: {
          ...cfg.channels, sip: sipConfigForValidation(cfg.channels?.['sip']),
        } } as typeof cfg, sipConfigForValidation(cfg.plugins?.entries?.['sip']?.config))
      }), isEnabled: account => account.enabled
    },
    agentPrompt: { messageToolHints: () => ['SIP voice: reply in one or two short sentences, no Markdown; spell out numbers.'] },
  }
});
const entry: OpenClawPluginDefinition = defineChannelPluginEntry({
  id: 'sip', name: 'SIP Telephony',
  description: 'Independent inbound SIP voice channel', plugin, registerFull: registerSipRuntime
});
export default entry;
