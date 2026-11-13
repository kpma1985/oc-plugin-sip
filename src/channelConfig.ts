import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { parseSipConfig, type SipPluginConfig } from './config.js';

const sections = ['sip', 'media', 'audio', 'inbound', 'stt', 'tts', 'voice'] as const;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Overlay explicit channel leaves before defaults; keep legacy secrets/settings intact. */
export function resolveSipConfig(cfg: OpenClawConfig | undefined, legacy: unknown =
  cfg?.plugins?.entries?.['sip']?.config): SipPluginConfig {
  const channel: unknown = cfg?.channels?.['sip'];
  if (channel === undefined) return parseSipConfig(legacy);
  if (!isObject(channel)) throw new Error('invalid sip plugin config: channels.sip must be an object');
  if (legacy != null && !isObject(legacy)) return parseSipConfig(legacy);
  const base = legacy ?? {};
  const merged: Record<string, unknown> = { ...base, ...channel };
  // OpenClaw owns this shared channel field; it is not SIP runtime config.
  delete merged['heartbeatVisibility'];
  const mergePresets = (left: unknown, right: unknown): unknown => {
    if (!isObject(left) || !isObject(right)) return right;
    const result = { ...left, ...right };
    for (const key of Object.keys(right)) {
      if (isObject(left[key]) && isObject(right[key])) result[key] = mergePresets(left[key], right[key]);
    }
    return result;
  };
  for (const section of sections) {
    if (isObject(base[section]) && isObject(channel[section])) {
      merged[section] = mergePresets(base[section], channel[section]);
    }
  }
  if (channel['providerPresets'] !== undefined) {
    merged['providerPresets'] = mergePresets(base['providerPresets'], channel['providerPresets']);
  }
  return parseSipConfig(merged);
}
