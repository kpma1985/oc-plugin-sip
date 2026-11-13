import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/plugin.ts'],
  outfile: 'dist/plugin.js',
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  charset: 'utf8',
  legalComments: 'eof',
  sourcemap: 'linked',
  sourcesContent: true,
  logLevel: 'info',
});

await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/ui/controlUi.js'],
  outfile: 'dist/control-ui/controlUi.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  sourcemap: 'linked',
  sourcesContent: true,
  logLevel: 'info',
});
await mkdir(fileURLToPath(new URL('../dist/control-ui/', import.meta.url)), { recursive: true });
await copyFile(fileURLToPath(new URL('../src/ui/controlUi.css', import.meta.url)),
  fileURLToPath(new URL('../dist/control-ui/controlUi.css', import.meta.url)));
