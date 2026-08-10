# todo #318 — Packaged Tauri QA variant for the tauri-mcp bridge

**Branch:** `todo/318-packaged-tauri-qa-bridge` · **Route:** no-spec (works from the approved Agent Brief) · **Date:** 2026-08-10

## Goal

Give the repo a supported way to drive a *packaged* Mainframe build with the tauri-mcp bridge. Today the bridge is compiled out of every packaged build, the injected helper it needs is blocked by the packaged CSP, `window.__TAURI__` is absent outside dev, and the bridge's listener port is chosen by an upward port scan — so a QA session can silently attach to a dev app in another checkout. This plan adds a build-time QA variant (a separate config overlay plus a second cargo feature, leaving the default build path and release artifacts byte-for-byte unchanged), pins the bridge to a deterministic loopback endpoint distinct from dev's, commits a launch script that refuses to run without an isolated data directory and a non-production daemon port, and commits a QA recipe documenting attachment verification, the bridge-reset step, the preview child-webview precondition, and the pinned crate/server pair. It closes with a live run: a packaged CSP smoke, a three-relaunch gate, and todo #305's carried-over 401 scenario.

## Source findings this plan is built on

Read at plan time from the actual crate and package sources. Every one of them changes a task; do not re-derive them during implementation.

1. **The bridge's helper registration is an inline `<script>` element.** `tauri-plugin-mcp-bridge-0.11.2/src/websocket.rs:~690` builds `document.createElement('script'); script.textContent = …; document.head.appendChild(script)` and runs it through `window.eval`. The outer eval is privileged and runs; the inline element it creates is subject to `script-src`, so the packaged CSP (`script-src 'self'`) blocks it. `'unsafe-eval'` governs `eval`/`new Function` and is irrelevant here — which is why the 2026-08-09 experiment showed no change.
2. **`'unsafe-inline'` will actually be honored in this app.** Tauri rewrites the served CSP only when it finds inline/`http`-src scripts: `tauri-2.11.2/src/manager/mod.rs:86` calls `replace_csp_nonce`, which adds `'nonce-…'`/hash sources **only if** `nonces` or `csp_hashes` are non-empty, and `tauri-utils/src/html.rs:150` injects nonces only into `script[src^='http']`. `packages/ui/index.html` has no inline script and Vite emits a relative `/assets/*.js` src, so `script-src` is served verbatim. **No `dangerousDisableAssetCspModification` is needed** — and the guard test asserts that key stays absent from both configs. Task 11 re-verifies this against the real built artifact rather than trusting the inference.
3. **The MCP server's reset is stop-ALL, never targeted stop.** `@hypothesi/tauri-mcp-server@0.12.0/dist/driver/session-manager.js:338` calls `resetInitialization()` only in the no-`appIdentifier` branch of `handleStopAction`. `webview-executor.js` caches registration per `host:port:windowId` in `initializedTargets`; a targeted `driver_session stop {appIdentifier}` leaves that cache poisoned, so after a relaunch on the same port the server skips re-registration and every ref-based tool fails with `Resolve-ref helper was not available in the webview after registration.` This is a second, source-confirmed mechanism for the reported relaunch failure, independent of port drift.
4. **`driver_session start` silently falls back to discovery.** `handleStartAction` tries the requested `host:port`, and on failure calls `getFirstAvailableApp()` over the default range (base `9223`, 100 ports) and attaches to whatever answers — a dev app in another checkout included. Attachment verification after every start is therefore mandatory, not defensive.
5. **The 0.12 server disambiguates by reported cwd; only the 0.12 crate reports one.** `commands/backend_state.rs` gained `cwd` in 0.12.0; `session-manager.js` `findSessionByCwd` scores sessions against `MCP_BRIDGE_CWD` / `process.cwd()` and skips sessions whose `cwd` is null. Against the pinned 0.11.2 crate that disambiguation is dead.
6. **The plugin's Builder API is unchanged between 0.11.2 and 0.12.0** (`src/config.rs` is byte-identical), so the crate bump carries no app-code migration. `Builder::new().bind_address(&str).base_port(u16).build()` is the shape the shell will use; the plugin still scans 100 ports upward from the base, so pinning alone is not sufficient — the launch script must assert the bound port.
7. **The server's host default is `localhost`.** `dist/config.js` `getDefaultHost()` returns `localhost`, which can resolve to `::1` while the plugin binds `127.0.0.1` (the same trap as the Vite v6 IPv6 note). The recipe passes `host: "127.0.0.1"` explicitly.
8. **`createUpdaterArtifacts: true` is on in `tauri.conf.json`** and makes `tauri build` demand `TAURI_SIGNING_PRIVATE_KEY`. `scripts/build-release-local.sh` already works around this with an inline `--config`; the QA build script does the same rather than putting it in the overlay.

