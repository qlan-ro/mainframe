/**
 * Provision the Node sidecar binary for Tauri's `externalBin` ("binaries/node").
 *
 * Tauri expects a per-target-triple file at `src-tauri/binaries/node-<triple>`
 * (e.g. node-aarch64-apple-darwin). At `tauri build` it copies the matching-triple
 * binary next to the app executable; the Rust resolver (find_node) then prefers it.
 *
 * Modes:
 *   (default, local)  copy THIS machine's `node` for its own triple — instant, and
 *                     it matches the ABI of the native modules pnpm just installed.
 *                     The running node MUST be the pinned major (Node 24, .nvmrc).
 *   --fetch [--triple=<t>] [--version=<vX.Y.Z>]
 *                     download the official binary from nodejs.org for a triple
 *                     (CI / cross-target). Defaults to the current triple + the
 *                     pinned major's latest is the caller's responsibility (pass
 *                     --version explicitly in CI).
 *
 * Real binaries are gitignored; only this script + the .gitignore are committed.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appTauri = resolve(here, '..');
const binariesDir = join(appTauri, 'src-tauri/binaries');
const PINNED_MAJOR = readFileSync(resolve(appTauri, '../../.nvmrc'), 'utf8').trim();

const args = process.argv.slice(2);
const fetchMode = args.includes('--fetch');
const argOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

/** node's process arch/platform → Tauri (Rust) target-triple fragment. */
function tripleFor(platform = process.platform, arch = process.arch) {
  const cpu = { arm64: 'aarch64', x64: 'x86_64' }[arch];
  if (!cpu) throw new Error(`unsupported arch: ${arch}`);
  const os = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-gnu',
    win32: 'pc-windows-msvc',
  }[platform];
  if (!os) throw new Error(`unsupported platform: ${platform}`);
  return `${cpu}-${os}`;
}

const triple = argOf('triple') ?? tripleFor();
const isWindows = triple.includes('windows');
const dest = join(binariesDir, `node-${triple}${isWindows ? '.exe' : ''}`);
mkdirSync(binariesDir, { recursive: true });

if (!fetchMode) {
  // Local copy of the running node — must match the pinned major so its ABI lines
  // up with the native modules bundled by bundle-daemon.mjs.
  const running = process.versions.node; // e.g. "24.13.1"
  if (running.split('.')[0] !== PINNED_MAJOR) {
    throw new Error(
      `running node v${running} != pinned major v${PINNED_MAJOR} (.nvmrc). ` +
        `Switch with \`nvm use ${PINNED_MAJOR}\` or run with --fetch --version=v${PINNED_MAJOR}.x.y`,
    );
  }
  copyFileSync(process.execPath, dest);
  chmodSync(dest, 0o755);
  console.log(`[provision-node] copied local node v${running} → ${dest}`);
} else {
  // CI / cross-target: download the official tarball and extract just `node`.
  const version = argOf('version');
  if (!version) throw new Error('--fetch requires --version=vX.Y.Z (pin it in CI)');
  const nodePlatform = triple.includes('apple') ? 'darwin' : triple.includes('linux') ? 'linux' : 'win';
  const nodeArch = triple.startsWith('aarch64') ? 'arm64' : 'x64';
  const work = join(tmpdir(), `node-dl-${triple}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  if (nodePlatform === 'win') {
    const url = `https://nodejs.org/dist/${version}/node-${version}-win-${nodeArch}.zip`;
    console.log(`[provision-node] fetching ${url}`);
    execFileSync('curl', ['-fsSL', '-o', join(work, 'n.zip'), url], { stdio: 'inherit' });
    execFileSync('unzip', ['-q', join(work, 'n.zip'), '-d', work], { stdio: 'inherit' });
    renameSync(join(work, `node-${version}-win-${nodeArch}`, 'node.exe'), dest);
  } else {
    const url = `https://nodejs.org/dist/${version}/node-${version}-${nodePlatform}-${nodeArch}.tar.gz`;
    console.log(`[provision-node] fetching ${url}`);
    execFileSync('curl', ['-fsSL', '-o', join(work, 'n.tar.gz'), url], { stdio: 'inherit' });
    execFileSync('tar', ['xzf', join(work, 'n.tar.gz'), '-C', work], { stdio: 'inherit' });
    copyFileSync(join(work, `node-${version}-${nodePlatform}-${nodeArch}`, 'bin', 'node'), dest);
    chmodSync(dest, 0o755);
  }
  rmSync(work, { recursive: true, force: true });
  console.log(`[provision-node] fetched ${version} (${triple}) → ${dest}`);
}
