/**
 * pnpm strips the execute bit from node-pty's `spawn-helper` binary in prebuilds/.
 * Without +x, posix_spawnp fails at runtime. This script restores it after install.
 */
import { chmodSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

try {
  const ptyDir = dirname(require.resolve('node-pty/package.json'));
  const prebuildsDir = join(ptyDir, 'prebuilds');

  for (const platform of readdirSync(prebuildsDir)) {
    const platformDir = join(prebuildsDir, platform);
    for (const file of readdirSync(platformDir)) {
      if (file === 'spawn-helper') {
        chmodSync(join(platformDir, file), 0o755);
      }
    }
  }
} catch {
  // node-pty not installed yet or prebuilds missing — safe to ignore
}
