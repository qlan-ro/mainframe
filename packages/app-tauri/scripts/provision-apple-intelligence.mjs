/**
 * Provision the `mainframe-intelligence` helper for Tauri's `externalBin`
 * ("binaries/mainframe-intelligence").
 *
 * The helper wraps Apple's FoundationModels framework, which needs the macOS 26
 * SDK to COMPILE and Apple Intelligence enabled to RUN. Neither is available
 * everywhere the app is built, and `externalBin` entries are mandatory — a
 * missing file fails `tauri build` outright.
 *
 * So this script always produces the file, and only sometimes produces a real
 * binary: where Swift can't build it, it writes the same zero-byte placeholder
 * the daemon scaffold uses. `sidecar::find_bundled_local_intelligence` rejects
 * anything under 1 KB, so a placeholder means the daemon simply keeps titling
 * chats through the CLI adapters — the identical outcome to a Mac that has
 * Apple Intelligence switched off.
 *
 * Modes:
 *   (default)          `swift build -c release`, then copy.
 *   --target=<triple>  name the output for a cross-target build (the Swift build
 *                      itself is still host-native; a non-host triple always
 *                      writes a placeholder).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appTauri = resolve(here, '..'); // packages/app-tauri
const repoRoot = resolve(appTauri, '../..'); // monorepo root
const swiftPackage = join(repoRoot, 'packages/apple-intelligence');
const binariesDir = join(appTauri, 'src-tauri/binaries');

const args = process.argv.slice(2);
const argOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

/** The exact host target triple, e.g. `aarch64-apple-darwin`. */
function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.startsWith('host:'));
  if (!line) throw new Error('could not read host triple from `rustc -vV`');
  return line.slice('host:'.length).trim();
}

/**
 * Why this machine can't build the helper, or null if it can.
 *
 * The SDK check is a version comparison rather than a `try { build }` because a
 * pre-26 SDK fails with a bare "no such module 'FoundationModels'", which reads
 * like a broken checkout rather than an expected capability gap.
 */
function blocker(triple) {
  if (process.platform !== 'darwin') return `host platform is ${process.platform}, not macOS`;
  if (triple !== hostTriple()) return `cross-building for ${triple} from ${hostTriple()}`;
  if (!triple.includes('apple-darwin')) return `target ${triple} is not macOS`;
  try {
    const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], {
      encoding: 'utf8',
    }).trim();
    if (Number.parseInt(sdk, 10) < 26) {
      return `macOS SDK ${sdk} predates the 26.0 that FoundationModels needs`;
    }
  } catch {
    return 'no usable Xcode command line tools (`xcrun` failed)';
  }
  return null;
}

const triple = argOf('target') ?? hostTriple();
// Tauri looks for `<stem>-<triple>.exe` on Windows, so the placeholder written
// for a Windows target has to carry the suffix or the build script still fails.
const dest = join(
  binariesDir,
  `mainframe-intelligence-${triple}${triple.includes('windows') ? '.exe' : ''}`,
);
mkdirSync(binariesDir, { recursive: true });

const reason = blocker(triple);
if (reason) {
  writeFileSync(dest, '');
  console.log(
    `[provision-apple-intelligence] placeholder → ${dest}\n` +
      `[provision-apple-intelligence] on-device titles disabled in this build: ${reason}`,
  );
  process.exit(0);
}

console.log(`[provision-apple-intelligence] swift build -c release (${triple}) …`);
execFileSync('swift', ['build', '-c', 'release'], { cwd: swiftPackage, stdio: 'inherit' });
const src = join(swiftPackage, '.build/release/mainframe-intelligence');
copyFileSync(src, dest);
chmodSync(dest, 0o755);
console.log(`[provision-apple-intelligence] ${src} → ${dest}`);