## Constraints

- CLAUDE.md: max 300 lines/file, 50 lines/function. `packages/app-tauri/src-tauri/src/lib.rs` is already **449 lines** — the registration change goes in a new module, and lib.rs gains only the `mod` line and a one-line call.
- No `CARGO_TARGET_DIR` override anywhere (five consumers hardcode the daemon target paths).
- The default build path, the release CI job, the static `tauri.conf.json`, and the signing/notarization config are untouched. Nothing in this plan edits `tauri.conf.json`, `.github/workflows/release.yml`, `scripts/build-release-local.sh`, or `scripts/build-standalone.sh`.
- A changeset is required before commit; an empty one is acceptable here.
- Any Mainframe launch without an isolated `MAINFRAME_DATA_DIR` and a non-production `DAEMON_PORT` hijacks the production daemon on `:31415` and the real `~/.mainframe`, killing the live agent session. Port `31415` is protected everywhere.

## Decisions taken while planning

| Decision | Choice | Why |
|---|---|---|
| Second cargo feature vs. env switch | `mcp-bridge-qa = ["mcp-bridge"]` | The QA endpoint must be compiled in, not runtime-selectable; a runtime env switch would ship the QA port constant into dev builds and give the default build a knob it should not have. |
| Dev bridge bind address | changes from `0.0.0.0:9223` (plugin default) to `127.0.0.1:9223` | Both paths become explicit, and the dev listener stops being reachable from the LAN. **This is a behavior change to the existing dev path** — flagged for the lane; if the user drives dev from another host, keep `0.0.0.0` for dev and loopback for QA only. |
| QA base port | `9323` | Outside the server's default discovery range (`9223`–`9322`) and outside the reach of dev's upward scan, so no session can wander between the two. Requires an explicit `port` in `driver_session start`, which is what the recipe does anyway. |
| Build profile for the QA variant | `tauri build --debug --bundles app` | CSP, the `tauri://` asset protocol, and the bundled sidecar all behave as packaged; output lands in `target/debug/bundle/macos/`, so it can never be mistaken for a release artifact, and skipping the dmg keeps the loop cheap. Signing and notarization are explicitly out of scope for this variant. |
| Crate 0.12 vs. server 0.11 | bump the crate to `0.12.0`, pin the server to `0.12.0` | Finding 5 — only the 0.12 crate reports the cwd the 0.12 server needs, and the Builder API is identical (finding 6). Fallback if the bump regresses: pin the server to `0.11.2` and record why. |
| QA data directory | `~/.mainframe_qa` | Isolated from production `~/.mainframe` **and** from the dev target's shared `~/.mainframe_dev`, so a QA run's DB state can't be confused with a dev run's. |
| Harness integration | a `tauri-qa` target in `.agents/test-env.sh` plus its own launch script | Mirrors the existing `tauri`/`browser` targets so `.agents/test-worktree.md` can describe it in the same shape. |
| `createUpdaterArtifacts` | disabled via an inline `--config` in the build script, not in the overlay | Keeps the overlay to exactly the three security concessions the acceptance criteria name. |

## Task list

### Group 1 — config-guard test (red phase)

