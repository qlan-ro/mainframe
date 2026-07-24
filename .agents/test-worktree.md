# Test Worktree Config: Mainframe

Project-specific configuration consumed by the `test-worktree` skill (which
dispatches the `prepare-worktree` subagent for environment setup). See
`~/.claude/skills/test-worktree/SKILL.md` for the staged pipeline and
`~/.claude/agents/prepare-worktree.md` for the env subagent.

## App Type

Single-shell monorepo: one shared React renderer (`packages/ui`), one desktop
shell (Tauri — the Electron shell was retired). Two testable **Targets** —
pick one per run (user's ask → diff paths → default).

### Target: tauri (default)

- Type: `tauri-desktop` — Tauri 2 shell (`packages/app-tauri/src-tauri`),
  spawns the daemon itself.
- Engine: `tauri-mcp` (the WKWebView has no CDP). Dev builds compile the
  bridge in (`pnpm tauri:dev` → `cargo tauri dev --features mcp-bridge`).
- Launch: `script: .agents/launch-test-tauri.sh` — run it EXACTLY ONCE. It
  owns fresh-worktree provisioning (provision:node / bundle:daemon), the
  isolated env (`DAEMON_PORT=31500`, `MAINFRAME_DATA_DIR=~/.mainframe_dev`;
  refuses 31415), the background `tauri:dev` (first run compiles Rust, up to
  10 min), and the readiness wait. It blocks until ready and prints `READY` +
  facts (ports, APP_URL, LOG), or exits 1 with the log tail — do not
  re-launch on failure, read the printed tail.
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

- **Per-target caps: `tauri` max 1, `browser` max 4.** The tauri-mcp bridge
  reliably tracks one dev app at a time (and dies while a preview child
  webview is mounted — see Gotchas). Browser runs have no singleton (fresh
  browser per run, isolated ports) and are light (daemon + Vite only) — they
  run genuinely in parallel.
- **Max parallel runs: 4 total**, but at most one tauri run at a time (its
  full native build thrashes the machine; browser runs are cheap).
- **Prefer the browser target.** Native builds are slow and heavy; the
  browser target (vite + daemon, no cargo) is the default path for
  renderer/daemon-only scenario sets — reserve tauri for genuinely native
  surfaces.
- Daemon/Vite ports and `MAINFRAME_DATA_DIR=~/.mainframe_dev` are isolated
  per run by `scripts/setup-ports.sh`, so parallel runs don't collide there —
  but they DO share `~/.mainframe_dev`; scenarios that assert on global DB
  state (project/chat counts) belong in sequential runs.
- **Process kills in a fleet:** the Cleanup section below matches ANY
  `mainframe-core/desktop run dev` process — including live test runs — so
  it runs exactly once (orchestrator, before any env exists). Per-branch
  teardown uses the Stop / Restart section, which is scoped to that
  worktree's own `.env` ports and is parallel-safe.
- Protected port `31415` applies to every run, always.

## Protected Ports

Ports the skill MUST NEVER kill, even when cleaning up stale dev processes.

- `31415` — production daemon (installed app at `/Applications/`)

Verify any candidate PID does not hold `31415` before sending SIGKILL.

## Environment

`.env` is **generated** by `scripts/setup-ports.sh` (invoked from
`launch-test-browser.sh`), not hand-written. It always holds isolated free
ports — the `31415`/`5173` defaults below are the *production* values and are
deliberately never used for a test worktree. The tauri target doesn't
generate `.env`; it sets its own isolated ports directly (see Target: tauri).

| Variable | Used by | Source | Isolated range / value |
|---|---|---|---|
| `DAEMON_PORT` | Core daemon | generated `.env` | free port in `31416–32416` |
| `VITE_PORT` | Vite dev server | generated `.env` | free port in `5174–6174` |
| `MAINFRAME_DATA_DIR` | Core + renderer | generated `.env` | `~/.mainframe_dev` |
| `VITE_DAEMON_HTTP_PORT` | Renderer HTTP | generated `.env` | `=$DAEMON_PORT` |
| `VITE_DAEMON_WS_PORT` | Renderer WS | generated `.env` | `=$DAEMON_PORT` |
| `LOG_LEVEL` | Core daemon | set by `launch-test-browser.sh` | `debug` |

Production defaults (never used here): `DAEMON_PORT=31415`, `VITE_PORT=5173`,
`LOG_LEVEL=info`.

## Cleanup (Kill Stale Dev Processes)

```
script: .agents/cleanup-test.sh
```

Run the script exactly as-is — it kills stale `run dev` wrappers and CDP
9222 while skipping anything on the protected port 31415, retries once, and
exits nonzero if processes survive. Fleet runs execute it exactly once
(orchestrator), never per-branch.

**Never use `pkill -f "mainframe"` unfiltered** — it can hit the production app. The commands above specifically target `run dev` processes and skip anything on port 31415.

Each target's own **Launch** bullet above is authoritative (`launch-test-tauri.sh`
or `launch-test-browser.sh`, run EXACTLY ONCE) — because it already does a full
install + build, the dispatching `prepare-worktree` subagent does **not** need
a separate build step for this project.

## Wait for Ready

The launch scripts own the readiness wait — a caller never re-implements it.
Declarative facts the engines need after `READY`:

- Daemon HTTP: `http://127.0.0.1:$DAEMON_PORT/api/projects` responds.
- Tauri: Vite at `http://localhost:$VITE_PORT` (`localhost`, not
  `127.0.0.1`), app present in the bridge's `list_devices`.

## Test Engines

| Engine | Best for |
|---|---|
| `playwright-cli` (default, browser target) | Interactive step-by-step verification |
| `playwright-test` (browser target) | Repeatable test suites |
| `tauri-mcp` (tauri target) | See Target: tauri above |

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
  `docs/adapters/claude/PROTOCOL_REVERSED.md` or `packages/core`'s own test
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
script: .agents/stop-test.sh [port ...]
```

Port-scoped, parallel-safe teardown of one run — defaults to this checkout's
`.env` ports (plus port `9222`, a harmless no-op check now that nothing binds
it); pass explicit ports to override. Refuses the protected port 31415;
exits nonzero if a port stays held. Always kills the full port set for
exactly this run — never kill a single port and expect the rest of the run
to keep working.

**Tauri caveat:** killing `$DAEMON_PORT` also takes the parent `app-tauri`
process (shared socket). At teardown that is intended; never use this
mid-run hoping for a daemon-only restart — relaunch the app properly
instead.

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
