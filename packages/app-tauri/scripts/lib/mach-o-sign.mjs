/**
 * macOS code-signing for the bundled daemon's native Mach-O binaries.
 *
 * Tauri signs the outer `.app` and its own main binaries, but never touches
 * files nested inside `Contents/Resources/daemon/**` (the sidecar's
 * `node_modules`) or the provisioned `binaries/node-<triple>` — Apple's
 * notary service rejects the whole bundle if ANY nested Mach-O lacks a
 * Developer-ID signature with a secure timestamp (the exact failure a
 * `v2.0.0-nightly` release hit on better-sqlite3.node + fsevents.node).
 *
 * This module finds every Mach-O binary under a root by MAGIC BYTES, not
 * just the `.node` extension, because the provisioned `node` executable and
 * `@vscode/ripgrep`'s `rg` ship with no extension and must be signed too.
 *
 * Gating: only signs when `process.platform === 'darwin'` AND
 * `APPLE_SIGNING_IDENTITY` is set, so local/dev bundles (no cert imported)
 * build cleanly without it — signing is opt-in via the release environment.
 *
 * Fallback note: this assumes tauri's outer `.app` signing pass preserves
 * (or re-signs, same identity, in place) these nested signatures rather than
 * stripping them — true for modern tauri/codesign, which re-signs matching-
 * identity nested code rather than replacing it. If a future nightly shows
 * tauri stripping nested signatures, move this pass to a post-`tauri build`,
 * pre-notarize step instead of running it inside `beforeBuildCommand`.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Mach-O magic numbers, read as the first 4 on-disk bytes interpreted
// big-endian. Covers 32/64-bit, both byte orders, and fat/universal binaries
// (Apple Silicon tooling emits single-arch binaries wrapped in a fat header).
const MACHO_MAGICS = new Set([
  0xfeedface, // MH_MAGIC (32-bit)
  0xcefaedfe, // MH_CIGAM (32-bit, byte-swapped)
  0xfeedfacf, // MH_MAGIC_64
  0xcffaedfe, // MH_CIGAM_64
  0xcafebabe, // FAT_MAGIC (universal binary)
  0xbebafeca, // FAT_CIGAM (universal binary, byte-swapped)
]);

function readMagic(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    const bytesRead = readSync(fd, buf, 0, 4, 0);
    return bytesRead < 4 ? null : buf.readUInt32BE(0);
  } finally {
    closeSync(fd);
  }
}

/** True if `filePath` is a Mach-O binary, detected by magic bytes (not extension/mode). */
function isMachO(filePath) {
  try {
    const magic = readMagic(filePath);
    return magic !== null && MACHO_MAGICS.has(magic);
  } catch {
    return false; // unreadable/zero-length files are never Mach-O
  }
}

/** Recursively collect every Mach-O file under `root` (a file or a directory). */
export function findMachOFiles(root) {
  if (!existsSync(root)) return [];
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) return []; // bundle-daemon's copy already dereferences symlinks
  if (stat.isFile()) return isMachO(root) ? [root] : [];
  if (!stat.isDirectory()) return [];

  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...findMachOFiles(full));
    else if (entry.isFile() && isMachO(full)) found.push(full);
  }
  return found;
}

/** codesign a single file. Throws (failing the build) on any non-zero exit. */
function codesignFile(filePath, identity) {
  execFileSync(
    'codesign',
    ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, filePath],
    { stdio: 'inherit' },
  );
}

/**
 * Find + codesign every Mach-O file under `roots` (each a file or a
 * directory), gated to macOS with a signing identity configured. No-ops
 * (logging why) on dev machines and non-macOS CI so local/PR builds are
 * unaffected — only release builds with `APPLE_SIGNING_IDENTITY` set sign.
 *
 * Throws on the first failed `codesign` call: a silent skip here means
 * notarization rejects the bundle again, so this must fail the build loudly.
 */
export function signMachOTree(roots, { label = 'binaries' } = {}) {
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  const rootList = Array.isArray(roots) ? roots : [roots];

  if (process.platform !== 'darwin' || !identity) {
    console.log(
      `[codesign] skip ${label}: requires darwin + APPLE_SIGNING_IDENTITY ` +
        `(platform=${process.platform}, identity=${identity ? 'set' : 'unset'})`,
    );
    return;
  }

  const files = rootList.flatMap((root) => findMachOFiles(root));
  // Sign deepest paths first (inner-to-outer): harmless for today's flat
  // .node/binaries, and correct if a future nested bundle structure appears.
  files.sort((a, b) => b.split('/').length - a.split('/').length);

  if (files.length === 0) {
    console.log(`[codesign] ${label}: no Mach-O binaries found under ${rootList.join(', ')}`);
    return;
  }

  console.log(`[codesign] ${label}: signing ${files.length} Mach-O binaries with "${identity}"`);
  for (const file of files) {
    console.log(`[codesign]   ${file}`);
    codesignFile(file, identity);
  }
  console.log(`[codesign] ${label}: done (${files.length} signed)`);
}
