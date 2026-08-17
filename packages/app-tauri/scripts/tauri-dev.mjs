/**
 * `tauri dev` wrapper — provisions the daemon sidecar, then threads VITE_PORT
 * into Tauri's devUrl.
 *
 * tauri.conf.json's `build.devUrl` is static (http://localhost:5174), but the dev
 * launch configs (and per-worktree port allocation) may run the ui Vite on a
 * different VITE_PORT. Tauri config can't read env, so we merge a `devUrl`
 * override via `--config` (Tauri merges multiple --config in order) so Tauri waits
 * for + loads the right port. Bare runs (no VITE_PORT) keep 5174, matching the
 * static config. The dev overlay file (withGlobalTauri) is still merged first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `externalBin` is resolved by src-tauri's build script, so a checkout that has
 * never provisioned a sidecar fails `tauri dev` at a build.rs panic ("resource
 * path binaries/mainframe-daemon-<triple> doesn't exist") — which reads as a Rust
 * compile error rather than a missing artifact. Every fresh worktree is in that
 * state, so provision on absence.
 *
 * The cargo build this triggers is not extra work: dev resolves the daemon from
 * packages/core-rs/target/{release,debug} (resolve_rust_daemon_bin), so a fresh
 * worktree needs that build to reach Connected either way. On absence only,
 * though — dev never runs this copy, so refreshing it each launch would buy
 * nothing. Run `pnpm bundle` to refresh it deliberately.
 */
function provisionSidecarsIfMissing() {
  const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((l) => l.startsWith('host:'))
    ?.slice('host:'.length)
    .trim();
  if (!triple) throw new Error('could not read the host triple from `rustc -vV`');

  // Both externalBin entries are mandatory to the build script, so each is
  // provisioned on absence independently. The on-device helper is cheap either
  // way: a few seconds of `swift build` on a macOS 26 machine, and an instant
  // zero-byte placeholder anywhere else.
  const sidecars = [
    { stem: 'mainframe-daemon', script: 'provision-rust-daemon.mjs', slow: true },
    { stem: 'mainframe-intelligence', script: 'provision-apple-intelligence.mjs', slow: false },
  ];

  for (const { stem, script, slow } of sidecars) {
    if (existsSync(join(here, '..', 'src-tauri', 'binaries', `${stem}-${triple}`))) continue;
    console.log(
      `[tauri:dev] no ${stem} sidecar for ${triple} — provisioning${slow ? ' (first build is slow)' : ''}…`,
    );
    execFileSync('node', [join(here, script)], { stdio: 'inherit' });
  }
}

provisionSidecarsIfMissing();

const port = process.env.VITE_PORT ?? '5174';
const devUrl = `http://localhost:${port}`;

/**
 * Dev builds also override the traffic-light y. macOS 26 gates the button
 * metrics on the SDK a binary links: the packaged app (release runner is
 * macos-14, SDK 14.x) gets the classic buttons, whose cluster centre lands at
 * y + 2 from the window top; a local dev build links the current SDK (26+)
 * and gets the new metrics, centre = y − 2. tauri.conf.json carries the
 * packaged value (22 → centre 24, the sidebar header's midline); dev patches
 * it to 26 so a dev window centres identically. The override patches the
 * windows array read from the real config, so every other window property
 * stays single-sourced. Retune both values together when the sidebar header
 * row moves (see SessionSidebar.tsx) or the release runner's Xcode reaches
 * SDK 26.
 */
const DEV_TRAFFIC_LIGHT_Y = 26;
const conf = JSON.parse(readFileSync(join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'));
const windows = conf.app.windows.map((w) =>
  w.trafficLightPosition ? { ...w, trafficLightPosition: { ...w.trafficLightPosition, y: DEV_TRAFFIC_LIGHT_Y } } : w,
);

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
      JSON.stringify({ build: { devUrl }, app: { windows } }),
    ],
    { stdio: 'inherit' },
  );
} catch (err) {
  // cargo exits non-zero on Ctrl+C / window close — propagate the code without a
  // noisy Node stack trace.
  process.exit(typeof err?.status === 'number' ? err.status : 1);
}
