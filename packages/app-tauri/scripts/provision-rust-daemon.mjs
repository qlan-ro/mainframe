/**
 * Provision the Rust `mainframe-daemon` binary for Tauri's `externalBin`
 * ("binaries/mainframe-daemon").
 *
 * Tauri expects a per-target-triple file at
 * `src-tauri/binaries/mainframe-daemon-<triple>` (e.g.
 * `mainframe-daemon-aarch64-apple-darwin`). At `tauri build` it copies the
 * matching-triple binary next to the app executable; the Rust shell's
 * `sidecar::find_bundled_rust_daemon` finds it there and runs it when the
 * `MAINFRAME_DAEMON_IMPL=rust` canary is set.
 *
 * Modes:
 *   (default)          `cargo build --release -p mainframe-daemon` in
 *                      packages/core-rs for the HOST triple, then copy.
 *   --target=<triple>  cross-build with `cargo build --target <triple>` and read
 *                      from `target/<triple>/release/` (CI matrix / cross-target).
 *   --no-build         skip the cargo build; copy an already-built binary
 *                      (fast local re-provision, or a CI step that built earlier).
 *
 * The Tauri target triple is identical to the Rust target triple, so no mapping
 * is needed (unlike provision-node.mjs which maps node's platform/arch).
 *
 * Real binaries are gitignored; only this script + the .gitignore/README are
 * committed. `cargo check` does not need this file; `cargo tauri build` does.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appTauri = resolve(here, '..'); // packages/app-tauri
const repoRoot = resolve(appTauri, '../..'); // monorepo root
const coreRs = join(repoRoot, 'packages/core-rs');
const binariesDir = join(appTauri, 'src-tauri/binaries');

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const argOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

/** The exact host target triple, e.g. `aarch64-apple-darwin`. */
function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.startsWith('host:'));
  if (!line) throw new Error('could not read host triple from `rustc -vV`');
  return line.slice('host:'.length).trim();
}

const target = argOf('target'); // rust triple, or undefined for host
const triple = target ?? hostTriple();
const isWindows = triple.includes('windows');
const exe = isWindows ? '.exe' : '';

if (!noBuild) {
  console.log(`[provision-rust-daemon] cargo build --release (${triple}) …`);
  const buildArgs = ['build', '--release', '-p', 'mainframe-daemon'];
  if (target) buildArgs.push('--target', target);
  execFileSync('cargo', buildArgs, { cwd: coreRs, stdio: 'inherit' });
}

// `cargo build --target <t>` nests output under target/<t>/release; a host build
// (no --target) writes to target/release directly.
const releaseDir = target
  ? join(coreRs, 'target', target, 'release')
  : join(coreRs, 'target', 'release');
const src = join(releaseDir, `mainframe-daemon${exe}`);
const dest = join(binariesDir, `mainframe-daemon-${triple}${exe}`);

mkdirSync(binariesDir, { recursive: true });
copyFileSync(src, dest);
if (!isWindows) chmodSync(dest, 0o755);
console.log(`[provision-rust-daemon] ${src} → ${dest}`);
