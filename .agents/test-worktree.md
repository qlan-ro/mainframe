# Test Worktree Config: Mainframe

Project-specific configuration consumed by the `test-worktree` skill (which
dispatches the `prepare-worktree` subagent for environment setup). See
`~/.claude/skills/test-worktree/SKILL.md` for the staged pipeline and
`~/.claude/agents/prepare-worktree.md` for the env subagent.

## App Type

Single-shell monorepo: one shared React renderer (`packages/ui`), one desktop
shell (Tauri — the Electron shell was retired). Three testable **Targets** —
pick one per run (user's ask → diff paths → default).

### Target: tauri (default)

- Type: `tauri-desktop` — Tauri 2 shell (`packages/app-tauri/src-tauri`),
  spawns the daemon itself.
- Engine: `tauri-mcp` (the WKWebView has no CDP). Dev builds compile the
  bridge in (`pnpm tauri:dev` → `cargo tauri dev --features mcp-bridge`).
- Launch: `script: .agents/launch-test-tauri.sh` — run it EXACTLY ONCE, via
  `test-env.sh up tauri`. It owns the workspace install, the isolated env from
  the generated `.env` (which overrides an inherited `DAEMON_PORT`, so a shell
  polluted with the production 31415 no longer blocks the run), sidecar
  provisioning, the background `tauri:dev`, and the readiness wait. It blocks
  until ready and prints `READY` + facts (ports, APP_URL, LOG), or exits 1 with
  the log tail — do not re-launch on failure, read the printed tail. A cold
  worktree compiles the daemon *and* the native shell here; the wait allows for
  that and fails fast if `tauri:dev` dies, so a long silence is a build, not a
  hang. Run `test-env.sh prepare tauri` ahead of time to pay that cost outside
  the run.
- After READY: confirm the app appears in the bridge's `list_devices`.
- Diff paths: `packages/app-tauri/`, `packages/ui/`.
- Bridge quirks (verified 2026-07-09): selector-based tools
  (`webview_find_element`, selector-mode `webview_interact`,
  `webview_keyboard`, `webview_wait_for`) can throw
  `window.__MCP__.resolveRef is not a function` — fall back to
  `webview_execute_js` for lookups/typing (native value setter +
  `dispatchEvent('input')`) and coordinate `webview_interact` clicks.
  `webview_dom_snapshot` selectors must resolve to a single small container
  (broad multi-match selectors blow the token limit). `webview_wait_for`
  cannot evaluate `:not()` compound selectors.
- The in-app project picker is unrelated to which worktree's binary runs —
  a target project sitting on a different git branch is NOT a wrong-build
  signal; the shell/daemon code is built from this worktree regardless.

### Target: tauri-qa (packaged build — CSP/signing/auto-updater QA only)

- Type: `tauri-desktop`, packaged variant — a debug-profile app bundle built
  with the `mcp-bridge-qa` feature and the `tauri.qa.conf.json` overlay
  (global Tauri IPC, `'unsafe-inline'` in `script-src`, and Tauri's asset-hash
  injection disabled for `script-src` — the hashes would otherwise cancel
  `'unsafe-inline'`), not the dev shell.
- Engine: `tauri-mcp`, same as `tauri`, but the bridge is compiled into a
  *packaged* build via `mcp-bridge-qa` (dev's `mcp-bridge` feature is absent
  from every other packaged build; this is the one exception).
- Build: `bash scripts/build-qa-tauri.sh` once per checkout before the first
  launch (or after any src-tauri/renderer change) — not part of `up`, because
  a cold `tauri build --debug` is expensive enough to want explicit control
  over when it re-runs.
- Launch: `script: .agents/launch-test-tauri-qa.sh` — run it EXACTLY ONCE,
  via `test-env.sh up tauri-qa`. From a worktree, invoke the script directly
  instead (`bash .agents/launch-test-tauri-qa.sh`): `test-env.sh` re-execs the
  **primary** checkout's harness, and the primary only knows the `tauri-qa`
  target once this branch merges into it. It owns port/data-dir isolation
  (derives its own `DAEMON_PORT` and `MAINFRAME_DATA_DIR`, distinct from the
  `tauri` target's — see Environment below), refuses to launch on an
  unisolated port or data dir, kills a previous QA instance it owns before
  relaunching, and blocks until it prints `READY` + facts (`DAEMON_PORT`,
  `DATA_DIR`, `BRIDGE=127.0.0.1:9323`, `APP`, `PID`, `LOG`), or exits 1 with
  the log tail.
- After READY: attach with `driver_session start {"host": "127.0.0.1", "port":
  9323}` and verify `get_backend_state` names this checkout's `cwd` before
  trusting any assertion — see `docs/guides/packaged-tauri-qa.md` §4.
- Diff paths: `packages/app-tauri/src-tauri/tauri.qa.conf.json`,
  `packages/app-tauri/src-tauri/src/mcp_bridge.rs`,
  `scripts/build-qa-tauri.sh`, plus `packages/app-tauri/`, `packages/ui/` as
  for the `tauri` target.
- Gotchas — all documented in full at `docs/guides/packaged-tauri-qa.md`:
  - **Bridge reset is stop-ALL, never targeted.** `driver_session stop` with
    no `appIdentifier` — a targeted stop leaves the helper-registration cache
    poisoned and every relaunch fails ref-based tools with `Resolve-ref
    helper was not available in the webview after registration.`
  - **Preview child-webview precondition is a different failure**, signaled
    by a "window not found" error instead of that timeout — stop the mounted
    preview's launch config before attaching.
  - **Never reset the webview data store** — every Mainframe build shares one
    bundle identifier (`ro.qlan.mainframe`) and one WKWebView data store;
    doing so would also wipe the production app's store. Isolation here is
    port/data-dir only.
  - Teardown needs its ports passed explicitly — see Environment below.

### Target: browser (cheapest — use when NO scenario is native-required)

- Type: `web-spa` — the shared `packages/ui` renderer in a plain browser +
  the daemon from source. No Electron, no Rust: bring-up 1–2 min.
- Launch: `script: .agents/launch-test-browser.sh` — blocks until ready,
  prints `READY` + `APP_URL`.
- Engine: `playwright-cli` fresh browser (`open --headed $APP_URL`) — full
  selector/ref support, no bridge quirks, no pinned CDP port.
- Eligibility: chosen by the skill's cheapest-sufficient-target rule — every
  scenario in the set must be renderer/daemon-only. **Native surfaces that
  do NOT exist here** (any scenario touching them forces a native target):
  preview child webviews, PTY terminal, window chrome/traffic lights, native
  menus/tray/file dialogs, any Tauri-command-backed feature. Runtime-fidelity
  caveat: this is not the shipped WKWebView/Electron runtime — compositing
  and shell-specific rendering bugs will not reproduce; run a periodic
  full-native pass for that.

## Fleet

Limits for multi-branch runs (consumed by the skill's Fleet Mode):

- **Per-target caps: `tauri` max 1, `tauri-qa` max 1, `browser` max 4.** The
  tauri-mcp bridge reliably tracks one app at a time per target (and dies
  while a preview child webview is mounted — see Gotchas). Browser runs have
  no singleton (fresh browser per run, isolated ports) and are light
  (daemon + Vite only) — they run genuinely in parallel.
- **`tauri` and `tauri-qa` may run concurrently in one checkout** — all three
  isolation axes differ between them: bridge port (`9223` vs `9323`), daemon
  port (`.env`'s `DAEMON_PORT` vs that port plus 1000), and data dir
  (`~/.mainframe_dev` vs `~/.mainframe_qa`). Attachment verification
  (`get_backend_state`'s `cwd`) is still required before trusting either
  session — the bridge port alone does not prove which app a tool call is
  driving. Across checkouts, a QA port derived from a low dev port can in
  principle meet another checkout's dev port at `32416` (the dev range's
  ceiling is the QA range's floor) — `launch-test-tauri-qa.sh`'s
  already-listening refusal is the backstop: it kills only a port holder
  whose binary lives under its own checkout, then refuses to launch if a
  foreign holder remains, rather than colliding with it.
- **Max parallel runs: 4 total**, but at most one `tauri`/`tauri-qa` build at
  a time (a full native compile thrashes the machine; browser runs are
  cheap).
- **Prefer the browser target.** It builds only the daemon, where `tauri`/
  `tauri-qa` also compile the whole native shell — so it stays the default
  path for renderer/daemon-only scenario sets. Reserve `tauri` for genuinely
  native surfaces and `tauri-qa` for CSP/signing/auto-updater QA the dev
  target cannot reproduce (see `docs/guides/packaged-tauri-qa.md`). Neither
  native target is free in a fresh worktree: cargo can't share a target dir
  across worktrees, so the first run in one pays a cold compile.
- Daemon/Vite ports and `MAINFRAME_DATA_DIR=~/.mainframe_dev` (or, for
  `tauri-qa`, `~/.mainframe_qa`) are isolated per run, so parallel runs don't
  collide there — but each target's runs DO share its own data dir;
  scenarios that assert on global DB state (project/chat counts) belong in
  sequential runs.
- **Process kills in a fleet:** the Cleanup section below kills ANY listener in
  the test port ranges — including live test runs — so it is reachable only as
  `test-env.sh reset` and runs exactly once (orchestrator, before any env
  exists). `up` never calls it. Per-branch teardown uses the Stop / Restart
  section, which is scoped to that worktree's own `.env` ports and is
  parallel-safe.
- Protected port `31415` applies to every run, always.

## Protected Ports

Ports the skill MUST NEVER kill, even when cleaning up stale dev processes.

- `31415` — production daemon (installed app at `/Applications/`)

Verify any candidate PID does not hold `31415` before sending SIGKILL.

## Environment

`.env` is **generated** by `scripts/setup-ports.sh` (invoked from the `tauri`
and `browser` launch scripts on first use), not hand-written. It always holds
isolated free ports — the `31415`/`5173` defaults below are the *production*
values and are deliberately never used for a test worktree. `tauri` and
`browser` read the same `.env` directly, so the facts a run prints, the ports
it listens on, and the ports `down` tears down are the same set for those two
targets. `tauri-qa` instead **derives** its own ports from `.env` rather than
reading it directly — see the `tauri-qa` row below — so its facts and ports
are a different set that `down` does not tear down by default (pass them
explicitly; see Stop / Restart).

| Variable | Used by | Source | Isolated range / value |
|---|---|---|---|
| `DAEMON_PORT` | Core daemon (`tauri`, `browser`) | generated `.env` | free port in `31416–32416` |
| `VITE_PORT` | Vite dev server | generated `.env` | free port in `5174–6174` |
| `MAINFRAME_DATA_DIR` | Core + renderer (`tauri`, `browser`) | generated `.env` | `~/.mainframe_dev` |
| `VITE_DAEMON_HTTP_PORT` | Renderer HTTP | generated `.env` | `=$DAEMON_PORT` |
| `VITE_DAEMON_WS_PORT` | Renderer WS | generated `.env` | `=$DAEMON_PORT` |
| `LOG_LEVEL` | Core daemon | set by `launch-test-browser.sh` | `debug` |
| `DAEMON_PORT` | Core daemon (`tauri-qa`) | derived by `launch-test-tauri-qa.sh` | `.env`'s `DAEMON_PORT + 1000` (override: `MF_QA_DAEMON_PORT`) |
| `MAINFRAME_DATA_DIR` | Core + renderer (`tauri-qa`) | set by `launch-test-tauri-qa.sh` | `~/.mainframe_qa` (override: `MF_QA_DATA_DIR`) |

Production defaults (never used here): `DAEMON_PORT=31415`, `VITE_PORT=5173`,
`LOG_LEVEL=info`. Full isolation contract and endpoint table:
`docs/guides/packaged-tauri-qa.md` §8–9.

## Cleanup (Kill Stale Dev Processes)

```
script: .agents/test-env.sh reset
```

Run it exactly as-is — it kills stale `run dev` wrappers and CDP 9222 while
skipping anything on the protected port 31415, retries once, and exits nonzero
if processes survive. It sweeps the whole test port range, so it takes every
other checkout's live run with it: fleet runs execute it exactly once
(orchestrator, before any env exists), never per-branch, and `up` never calls
it.

**Never use `pkill -f "mainframe"` unfiltered** — it can hit the production app. The commands above specifically target `run dev` processes and skip anything on port 31415.

Each target's own **Launch** bullet above is authoritative
(`launch-test-tauri.sh`, `launch-test-tauri-qa.sh`, or
`launch-test-browser.sh`, run EXACTLY ONCE) — because it already does a full
install + build, the dispatching `prepare-worktree` subagent does **not** need
a separate build step for this project. `tauri-qa` is the one exception: its
app bundle build (`scripts/build-qa-tauri.sh`) is a separate, explicit step
run before the first launch — see Target: tauri-qa above.

## Wait for Ready

The launch scripts own the readiness wait — a caller never re-implements it.
Declarative facts the engines need after `READY`:

- Daemon HTTP: `http://127.0.0.1:$DAEMON_PORT/api/projects` responds.
- Tauri: Vite at `http://localhost:$VITE_PORT` (`localhost`, not
  `127.0.0.1`), app present in the bridge's `list_devices`.
- Tauri-QA: daemon HTTP as above (on the derived `DAEMON_PORT`), plus the
  bridge's own startup log line reporting `127.0.0.1:9323` — no Vite check,
  since the packaged build serves assets from `tauri://`, not a dev server.

## Test Engines

| Engine | Best for |
|---|---|
| `playwright-cli` (default, browser target) | Interactive step-by-step verification |
| `playwright-test` (browser target) | Repeatable test suites |
| `tauri-mcp` (tauri, tauri-qa targets) | See Target: tauri / Target: tauri-qa above |

### playwright-test config

- Ad-hoc test path: `packages/e2e/tests/99-adhoc-<branch>.spec.ts`
- Run command: `cd packages/e2e && npx playwright test tests/99-adhoc-*.spec.ts --workers=1 --reporter=list`
- Throwaway — delete the file after reporting results, never commit.

## Seeding & Fixtures

**Reverting a seeded chat:** there is no `DELETE /api/chats/:id` (returns
404). Delete the seeded chat's row directly from the SQLite DB in the run's
isolated data dir (`$MAINFRAME_DATA_DIR/mainframe.db` — dev runs use
`~/.mainframe_dev`, never `~/.mainframe`).

**Hand-authored replay fixtures (preferred for rendering/derived-state
scenarios).** The e2e mock-cli plugin (`packages/e2e/plugins/mock-cli`, see
its `DESIGN.md`) replays an NDJSON event fixture through a real adapter —
full live event path (all SessionSink callbacks incl. `onSubagentChild`), no
API calls, fully deterministic. **Write fixtures by hand — no LLM run
needed:**

- Format (one JSON per line): `{"dir":"in","method":"sendMessage","args":["<text>"]}`
  marks a user send (positional — reply N answers send N);
  `{"dir":"out","method":"<sink method>","args":[<verbatim sink-signature args>],"delayMs":N}`
  is what the fake CLI emits; `"fx"` lines apply file effects.
- Authoring guards: start from an existing fixture in
  `packages/e2e/fixtures/recordings/` (permissions, compaction, attachments,
  bash exit codes, …) and take payload shapes from
  `docs/research/adapters/claude/PROTOCOL_REVERSED.md` or `packages/core`'s own test
  fixtures — never invent event shapes; a fixture the daemon would never
  receive proves nothing.
- Replay wiring: build the plugin (esbuild, per
  `packages/e2e/fixtures/daemon.ts`), copy it into
  `<data-dir>/plugins/mock-cli`, run the daemon with `E2E_MODE=mock
  E2E_RECORDINGS_DIR=<dir with your fixture>`, create the chat with the mock
  adapterId.
- `E2E_MODE=record` also exists (tees a real CLI session to a fixture) but is
  a shape-sampling aid, not the default path — it reintroduces live-LLM cost
  and nondeterminism.

Rules learned from live runs (2026-07-09 fleet):

- **Never use `/tmp` as a throwaway project path** for transcript/session-path
  scenarios on macOS — the CLI encodes the `/private` realpath while the
  daemon stores the symlinked path, and they never match. Use `~/Projects/...`.
- **Seed session state through the running app, not SQLite.** Writing
  `claude_session_id`/`transcript_missing` directly to the DB is invisible to
  the daemon's in-memory `activeChats` cache — send a real message instead.
- **File-watch/external-edit fixtures** must live outside any dev server's
  watched root (use repo-root docs, not `packages/*/src`) or HMR of the app
  under test confounds the check.
- **Register the worktree as a project first** (`POST /api/projects
  {"path": "<worktree>"}`) before any file-surface testing — the pre-existing
  "mainframe" project points at the main checkout, and file edits through it
  silently target the wrong filesystem path.
- `~/.mainframe_dev` accumulates real project registrations across runs;
  non-mainframe launch configs failing to start (`command not found`) is a
  PATH/env artifact, not a bug — the config's presence in the picker is the
  signal, not whether its process binds.

## Stop / Restart

```
script: .agents/test-env.sh down [port ...]
```

Port-scoped, parallel-safe teardown of one run — defaults to the target
checkout's `.env` ports (plus port `9222`, a harmless no-op check now that nothing binds
it); pass explicit ports to override. Refuses the protected port 31415;
exits nonzero if a port stays held. Always kills the full port set for
exactly this run — never kill a single port and expect the rest of the run
to keep working.

**Tauri caveat:** killing `$DAEMON_PORT` also takes the parent `app-tauri`
process (shared socket). At teardown that is intended; never use this
mid-run hoping for a daemon-only restart — relaunch the app properly
instead.

**Tauri-QA caveat:** the default port set above comes from `.env`, which is
the `tauri` target's *dev* port, not the derived QA port. Tearing down a
`tauri-qa` run needs its ports passed explicitly:
`.agents/test-env.sh down "$QA_DAEMON_PORT" 9323`.

Then re-run the target's own **Launch** step (see its Target section above).

## Project-Specific Gotchas

### Tooltip verification (Radix)

Radix tooltips portal to `<body>`. Checking `[role="tooltip"]` after hover can match tooltips from adjacent elements or stale tooltips that haven't dismissed. Always verify tooltip **content**, not just existence.

Past incident: `overflow: hidden` inside `@container` clipped a tooltip, but the Playwright test passed because it matched a tooltip from an adjacent element.

### `data-active` across zones

`button[data-active="true"]` exists in multiple zones (sidebar, tab bars, panels). Scope to the relevant container or filter by text:

```typescript
// Scope to a specific zone
const rightPanel = page.locator('[data-zone="right-top"]');
const tab = rightPanel.locator('button[data-active="false"]').first();

// Or narrow by visible text
const filesTab = page.locator('button[data-active="true"]', { hasText: /Files/ });
```

### Single-tab zones don't render tab bars

If a zone has only one tab, the tab bar isn't rendered at all. Don't assert tab presence to prove a tab is active — use a screenshot.