**Task 1. Add the QA-concession leak guard.**
- File (new): `packages/app-tauri/src-tauri/tests/config_guard.rs`
- Parse `tauri.conf.json` and `tauri.qa.conf.json` with `serde_json` via `std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/…"))` — a runtime read, not `include_str!`, so a missing overlay fails the test instead of breaking compilation of the whole test target.
- Assertions against `tauri.conf.json` (must pass immediately, and must keep passing forever):
  - `app.security.csp` contains `script-src 'self'` and contains none of `'unsafe-inline'`, `'unsafe-eval'`, `nonce-`, `sha256-`.
  - `app.withGlobalTauri` is `false`.
  - `app.security.dangerousDisableAssetCspModification` is absent.
- Assertions against `tauri.qa.conf.json` (red until Task 4):
  - `app.withGlobalTauri` is `true`.
  - `app.security.csp` `script-src` contains `'self'` and `'unsafe-inline'` and does **not** contain `'unsafe-eval'`.
  - `app.security.dangerousDisableAssetCspModification` is absent (finding 2).
  - the overlay's top-level key set is exactly `{"$schema", "app"}` — it may not carry bundle, build, or plugin config.
- Assertion on feature wiring, using `cfg!` rather than parsing Cargo.toml (avoids adding a `toml` dev-dependency, which would collide with Group 2's Cargo.toml edit): a test asserting `!cfg!(feature = "mcp-bridge")` under a plain `cargo test`, and a `#[cfg(feature = "mcp-bridge-qa")]`-gated test asserting `cfg!(feature = "mcp-bridge")` (the QA feature implies the dev feature).
- **Verify:** `cd packages/app-tauri/src-tauri && cargo test --test config_guard` — the three default-config tests and the `!cfg!(feature)` test pass; every `tauri.qa.conf.json` test fails with a file-not-found message. Record that output as the red phase.

### Group 2 — deterministic bridge registration

**Task 2. Bump the plugin crate and add the QA feature.**
- File: `packages/app-tauri/src-tauri/Cargo.toml`
- `tauri-plugin-mcp-bridge = { version = "0.12", optional = true }`.
- Add `mcp-bridge-qa = ["mcp-bridge"]` to `[features]`, with a comment naming what it turns on beyond the dev feature (loopback base port 9323) and stating that neither feature is default.
- Update the existing `# Dev-only:` comment on the dependency to say "dev and packaged-QA only".
- **Verify:** `cargo check` (no features) and `cargo check --features mcp-bridge-qa` both succeed from `packages/app-tauri/src-tauri`; `grep -n 'tauri-plugin-mcp-bridge' Cargo.lock` shows `0.12.0`; `cargo test --test config_guard` — the two feature tests still pass.

**Task 3. Move the plugin registration into an explicit, feature-split module.**
- File (new): `packages/app-tauri/src-tauri/src/mcp_bridge.rs`, gated `#![cfg(feature = "mcp-bridge")]`-style at its `mod` declaration.
- Expose `pub const BIND_ADDRESS: &str = "127.0.0.1";`, `pub const DEV_BASE_PORT: u16 = 9223;`, `pub const QA_BASE_PORT: u16 = 9323;`, a `pub fn base_port() -> u16` returning `QA_BASE_PORT` under `#[cfg(feature = "mcp-bridge-qa")]` and `DEV_BASE_PORT` otherwise, and `pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R>` returning `tauri_plugin_mcp_bridge::Builder::new().bind_address(BIND_ADDRESS).base_port(base_port()).build()`.
- Move the runtime `CapabilityBuilder::new("dev-mcp-bridge")` block here as `pub fn grant_capability(app: &tauri::AppHandle)`, keeping its `tracing::warn!` on failure (no silent catch).
- Add a `#[cfg(test)] mod tests` asserting `BIND_ADDRESS == "127.0.0.1"`, that `DEV_BASE_PORT != QA_BASE_PORT`, and that `QA_BASE_PORT` sits outside `DEV_BASE_PORT..DEV_BASE_PORT+100` (the plugin's scan window and the server's discovery window are both 100 wide — this is the constant that keeps the two targets from colliding).
- File: `packages/app-tauri/src-tauri/src/lib.rs` — add `#[cfg(feature = "mcp-bridge")] mod mcp_bridge;`, replace `builder.plugin(tauri_plugin_mcp_bridge::init())` with `builder.plugin(mcp_bridge::plugin())`, replace the inline `add_capability` block in `setup` with `mcp_bridge::grant_capability(app.handle())`, and drop the now-unused `use tauri::ipc::CapabilityBuilder` import. Net line change to lib.rs must be negative.
- **Verify:** `cargo check --features mcp-bridge` and `cargo check --features mcp-bridge-qa` succeed; `cargo test --features mcp-bridge-qa mcp_bridge` passes; `cargo check` with no features succeeds and `grep -c mcp_bridge src/lib.rs` shows only the gated references; `wc -l src/lib.rs` is lower than 449.

### Group 3 — QA build variant

**Task 4. Add the QA config overlay.**
- File (new): `packages/app-tauri/src-tauri/tauri.qa.conf.json`
- Exactly two `app` keys, mirroring the shape of `tauri.dev.conf.json`: `"withGlobalTauri": true` and `app.security.csp` — the default CSP string copied verbatim with `script-src 'self'` changed to `script-src 'self' 'unsafe-inline'` and nothing else altered.
- No bundle, build, or plugin keys. No `dangerousDisableAssetCspModification`.
- **Verify:** `cargo test --test config_guard` — all tests pass, including the overlay assertions that were red in Task 1. `diff <(jq -r '.app.security.csp' tauri.conf.json) <(jq -r '.app.security.csp' tauri.qa.conf.json)` shows exactly the one `script-src` difference.

**Task 5. Add the QA build script.**
- File (new, executable): `scripts/build-qa-tauri.sh`
- `set -euo pipefail`; resolve `ROOT` the way `build-release-local.sh` does.
- **Unset `DAEMON_PORT`, `VITE_PORT`, `VITE_DAEMON_PORT`, `VITE_DAEMON_HTTP_PORT`, `VITE_DAEMON_WS_PORT`, `MAINFRAME_DATA_DIR` before building**, with a comment naming the reason: ambient dev env vars bake into the renderer bundle and pin the packaged app to the wrong port/data dir. The shell resolves the daemon port at runtime through `get_daemon_port`, so the QA app must be built with those clear and given its ports at launch.
- Build: `( cd "$ROOT/packages/app-tauri" && pnpm exec tauri build --debug --bundles app --features mcp-bridge-qa --config src-tauri/tauri.qa.conf.json --config '{"bundle":{"createUpdaterArtifacts":false}}' )` (finding 8).
- On success, print `QA_APP=<path to target/debug/bundle/macos/Mainframe.app>` and the `CFBundleExecutable` resolved from its `Info.plist`; exit 1 with a clear message if the bundle is absent.
- Print a one-line reminder that this artifact is unsigned and is not a release build.
- **Verify:** `bash scripts/build-qa-tauri.sh` produces `packages/app-tauri/src-tauri/target/debug/bundle/macos/Mainframe.app`; `strings` on the bundled binary (or `nm`) finds `mcp-bridge` symbols; `grep -o "script-src[^;]*" ` on the bundle's `index.html`-adjacent CSP is checked live in Task 11, not here. `shellcheck scripts/build-qa-tauri.sh` is clean.

### Group 4 — isolated launch harness

**Task 6. Add the QA launch script.**
- File (new, executable): `.agents/launch-test-tauri-qa.sh`, mirroring `launch-test-tauri.sh`'s structure (`MF_TARGET`, `MF_MODE`, `.env` sourcing, `READY` + facts, log tail on failure).
- Refusal checks, before anything else, each exiting non-zero with `REFUSED:` and the reason:
  - `DAEMON_PORT` is unset or `31415`.
  - `MAINFRAME_DATA_DIR` resolves to `$HOME/.mainframe`.
  - the QA bundle is missing (tell the caller to run `scripts/build-qa-tauri.sh`).
- Set `MAINFRAME_DATA_DIR="$HOME/.mainframe_qa"` (overriding whatever `.env` carries) and create it.
- **Launch by exec'ing `Mainframe.app/Contents/MacOS/<CFBundleExecutable>` directly** (read the name from `Info.plist` via `PlistBuddy`), `nohup … &` + `disown`, log to `/tmp/mf-tauri-qa-${DAEMON_PORT}.log`. Comment the reason: `open`/Finder does not pass the environment through, so a Finder-launched build would hijack `:31415` and the real `~/.mainframe`.
- Idempotent relaunch: if a PID file (`/tmp/mf-tauri-qa-${DAEMON_PORT}.pid`) names a live process, kill it and **wait for TCP 9323 to be free** (poll `lsof -ti :9323`, up to 15s) before starting. Exit non-zero with `RELAUNCH_BLOCKED: port 9323 still held by pid …` if it never frees — this is what stops the new instance drifting to 9324 (finding 6).
- Readiness wait: daemon on `http://127.0.0.1:$DAEMON_PORT/api/projects`, then **grep the app log for the plugin's `WebSocket server listening on: 127.0.0.1:9323` line and require the port to be exactly 9323**; exit non-zero with the observed line otherwise.
- On success print `READY`, `DAEMON_PORT`, `DATA_DIR`, `BRIDGE=127.0.0.1:9323`, `APP=<bundle path>`, `PID`, `LOG`.
- **Verify:** (a) `DAEMON_PORT=31415 bash .agents/launch-test-tauri-qa.sh` exits non-zero printing `REFUSED` and launches nothing (`lsof -ti :31415` unchanged, production app still alive); (b) `MAINFRAME_DATA_DIR=$HOME/.mainframe bash .agents/launch-test-tauri-qa.sh` likewise refuses; (c) a normal run prints `READY` with `BRIDGE=127.0.0.1:9323`. `shellcheck` clean.

**Task 7. Wire `tauri-qa` into the harness dispatcher.**
- File: `.agents/test-env.sh` — add `tauri-qa) echo "$AGENTS/launch-test-tauri-qa.sh tauri-mcp" ;;` to `launcher()`, extend the usage string and the header comment to name the third target and its one-instance cap.
- No change to `stop-test.sh`: it is port-scoped and already tears down the QA run's `DAEMON_PORT` (killing the daemon takes the parent app). The QA doc states the bridge port `9323` may be passed explicitly when a wedged listener survives.
- **Verify:** `bash .agents/test-env.sh` with no args prints the usage line including `tauri-qa`; `bash .agents/test-env.sh prepare tauri-qa` reaches the QA script's refusal/build checks rather than "unknown target"; `bash .agents/test-env.sh up browser` still resolves to the browser launcher (no regression).

### Group 5 — documentation and changeset

**Task 8. Write the packaged-QA recipe.**
- File (new): `docs/guides/packaged-tauri-qa.md`. Sections, in this order:
  1. **What this is for** — CSP enforcement, code signing, the auto-updater: what `tauri:dev` cannot reproduce. Everything else belongs on the dev or browser target.
  2. **One-time user setup (server pin).** The MCP server config is user-scoped, not repo-scoped. Copy-pasteable block pinning `npx -y @hypothesi/tauri-mcp-server@0.12.0`, named as a matching pair with the crate pin `tauri-plugin-mcp-bridge = "0.12"` in `packages/app-tauri/src-tauri/Cargo.toml`. State that the unpinned `npx` invocation is what produced the 0.12-server/0.11-crate skew, and that against a 0.11 crate the server's cwd disambiguation is dead (finding 5).
  3. **Build and launch** — `scripts/build-qa-tauri.sh`, then `.agents/test-env.sh up tauri-qa`. Note that `.agents/test-env.sh` re-execs the **primary** checkout's harness, so until this branch merges, a worktree must invoke `.agents/launch-test-tauri-qa.sh` directly.
  4. **Attach and verify attachment** — `driver_session start {host: "127.0.0.1", port: 9323}` (explicit host: the server default `localhost` can resolve to `::1` while the plugin binds `127.0.0.1`), then `get_backend_state` and require `identifier == ro.qlan.mainframe` **and** `cwd` equal to the QA checkout before trusting any assertion. Quote the reason from finding 4: a start against a port that is not listening silently attaches to whatever the `9223` discovery scan finds first, which is exactly how a QA session ends up driving a dev app in another checkout.
  5. **Bridge reset** — `driver_session stop` with **no** `appIdentifier`. Explain finding 3: the server clears its per-`host:port:window` helper-registration cache only in the stop-all branch, so a targeted stop leaves a relaunched app permanently unable to register the helper. Then re-attach per section 4 and re-verify. State that this reset is what makes the relaunch gate pass.
  6. **Preview child-webview precondition — a different failure, not this one.** Symptom is a "window not found" error from every webview tool, not a helper-registration timeout; cause is that the main window cannot be resolved by label while a preview child webview is mounted. The app auto-mounts one on boot when a launch config is still marked running. How to detect it and how to stop it (stop the launch config / close the preview tab) before attaching.
  7. **Never reset the webview data store.** Every Mainframe build — production, dev, and this QA variant — ships the same bundle identifier `ro.qlan.mainframe` and therefore shares one WKWebView data store. Any "clear the webview store" step would wipe the production app's store too. Isolation here comes from `MAINFRAME_DATA_DIR` and `DAEMON_PORT` only; the recipe deliberately contains no store-reset step.
  8. **Isolation contract** — `~/.mainframe_qa`, non-production `DAEMON_PORT`, and why the launch script refuses otherwise (an unisolated launch hijacks the production daemon and kills the live agent session).
  9. **Endpoints** — dev `127.0.0.1:9223`, QA `127.0.0.1:9323`, and why they cannot collide (both the plugin's scan and the server's discovery span 100 ports from their base).
  10. **Optional user-side fallback: macOS Accessibility.** Only the human can grant it (System Settings → Privacy & Security → Accessibility, for the terminal that runs agent sessions); without it `osascript` fails with `-1719`. Named as optional, never a dependency of this recipe.
  11. **Known upstream defects** (follow-up, not fixed here) — the plugin's upward port scan with no runtime override, the server's targeted-stop cache leak, and window resolution failing while a child webview is mounted. Name the project `hypothesi/mcp-server-tauri`.
- **Verify:** every command in the doc is copy-pasteable and matches the committed scripts (`grep` the script names and the port constants out of the doc and diff them against the sources); the doc names the crate and server versions that Task 2 and this task pin; `markdownlint`-equivalent read-through for the repo's doc style (no TBDs).

**Task 9. Add the `tauri-qa` target to the test-worktree config.**
- File: `.agents/test-worktree.md`
- New `### Target: tauri-qa` section under App Type, in the same shape as `tauri` and `browser`: type, engine (`tauri-mcp`, bridge compiled in via `mcp-bridge-qa`), launch (`.agents/test-env.sh up tauri-qa`, run exactly once), readiness (`READY` + `BRIDGE=127.0.0.1:9323`), diff paths, and gotchas — attachment verification, the stop-all reset, the preview precondition, and a pointer to `docs/guides/packaged-tauri-qa.md`.
- Update **Fleet** per-target caps to `tauri` max 1, `tauri-qa` max 1, `browser` max 4, and state that `tauri` and `tauri-qa` may run concurrently *only* because their bridge ports differ — with attachment verification still required.
- Update the **Environment** table with `MAINFRAME_DATA_DIR=~/.mainframe_qa` for this target, and the **Wait for Ready** list with the QA target's facts.
- **Verify:** the new section carries every field the other two targets carry (checklist read); `grep -n "tauri-qa" .agents/test-worktree.md .agents/test-env.sh` shows the target named consistently in both.

**Task 10. Add the changeset.**
- File (new): `.changeset/<name>.md` via `pnpm changeset --empty` — nothing user-facing changes (build tooling, a QA-only feature, scripts, and docs).
- **Verify:** the file exists and `git status` shows it staged; the pre-push hook accepts the branch.

### Group 6 — live verification

Run in order, on this branch, after Groups 1–5 land. Record raw outputs in the PR body; do not edit the committed doc from this group (if the run contradicts the doc, report it and let the doc task be amended).

**Task 11. Build, launch, and prove the bridge drives the packaged app.**
- `bash scripts/build-qa-tauri.sh`, then `bash .agents/launch-test-tauri-qa.sh`.
- Attach per the recipe; verify identity via `get_backend_state`.
- Prove three tools against the packaged app: `webview_execute_js` returning `document.title`, a `webview_dom_snapshot` scoped to a single small container, and a `webview_screenshot`.
- Also capture, via `webview_execute_js`, the content of `meta[http-equiv="Content-Security-Policy"]` and confirm `script-src` reads `'self' 'unsafe-inline'` with no `nonce-`/`sha256-` source — the empirical check on finding 2.
- **Verify:** all three tools return; the CSP meta content is recorded verbatim in the PR.

**Task 12. Packaged-only CSP smoke.**
- In the same session, run `webview_execute_js` with `try { new Function('return 1')(); 'ALLOWED' } catch (e) { 'BLOCKED:' + e.name }`.
- Expected `BLOCKED:EvalError` — the packaged CSP has no `'unsafe-eval'`, and the dev target (Vite dev server, no CSP meta) answers `ALLOWED` for the same expression. Run it against a dev app too if one is already up; otherwise cite the absent CSP meta tag in dev as the contrast.
- Together with Task 11's inline-helper registration succeeding, this shows the CSP is enforced in the packaged build and relaxed in exactly one place.
- **Verify:** both results recorded in the PR.

**Task 13. Relaunch gate (three relaunches, one server session).**
- Without stopping the MCP server: relaunch the app via `.agents/launch-test-tauri-qa.sh` three times. After each relaunch run the documented reset (`driver_session stop` with no `appIdentifier`, then `start {host:"127.0.0.1", port:9323}`), verify attachment via `get_backend_state`, then run `webview_execute_js`.
- Record the plugin's `WebSocket server listening on:` line from each launch's log — the PM's time-boxed port-drift diagnostic. Report the four observed ports.
- **Verify:** three consecutive relaunches drive the newly launched instance with no helper-registration timeout and no attachment to a previous instance; all four bound ports are 9323 (any other value confirms port drift and must be reported).

**Task 14. Proof-of-life run — todo #305's carried-over 401 scenario.**
- Run verbatim from the brief: pair the app through an X-Forwarded-For proxy in front of a loopback QA daemon, revoke the paired device, and observe the app's reaction.
- **Verify:** report the observed composer restore, the error copy, and the needs-repair footer.

## Risks and open items

- **The `'unsafe-inline'` inference is verified by source reading, not by a run.** Task 11 is where it becomes fact. If the served CSP turns out to carry a nonce or hash, `'unsafe-inline'` is ignored per spec and the overlay needs `"dangerousDisableAssetCspModification": ["script-src"]` — in which case Task 1's guard must additionally assert that key is absent from `tauri.conf.json`. Report rather than silently adding it.
- **The dev bind address moves to loopback** (see Decisions). The only user-visible consequence is that a dev bridge is no longer reachable from another host.
- **Port drift is a hypothesis, not a settled cause.** The recipe does not depend on it: determinism, one live instance, verified attachment, and the stop-all reset each address a different candidate, and Task 13 is the empirical gate. Finding 3 gives a second confirmed mechanism that the reset addresses directly.
- **Upstream defects stay upstream** (plugin scan behavior, server cache leak, window resolution under a mounted child webview). Task 8 §11 records them; filing them is a separate follow-up.
- **`.agents/` scripts execute from the primary checkout.** Until this branch merges, `test-env.sh up tauri-qa` from a worktree re-execs the primary harness, which does not yet know the target — hence Task 8 §3's direct-invocation note.
