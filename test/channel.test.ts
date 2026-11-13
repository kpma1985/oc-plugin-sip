import { describe, it, expect, vi } from 'vitest';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { CallSession } from '../src/media/callSession.js';
import { parseSipConfig } from '../src/config.js';
import { SipAdmission, callerE164, dispatchSipTurn } from '../src/channel.js';
const session = (id: string, from?: string) => new CallSession({ streamSid: id, from, onSend: () => { } });
const config = parseSipConfig({ voice: { enabled: true }, inbound: { maxConcurrent: 1, allowFrom: ['+4912345'] } });

describe('SIP admission', () => {
  it('normalizes national sipgate caller IDs while retaining allowlist checks', () => {
    const numbering = { callerCountryCode: '49', callerNationalPrefix: '0' };
    const policy = new SipAdmission(parseSipConfig({ voice: { enabled: true }, inbound: { allowFrom: ['+4912345'], ...numbering } }));
    expect(callerE164(session('national', 'sip:012345@sipconnect.sipgate.de'), {}, numbering)).toBe('+4912345');
    const allowed = session('allowed', 'sip:012345@sipconnect.sipgate.de');
    expect(policy.admit(allowed, {})).toBe(true);
    policy.end(allowed);
    expect(policy.admit(session('unknown', 'sip:012346@sipconnect.sipgate.de'), {})).toBe(false);
    expect(callerE164(session('foreign', 'sip:012345@example.org'), {})).toBeUndefined();
    expect(callerE164(session('anonymous', 'sip:anonymous@sipconnect.sipgate.de'), {})).toBeUndefined();
  });
  it('fails closed missing/invalid caller and unknown allowlist entry', () => {
    const policy = new SipAdmission(config);
    expect(policy.admit(session('a'), {})).toBe(false);
    expect(policy.admit(session('b', 'anonymous'), {})).toBe(false);
    expect(policy.admit(session('c', '+4912346'), {})).toBe(false);
    expect(policy.admit(session('d', '+4912345'), {})).toBe(true);
  });
  it('counts accepted calls only, excludes current, releases slot', () => {
    const policy = new SipAdmission(config), a = session('a', '+4912345');
    expect(policy.admit(a, {})).toBe(true); expect(policy.admit(a, {})).toBe(true);
    expect(policy.admit(session('b', '+4912345'), {})).toBe(false);
    policy.end(a); expect(policy.admit(session('c', '+4912345'), {})).toBe(true);
  });
  it('normalizes SIP E164 and rejects voice-disabled even open', () => {
    expect(callerE164(session('a', 'sip:+4912345@example.org'), {})).toBe('+4912345');
    expect(new SipAdmission(parseSipConfig({ inbound: { policy: 'open' } })).admit(session('a', '+4912345'), {})).toBe(false);
  });
});

it('dispatches legitimate runtime with caller route, no commands/tools, cancellation', async () => {
  const controller = new AbortController();
  const dispatch = vi.fn(async (params: any) => { await params.dispatcherOptions.deliver({ text: 'Antwort.' }); });
  const route = vi.fn((_input: unknown) => ({ sessionKey: 'agent:main:sip:direct:+4912345' }));
  const api = {
    config: {}, runtime: {
      channel: {
        routing: { resolveAgentRoute: route },
        reply: { finalizeInboundContext: (ctx: unknown) => ctx, dispatchReplyWithBufferedBlockDispatcher: dispatch }
      }
    }
  } as unknown as OpenClawPluginApi;
  expect(await dispatchSipTurn(api, config, '+4912345', 'Frage', controller.signal)).toBe('Antwort.');
  expect(route.mock.calls[0]?.[0]).toMatchObject({ peer: { kind: 'direct', id: '+4912345' }, dmScope: 'per-channel-peer' });
  expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ toolsAllow: [], ctx: { CommandAuthorized: false, BodyForCommands: '' }, replyOptions: { abortSignal: controller.signal } });
  controller.abort(); expect(await dispatchSipTurn(api, config, '+4912345', 'Frage', controller.signal)).toBe('');
  expect(dispatch).toHaveBeenCalledTimes(1);
});
