// Electron 42 removed the `postinstall` script that previously downloaded the
// platform binary. Without it, a clean `pnpm install --frozen-lockfile` leaves
// `Electron.app` missing. We invoke Electron's own `install.js` explicitly from
// the root `postinstall`. It is idempotent: `@electron/get` skips the download
// when the versioned binary is already cached. Safe on Electron 41 too.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const desktopPkg = resolve(process.cwd(), 'packages/app-electron/package.json');

let electronDir;
try {
  const require = createRequire(desktopPkg);
  electronDir = dirname(require.resolve('electron/package.json'));
} catch (err) {
  // No Electron in this install graph (e.g. a filtered, core-only install).
  // Nothing to fetch — skip without failing the install.
  console.warn(`[install-electron] electron not resolvable, skipping: ${err.message}`);
  process.exit(0);
}

const installer = join(electronDir, 'install.js');
if (!existsSync(installer)) {
  console.warn(`[install-electron] ${installer} not found, skipping`);
  process.exit(0);
}

const result = spawnSync(process.execPath, [installer], {
  cwd: electronDir,
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error(`[install-electron] electron install.js exited with ${result.status}`);
  process.exit(result.status ?? 1);
}
