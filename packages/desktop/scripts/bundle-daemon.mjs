/**
 * Bundles @mainframe/core into a single CJS file for packaging.
 * Native modules (better-sqlite3) are kept external and copied separately via extraResources.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreEntry = join(__dirname, '../../../packages/core/dist/index.js');
const outfile = join(__dirname, '../resources/daemon.cjs');

await build({
  entryPoints: [coreEntry],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Keep native modules external — they're copied via extraResources
  external: ['better-sqlite3', '*.node'],
  outfile,
  logLevel: 'info',
  // import.meta.url is guarded with ?? fallback in manager.ts; suppress the cosmetic warning
  logOverride: { 'empty-import-meta': 'silent' },
});

console.log('Daemon bundled →', outfile);
