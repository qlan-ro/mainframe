#!/usr/bin/env node
/**
 * Manual entry point for the daemon sidecar's macOS codesign pass.
 *
 * `bundle-daemon.mjs` calls `signMachOTree` automatically as its last step;
 * this script exists so the discovery + signing logic can be exercised
 * directly, without re-running the full bundle:
 *
 *   node scripts/codesign-daemon.mjs --dry-run   # list what would be signed
 *   node scripts/codesign-daemon.mjs             # sign for real (darwin +
 *                                                 # APPLE_SIGNING_IDENTITY only)
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMachOFiles, signMachOTree } from './lib/mach-o-sign.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appTauri = resolve(here, '..');
const daemonDir = join(appTauri, 'src-tauri/resources/daemon');
const binariesDir = join(appTauri, 'src-tauri/binaries');

if (process.argv.includes('--dry-run')) {
  // Bypasses the darwin+identity gate on purpose: this is for sanity-checking
  // discovery (CI debugging, local runs without an imported signing cert).
  for (const root of [daemonDir, binariesDir]) {
    const files = findMachOFiles(root);
    console.log(`[codesign:dry-run] ${root} → ${files.length} Mach-O binaries`);
    for (const file of files) console.log(`  ${file}`);
  }
} else {
  signMachOTree([daemonDir, binariesDir], { label: 'daemon sidecar (daemon/ + binaries/)' });
}
