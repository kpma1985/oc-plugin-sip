import { it, expect, vi } from 'vitest';
import entry from '../src/plugin.js';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import packageMetadata from '../package.json' with { type: 'json' };

it('ships a prepacked JavaScript entry without consumer plugin build hooks', () => {
  expect(packageMetadata.main).toBe('./dist/plugin.js');
  expect(packageMetadata.openclaw.extensions).toEqual(['./dist/plugin.js']);
  expect(packageMetadata.files).toContain('dist/plugin.js');
  expect(packageMetadata.files).toContain('openclaw.plugin.json');
  expect(packageMetadata.scripts.build).toBe('node scripts/build.mjs');
  expect(packageMetadata.scripts.prepack).toBe('npm run build');
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    expect(packageMetadata.scripts).not.toHaveProperty(hook);
  }
});

it('real OpenClaw 2026.9.9 SDK entry registers synchronously', () => {
  const api = {
    registrationMode: 'full', config: {}, pluginConfig: { enabled: false }, runtime: {},
    registerChannel: vi.fn(), registerService: vi.fn(), registerGatewayMethod: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as OpenClawPluginApi;
  expect(entry.register?.(api)).toBeUndefined();
  expect(api.registerChannel).toHaveBeenCalledOnce();
  expect(api.registerService).not.toHaveBeenCalled();
  expect(api.registerGatewayMethod).toHaveBeenCalledWith('sip.deepgram.models', expect.any(Function), { scope: 'operator.read' });
});
