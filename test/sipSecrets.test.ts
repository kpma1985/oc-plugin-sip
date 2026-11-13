import { expect, it, vi } from 'vitest';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { isSipStoreRef, resolveSipSecretInputs, sipConfigForValidation } from '../src/sipSecrets.js';

const ref = { source: 'store', provider: 'default', id: 'SIP_ACCOUNT01_PASSWORD' };

it('validates Store refs without mutating authored configuration', () => {
  const authored = { sip: { password: ref, user: '${OPENCLAW_SIP_USER}', domain: 'example.org' } };
  expect(isSipStoreRef(ref)).toBe(true);
  expect(isSipStoreRef({ ...ref, extra: true })).toBe(false);
  expect(isSipStoreRef({ ...ref, id: '../secret' })).toBe(false);
  expect(sipConfigForValidation(authored)).toEqual({ sip: {
    password: 'secret-reference-pending', user: '${OPENCLAW_SIP_USER}', domain: 'example.org',
  } });
  expect(authored.sip.password).toBe(ref);
});

it('resolves SIP credentials server-side and fails closed without values', async () => {
  const authored = { sip: { password: ref, user: 'existing', domain: 'example.org' } };
  const resolve = vi.fn(async () => ({ value: 'test-only-password' }));
  const config = {} as OpenClawConfig;
  expect(await resolveSipSecretInputs(config, authored, 'channels.sip', resolve)).toEqual({
    sip: { password: 'test-only-password', user: 'existing', domain: 'example.org' },
  });
  expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ value: ref, path: 'channels.sip.sip.password' }));
  expect(authored.sip.password).toBe(ref);
  await expect(resolveSipSecretInputs(config, authored, 'channels.sip', async () => ({})))
    .rejects.toThrow('SIP password secret unavailable');
});
