# Host Bridge Plan 3 — Tauri Full Parity Scoping + Decisions

- **Date:** 2026-06-24
- **Status:** Scoping (informs the Plan 3 implementation plan)
- **Parent:** [`2026-06-24-host-bridge-abstraction-design.md`](./2026-06-24-host-bridge-abstraction-design.md) (Phase 5 + 6). Plans 1 (foundation) and 2 (Electron adapter + retrofit) are DONE.

Goal of Plan 3: bring the Tauri host (`packages/app-tauri/src-tauri`) to full parity with the Electron host, close the Plans 1–2 deferred follow-ups, and (Phase 6) clean up.

## Locked decisions (user-approved)

1. **Auto-update = scaffold + defer infra.** Endpoint host = **GitHub Releases** (`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`, published by `tauri-apps/tauri-action`). Plan 3 wires `tauri-plugin-updater` + the Rust check/download/install + the periodic-check (10s then 4h) + a Rust port of the error classifier + the contract `updates` namespace + the Electron adapter's `updates` (over the existing `update:*` IPC). **DEFERRED to you (documented TODOs):** `tauri signer generate` keypair (private key → CI secret `TAURI_SIGNING_PRIVATE_KEY`, public key → `tauri.conf.json`), the CI release workflow, and the first signed release. Not release-testable here.
2. **Daemon production bundling = scaffold node-sidecar approach + defer the pipeline.** Wire `tauri.conf.json` `bundle.externalBin` (a pinned Node sidecar) + `bundle.resources` (daemon.cjs + `@vscode/ripgrep` + `typescript-language-server` + `pyright`), and make the Rust daemon-resolver prefer the bundled resource path in a packaged build. **DEFERRED (documented TODOs):** the per-platform node-binary fetch + the native-module ABI-rebuild pipeline (`better-sqlite3`/`node-pty` against the pinned Node), verifiable only by real per-OS `tauri build` runs.
3. **Renderer→host log sink = Rust `tracing-appender` sink.** Daily-rotating JSON matching pino's field shape (UPPERCASE level, `module`, ISO ts, `base:{pid}`, 7-day retention, unbuffered) at `${MAINFRAME_DATA_DIR ?? ~/.mainframe}/logs/<app>.YYYY-MM-DD.log`, fed by a `host_log` Tauri command (the Tauri adapter's `log` forwards records to it). Crash-safe (survives daemon-down).
4. **Presence = native OS-idle reader** (per-platform Rust; macOS via `objc2`/`CGEventSourceSecondsSinceLastEventType`), matching the Electron `idle-reporter` behavior (30s poll, 5-min idle threshold, 4-min keepalive, `POST {daemon}/api/device/activity {state}`). Add a `presence` namespace to the contract.
5. **Keep `setDevice`** in the `PreviewHandle` contract and **wire it on Tauri** (it is currently a no-op; give it a real Tauri implementation rather than dropping it).
6. **Map DaemonStatus in the TS adapter** (`tauri-adapter.ts`): map the Rust legacy strings (`running:{pid}`/`started:pid=N`/`exited`/`not_started`/`error:…`) → the `DaemonStatus` enum (`initializing|starting|ready|unavailable|stopped`), replacing the current blind `as DaemonStatus` cast. Then renderer code may branch on `daemon.status()`.

## Buildable-now task set (no infra; runtime-verifiable locally)

1. **Contract additions** — `updates` + `presence` namespaces + Zod schemas (`UpdateStatusSchema` 6-variant, `PresenceSchema`) in `host-bridge.ts`/`host-contract.ts`; implement both in the **Electron adapter** (existing `update:*` IPC + a new presence POST) and the **Fake adapter**.
2. **DaemonStatus mapping** (decision 6) — TS adapter maps legacy strings→enum; drop the `as` cast; unit tests for each mapping.
3. **`AppInfo`/`Region` → `z.infer`** — collapse the hand-written interfaces (`host-bridge.ts:19-23,32-37`) to `z.infer` of their schemas (`host-contract.ts` `AppInfoSchema`/`RegionSchema`); single canonical type.
4. **open-external allowlist normalization** — one canonical `ALLOWED_EXTERNAL_SCHEMES` in `mainframe-types`, consumed by Tauri `preview/mod.rs` `is_allowed_external_scheme` (widen from http/https-only) and TS `openExternalSafe`. Schemes: `http https mailto slack vscode vscode-insiders cursor jetbrains idea zed figma linear notion discord tel` (Electron's `index.ts:32-48` list).
5. **Native menu** (Rust) — Tauri `Menu` in `lib.rs` setup with the standard app menu + Help → "Check for Updates" (wired to the updater command).
6. **RSS memory sampling** (Rust) — a 5-min process-RSS sampler logged via the new log sink (Electron `memory-logger.ts` parity).
7. **Presence reporter** (Rust, decision 4) — native OS-idle reader + the daemon POST.
8. **Renderer log sink** (Rust, decision 3) — `tracing-appender` sink + `host_log` command + Tauri adapter `log` forwarding.
9. **`setDevice` Tauri impl** (decision 5) — wire the preview device toggle on the Tauri backend.
10. **Webview permission policy** — deny camera/mic, allow clipboard/notify in Tauri config/capabilities (+ null the macOS camera/mic usage descriptions, matching Electron).
11. **`dev:desktop` orchestration** — one `concurrently` script: core daemon + app-tauri Vite (:5174) + Electron shell.

## Infra-gated / deferred-with-TODOs task set

- **Updater Rust side** (decision 1) — plugin + Rust + endpoint config; signing key + CI release workflow are your TODOs.
- **Daemon bundling** (decision 2) — `bundle.externalBin`/`resources` wiring + resolver; per-platform node + native ABI-rebuild pipeline is a TODO.
- **Webview-crash hook** — RSS sampling is easy; the WKWebView `didTerminate` crash signal is lower-fidelity/harder (minor) — implement a best-effort signal or document the gap.
- **Legacy `packages/desktop/src/renderer` deletion (Phase 6)** — orphaned (Electron now loads app-tauri's renderer, `index.ts:181-190`); delete after a final "nothing imports it" grep + clean build. Sequence LAST.

## Key file references (for the planner)
- Tauri shell: `src-tauri/src/lib.rs` (setup/tracing/menu/daemon boot/window events), `sidecar.rs` (daemon spawn + `find_node`), `preview/mod.rs` (`is_allowed_external_scheme`), `commands/`, `tauri.conf.json`, `capabilities/main.json`, `Cargo.toml`.
- Electron parity sources: `packages/desktop/src/main/{auto-updater.ts,auto-updater-error-classifier.ts,idle-reporter.ts,logger.ts,menu.ts,memory-logger.ts,renderer-memory.ts,index.ts}`.
- Contract: `packages/types/src/host/{host-bridge.ts,host-contract.ts}`; adapters: `packages/app-tauri/src/lib/host/{tauri-adapter,electron-adapter,fake-adapter,tauri-preview,electron-preview}.ts`.

## Suggested sequencing
Buildable contract/TS items first (1–4), then Rust parity (5–10 incl. updater/bundling scaffolds), the `dev:desktop` script (11), and the legacy-renderer deletion LAST (Phase 6). The updater menu item depends on the updater command existing.
