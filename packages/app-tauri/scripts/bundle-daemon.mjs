/**
 * Bundle the Node daemon for the Tauri sidecar.
 *
 * Tauri ships no Node runtime, so the daemon must travel as: a single-file
 * `daemon.cjs` (esbuild) PLUS a `node_modules/` of its external/native packages
 * laid out as a SIBLING of `daemon.cjs`. Node resolves `require('better-sqlite3')`
 * relative to the requiring file's directory, so this sibling layout needs no
 * NODE_PATH/cwd wiring — the Rust resolver just points the sidecar node at
 * `resources/daemon/daemon.cjs` (see src-tauri/src/sidecar.rs + lib.rs).
 *
 * Output (gitignored build artifacts):
 *   src-tauri/resources/daemon/daemon.cjs
 *   src-tauri/resources/daemon/node_modules/{better-sqlite3,node-pty,@vscode/ripgrep,
 *                                            typescript-language-server,pyright,...}
 *
 * Native modules (better-sqlite3, node-pty) are compiled against the Node ABI that
 * installed them. The sidecar is pinned to the same major (Node 24, .nvmrc), so on
 * the dev/CI host they already match — no rebuild step here. Each CI runner installs
 * for its own platform, so its node_modules carry the right per-platform .node files.
 *
 * macOS release builds additionally codesign every nested Mach-O binary (the
 * .node addons, the provisioned `node`, `rg`) — see scripts/lib/mach-o-sign.mjs
 * for why this has to happen here (inside `beforeBuildCommand`) rather than as
 * a separate post-build hook.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDaemonDeps } from '../../../scripts/collect-daemon-deps.mjs';
import { signMachOTree } from './lib/mach-o-sign.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appTauri = resolve(here, '..'); // packages/app-tauri
const repoRoot = resolve(appTauri, '../..'); // monorepo root
const coreEntry = join(repoRoot, 'packages/core/dist/index.js');
const coreVersion = JSON.parse(
  readFileSync(join(repoRoot, 'packages/core/package.json'), 'utf8'),
).version;
const daemonDir = join(appTauri, 'src-tauri/resources/daemon');
const binariesDir = join(appTauri, 'src-tauri/binaries'); // provisioned `node-<triple>` (provision-node.mjs)
const outfile = join(daemonDir, 'daemon.cjs');

// External = anything that must stay a runtime require() resolving from node_modules:
// native addons (can't be bundled) + the LSP servers + ripgrep (ship binaries/files).
const EXTERNAL = [
  'better-sqlite3',
  'node-pty',
  '@vscode/ripgrep',
  'typescript-language-server',
  'pyright',
  '*.node',
];

console.log('[bundle-daemon] 1/4 building @qlan-ro/mainframe-core …');
execFileSync('pnpm', ['--filter', '@qlan-ro/mainframe-core', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('[bundle-daemon] 2/4 esbuild → resources/daemon/daemon.cjs …');
mkdirSync(daemonDir, { recursive: true });
await build({
  entryPoints: [coreEntry],
  bundle: true,
  platform: 'node',
  target: 'node20', // syntax floor; the sidecar runtime is Node 24 (a superset)
  format: 'cjs',
  external: EXTERNAL,
  outfile,
  logLevel: 'info',
  // Inline the daemon's version — the tarball ships no package.json to read at runtime.
  define: { __DAEMON_VERSION__: JSON.stringify(coreVersion) },
  // import.meta.url is guarded with ?? in core; suppress the cosmetic warning.
  logOverride: { 'empty-import-meta': 'silent' },
});

console.log('[bundle-daemon] 3/4 collecting runtime deps → resources/daemon/node_modules …');
// Each EXTERNAL stays a runtime require(), so it must exist in a node_modules
// SIBLING of daemon.cjs. The shared collector seeds from the externals and walks
// each package.json's (optional) dependencies, deref-copying the real
// (pnpm-symlinked) package dirs into one flat tree — the transitive deps of the
// LSP servers come along. Same logic backs the standalone tarball (build-standalone.sh).
const copied = collectDaemonDeps({
  requireBasePkgJson: join(repoRoot, 'packages/core/package.json'),
  externals: EXTERNAL,
  destNodeModules: join(daemonDir, 'node_modules'),
  onWarn: (m) => console.warn(`[bundle-daemon]   ${m}`),
});

console.log(`[bundle-daemon] done → ${daemonDir} (${copied.length} runtime packages)`);

console.log('[bundle-daemon] 4/4 codesigning nested Mach-O binaries (macOS release only) …');
// Covers the daemon's own native addons (better-sqlite3, fsevents, node-pty,
// @vscode/ripgrep's `rg`) AND the provisioned sidecar `node` binary — both are
// already on disk by the time this step runs (provision:node → bundle:daemon,
// see package.json "bundle" script and tauri.conf.json beforeBuildCommand).
signMachOTree([daemonDir, binariesDir], { label: 'daemon sidecar (daemon/ + binaries/)' });
