/**
 * Bundles @mainframe/core into a single CJS file for packaging.
 * Native modules (better-sqlite3) are kept external and copied separately via extraResources.
 */
import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreEntry = join(__dirname, '../../../packages/core/dist/index.js');
const coreVersion = JSON.parse(
  readFileSync(join(__dirname, '../../../packages/core/package.json'), 'utf8'),
).version;
const outfile = process.argv[2] ?? join(__dirname, '../resources/daemon.cjs');

await build({
  entryPoints: [coreEntry],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Keep native modules and bundled LSP servers external — copied via extraResources
  external: ['better-sqlite3', '*.node', 'typescript-language-server', 'pyright', '@vscode/ripgrep'],
  outfile,
  logLevel: 'info',
  // Inline the daemon's version — the standalone tarball ships no package.json at runtime.
  define: { __DAEMON_VERSION__: JSON.stringify(coreVersion) },
  // import.meta.url is guarded with ?? fallback in manager.ts; suppress the cosmetic warning
  logOverride: { 'empty-import-meta': 'silent' },
});

console.log('Daemon bundled →', outfile);
