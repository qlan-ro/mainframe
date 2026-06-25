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
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appTauri = resolve(here, '..'); // packages/app-tauri
const repoRoot = resolve(appTauri, '../..'); // monorepo root
const coreEntry = join(repoRoot, 'packages/core/dist/index.js');
const daemonDir = join(appTauri, 'src-tauri/resources/daemon');
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

console.log('[bundle-daemon] 1/3 building @qlan-ro/mainframe-core …');
execFileSync('pnpm', ['--filter', '@qlan-ro/mainframe-core', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('[bundle-daemon] 2/3 esbuild → resources/daemon/daemon.cjs …');
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
  // import.meta.url is guarded with ?? in core; suppress the cosmetic warning.
  logOverride: { 'empty-import-meta': 'silent' },
});

console.log('[bundle-daemon] 3/3 collecting runtime deps → resources/daemon/node_modules …');
// Each EXTERNAL stays a runtime require(), so it must exist in a node_modules
// SIBLING of daemon.cjs. Seed from the externals and walk each package.json's
// (optional) dependencies, deref-copying the real (pnpm-symlinked) package dirs
// into one flat tree — the transitive deps of the LSP servers come along.
const coreRequire = createRequire(join(repoRoot, 'packages/core/package.json'));

/** Resolve a package's root dir (the dir holding its package.json). */
function pkgDirOf(name, requireFn) {
  try {
    return dirname(requireFn.resolve(`${name}/package.json`));
  } catch {
    // Package blocks the ./package.json subpath via exports — resolve an entry
    // and walk up to the package.json whose "name" matches.
    let dir = dirname(requireFn.resolve(name));
    for (;;) {
      const pj = join(dir, 'package.json');
      if (existsSync(pj)) {
        try {
          if (JSON.parse(readFileSync(pj, 'utf8')).name === name) return dir;
        } catch {
          /* keep walking */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`cannot locate package root for ${name}`);
      dir = parent;
    }
  }
}

/** Transitively gather a package + its (optional) deps into `found: name→dir`. */
function collect(name, requireFn, found) {
  if (found.has(name)) return;
  let dir;
  try {
    dir = pkgDirOf(name, requireFn);
  } catch {
    console.warn(`[bundle-daemon]   skip unresolved dep: ${name}`);
    return;
  }
  found.set(name, dir);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  const next = createRequire(join(dir, 'package.json'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
  for (const dep of Object.keys(deps)) collect(dep, next, found);
}

const found = new Map();
for (const name of EXTERNAL.filter((e) => e !== '*.node')) collect(name, coreRequire, found);

const destModules = join(daemonDir, 'node_modules');
rmSync(destModules, { recursive: true, force: true });
for (const [name, dir] of found) {
  const dest = join(destModules, name); // scoped names (@vscode/ripgrep) nest correctly
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(dir, dest, { recursive: true, dereference: true });
}

console.log(`[bundle-daemon] done → ${daemonDir} (${found.size} runtime packages)`);
