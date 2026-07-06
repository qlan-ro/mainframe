/**
 * `tauri dev` wrapper — threads VITE_PORT into Tauri's devUrl.
 *
 * tauri.conf.json's `build.devUrl` is static (http://localhost:5174), but the dev
 * launch configs (and per-worktree port allocation) may run the ui Vite on a
 * different VITE_PORT. Tauri config can't read env, so we merge a `devUrl`
 * override via `--config` (Tauri merges multiple --config in order) so Tauri waits
 * for + loads the right port. Bare runs (no VITE_PORT) keep 5174, matching the
 * static config. The dev overlay file (withGlobalTauri) is still merged first.
 */
import { execFileSync } from 'node:child_process';

const port = process.env.VITE_PORT ?? '5174';
const devUrl = `http://localhost:${port}`;

try {
  execFileSync(
    'cargo',
    [
      'tauri',
      'dev',
      '--features',
      'mcp-bridge',
      '--config',
      'src-tauri/tauri.dev.conf.json',
      '--config',
      JSON.stringify({ build: { devUrl } }),
    ],
    { stdio: 'inherit' },
  );
} catch (err) {
  // cargo exits non-zero on Ctrl+C / window close — propagate the code without a
  // noisy Node stack trace.
  process.exit(typeof err?.status === 'number' ? err.status : 1);
}
