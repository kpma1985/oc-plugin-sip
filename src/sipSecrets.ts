import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { resolveConfiguredSecretInputString } from 'openclaw/plugin-sdk/secret-input-runtime';

export function isSipStoreRef(value: unknown): value is { source: 'store'; provider: string; id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return Object.keys(ref).length === 3 && ref['source'] === 'store' && ref['provider'] === 'default' &&
    typeof ref['id'] === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(ref['id']);
}

export function sipConfigForValidation(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = structuredClone(value) as Record<string, unknown>;
  const sip = copy['sip'];
  if (sip && typeof sip === 'object' && !Array.isArray(sip)) {
    const trunk = sip as Record<string, unknown>;
    for (const field of ['user', 'password']) {
      if (isSipStoreRef(trunk[field])) trunk[field] = 'secret-reference-pending';
    }
  }
  return copy;
}

export async function resolveSipSecretInputs(config: OpenClawConfig, input: unknown,
  root: string, resolve = resolveConfiguredSecretInputString): Promise<unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const copy = structuredClone(input) as Record<string, unknown>;
  const sip = copy['sip'];
  if (!sip || typeof sip !== 'object' || Array.isArray(sip)) return copy;
  const trunk = sip as Record<string, unknown>;
  for (const field of ['user', 'password']) {
    if (!isSipStoreRef(trunk[field])) continue;
    const result = await resolve({ config, env: process.env, value: trunk[field], path: `${root}.sip.${field}` });
    if (!result.value) throw new Error(`SIP ${field} secret unavailable`);
    trunk[field] = result.value;
  }
  return copy;
}
