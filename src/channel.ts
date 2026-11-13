import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { SipPluginConfig } from './config.js';
import type { CallSession } from './media/callSession.js';
import { MAX_VOICE_REPLY_CHARS } from './voice/textLimits.js';

export function callerE164(session: CallSession, custom: Record<string, string>,
  numbering?: Pick<SipPluginConfig['inbound'], 'callerCountryCode' | 'callerNationalPrefix'>): string | undefined {
  const value = session.from ?? custom['from'] ?? custom['From'] ?? custom['caller'];
  if (!value) return undefined;
  const uri = value.trim();
  const national = /^(?:sip:|tel:)?(\d{3,15})(?:@[^\s;>]+)?(?:;[^\s>]*)?$/.exec(uri)?.[1];
  const prefix = numbering?.callerNationalPrefix ?? '0';
  const normalized = numbering?.callerCountryCode && national?.startsWith(prefix) &&
    /^[1-9]\d+$/.test(national.slice(prefix.length))
    ? `+${numbering.callerCountryCode}${national.slice(prefix.length)}` : uri;
  const match = /^(?:sip:|tel:)?(\+[1-9]\d{1,14})(?:@[^\s;>]+)?(?:;[^\s>]*)?$/.exec(normalized);
  return match?.[1];
}

/** Only admitted calls occupy slots; reserve synchronously before any async work. */
export class SipAdmission {
  private accepted = new Map<string, string>();
  constructor(private config: SipPluginConfig) { }
  admit(session: CallSession, custom: Record<string, string>): boolean {
    if (this.accepted.has(session.streamSid)) return true;
    const caller = callerE164(session, custom, this.config.inbound);
    if (!caller || !this.config.voice.enabled ||
      (this.config.inbound.policy === 'allowlist' && !this.config.inbound.allowFrom.includes(caller)) ||
      this.accepted.size >= this.config.inbound.maxConcurrent) return false;
    this.accepted.set(session.streamSid, caller); return true;
  }
  caller(session: CallSession): string | undefined { return this.accepted.get(session.streamSid); }
  end(streamSid: string): void { this.accepted.delete(streamSid); }
}

/** Host dispatch retains agent model/tools policy. No direct LLM or tool execution. */
export async function dispatchSipTurn(api: Pick<OpenClawPluginApi, 'runtime' | 'config'>,
  config: SipPluginConfig, caller: string, text: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return '';
  const channel = api.runtime.channel;
  const route = channel.routing.resolveAgentRoute({
    cfg: api.config, channel: 'sip',
    accountId: 'default', defaultAgentId: config.inbound.agentId,
    peer: { kind: 'direct', id: caller }, dmScope: 'per-channel-peer'
  });
  const answers: string[] = [];
  await channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    cfg: api.config,
    ctx: channel.reply.finalizeInboundContext({
      Body: text, RawBody: text, BodyForAgent: text,
      From: caller, To: 'sip:default', SenderId: caller, SessionKey: route.sessionKey,
      AccountId: 'default', ChatType: 'direct', Provider: 'sip', Surface: 'sip',
      OriginatingChannel: 'sip', OriginatingTo: caller, CommandAuthorized: false,
      // Phone identity is caller-supplied, never an operator/owner credential.
      BodyForCommands: '',
    }),
    // Empty allow set (default) disables tools on caller-ID-only phone ingress; opt in per tool name.
    toolsAllow: config.inbound.toolsAllow,
    dispatcherOptions: {
      deliver: async (payload) => {
        if (signal.aborted) return;
        if (payload.text) answers.push(payload.text);
        if (answers.join(' ').length > MAX_VOICE_REPLY_CHARS) throw new Error('SIP reply limit');
      }
    },
    replyOptions: { abortSignal: signal, disableTools: config.inbound.toolsAllow.length === 0 },
  });
  return signal.aborted ? '' : answers.join(' ');
}
