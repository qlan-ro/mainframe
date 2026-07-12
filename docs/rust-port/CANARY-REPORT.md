# Rust Daemon — Tauri Canary Report (Task 6.3)

Verifies the Tauri desktop shell running against the ported **Rust** `mainframe-daemon`
(the `MAINFRAME_DAEMON_IMPL=rust` canary), end to end. The Node sidecar remains the
default; nothing here changes that.

- **Date:** 2026-07-11
- **Branch:** `feat/daemon-rust-port`
- **Host:** macOS (darwin 25.4), `aarch64-apple-darwin`
- **Daemon:** `mainframe-daemon` release build, `version = 0.0.0`, 20.6 MB
- **Result:** PASS — Tauri shell boots the Rust daemon; 10/10 daemon-level checks on the
  shell-spawned daemon; 10/10 on an isolated PATH-enrichment daemon; both OPEN GAPS closed
  or accounted for; the accepted gaps are unchanged.

---

## 1. Build & stage (task 6.1 wiring)

| Step | Command | Result |
|---|---|---|
| Build release binary | `cargo build --release -p mainframe-daemon` (in `packages/core-rs`) | PASS — exit 0, `target/release/mainframe-daemon` (20,575,808 bytes) |
| `--version` sanity | `./target/release/mainframe-daemon --version` | PASS — `mainframe 0.0.0` |
| Stage for `externalBin` | `node scripts/provision-rust-daemon.mjs --no-build` (in `packages/app-tauri`) | PASS — copied to `src-tauri/binaries/mainframe-daemon-aarch64-apple-darwin` (matches the target triple Tauri expects) |

`tauri.conf.json` already lists `binaries/mainframe-daemon` in `bundle.externalBin`, so a
packaged build will place the triple binary next to the app exe where
`sidecar::find_bundled_rust_daemon` looks for it.

---

## 2. DEV canary — Tauri shell boots the Rust daemon

Launched the full dev stack (vite + Tauri shell) with the canary on a non-default port and
a fresh temp data dir:

```
MAINFRAME_DAEMON_IMPL=rust
MAINFRAME_RUST_DAEMON_PATH=<repo>/packages/core-rs/target/release/mainframe-daemon
DAEMON_PORT=31600
MAINFRAME_DATA_DIR=<temp>/data-tauri
VITE_PORT=5199
  → node packages/app-tauri/scripts/tauri-dev.mjs   (cargo tauri dev --features mcp-bridge)
```

Shell debug compile finished in 48.5 s, then the host log showed the canary resolving and
spawning the Rust binary:

```
app_tauri_lib: selected daemon implementation daemon_impl="rust"
app_tauri_lib: rust daemon resolved (env override) path=…/target/release/mainframe-daemon
app_tauri_lib: booting rust daemon sidecar … port=31600 bundled_node=None bundled_lsp_root=None
app_tauri_lib::sidecar: spawning daemon sidecar … path=<full login-shell PATH, 92 keys>
app_tauri_lib::sidecar: daemon sidecar started pid=41692
```

- `/health` on `31600` returned `{"status":"ok","version":"0.0.0",…}`.
- The spawned process (`pid 41692`) is the `mainframe-daemon` release binary.
- It bound the temp data dir (created `mainframe.db`, `plugins/`, `logs/`).
- **UI window rendered and is wired to the Rust daemon:** the renderer's own
  `get_daemon_port` invoke returned `31600`, and a renderer-side `GET /api/projects`
  returned the `canary` project the Rust daemon had just created. Screenshot:
  `/tmp/mf-canary/tauri-rust-daemon-ui.png` (Mainframe window, sessions sidebar populated).

---

## 3. Daemon-level checks over HTTP/WS (against `31600`, the shell-spawned Rust daemon)

All ten checks PASS. A trivial temp git repo was registered as the project, and a real
`claude` CLI turn was driven to completion.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `GET /health` shape/version | PASS | `status=ok version=0.0.0`, `timestamp`+`tunnelUrl` present |
| 2 | `POST /api/projects` (temp git repo) | PASS | 200, returns project id |
| 3 | `POST /api/chats` (`adapterId=claude`) | PASS | 200, returns chat id |
| 4 | WS `connection.ready` | PASS | first frame after connect |
| 5 | WS `subscribe` → `subscribe:ack` | PASS | ack for chat id |
| 6 | `message.send` (real claude) → result | PASS | `process.started → process.ready → assistant "OK" → chat.updated processState=idle` |
| 7 | `GET /api/lsp/languages` | PASS | 200, `languages[]` (3 catalog languages) |
| 8 | `GET /api/plugins` | PASS | 200, builtins `["codex","claude","todos"]` |
| 9 | file `PUT /api/projects/:id/files` + `subscribe:file` → `file:changed` | PASS | write broadcast a `file:changed` frame |
| 10 | launch `…/start` + `…/stop` (trivial `sleep` config) | PASS | 200/200; host log shows spawn+SIGTERM |

`message.send` sends `"Reply with exactly the two letters: OK"`; the assistant replied
`OK`. This proves the Rust daemon spawns the claude adapter, streams events, and returns a
result through the full WS pipeline while running inside the Tauri shell.

---

## 4. OPEN GAP verification

### Gap 1 — enrich_path threaded into adapter CLI spawns (**CLOSED, proven**)

The Phase-5 note flagged that the resolved login-shell PATH might not reach adapter spawns,
so a packaged app on a bare PATH would `ENOENT` on `claude`/`codex`. Verified closed with an
isolated proof: the Rust daemon was run **directly** (no Tauri shell) with the daemon
process PATH forced to `/usr/bin:/bin` — which contains **neither** `claude` (in
`~/.local/bin`) **nor** `node` (in nvm) — while leaving the rest of the env intact so claude
auth still worked:

```
PATH=/usr/bin:/bin DAEMON_PORT=31603 MAINFRAME_DATA_DIR=<temp> mainframe-daemon
```

Full 10/10 matrix on that daemon, including `message.send` → assistant reply **`OK`** →
`processState=idle`. The claude CLI (and its node runtime) could only have been found via the
daemon's own boot-time `ResolvedPath::resolve()` threading the login-shell PATH into the
adapter spawn. A separate stricter run under `env -i … PATH=/usr/bin:/bin` also spawned the
CLI successfully (it reached the model probe and a full turn, returning
`"Not logged in · Please run /login"` — an artifact of `env -i` stripping claude's
credential env, **not** a spawn/PATH failure).

Inside the Tauri shell the daemon additionally inherits the shell's captured login-shell env
(92 keys, full PATH — see §2), so real turns complete (the `OK` reply in §3).

### Gap 2 — bundled LSP server resolution (`MAINFRAME_BUNDLED_NODE` / `_LSP_ROOT`)

Wiring is in place: `sidecar.rs` injects these env vars on the Rust arm **in release builds
only**, sourced from the bundled node sidecar + `<resource_dir>/daemon/node_modules`, and
`mainframe-daemon` reads them in the LSP registry. In this DEV canary both are unset
(`bundled_node=None bundled_lsp_root=None` in the host log), which is the documented
run-from-source path: bundled TS/Python resolve to `None` and only external servers (jdtls)
are spawnable. `GET /api/lsp/languages` returns the catalog cleanly (check #7). The bundled
LSP spawn itself is only exercisable from a packaged build and is out of scope for the DEV
canary — flagged for the packaging pass.

---

## 5. E2E (task 6.3 step 4)

**The `packages/e2e` tauri harness hard-assumes the Node daemon and cannot be pointed at the
Rust daemon without editing harness code (out of this task's ownership).** Specifically:

- `fixtures/daemon.ts` → `startDaemon()` spawns `node <packages/core/dist/index.js>`
  directly; there is no `MAINFRAME_DAEMON_IMPL` / `MAINFRAME_RUST_DAEMON_PATH` knob
  (`MF_E2E_SKIP_BUILD` only skips the UI rebuild).
- `assertPortFree()` throws if any daemon is already answering on the port and only reaps a
  process whose command line is `node …/core/dist/index.js`, so a pre-started Rust daemon
  would make every spec fail fast.

Rather than modify the harness, the 5 most central tauri specs were exercised
**manually-equivalent** via the daemon-level matrix above (same daemon contract the specs
drive over HTTP/WS):

| Central spec | Manual-equivalent coverage (§3) |
|---|---|
| `chat.spec` (send → assistant reply) | check #6 — real claude turn to `OK`/idle |
| `sessions.spec` (project/chat lifecycle + connect) | checks #2, #3, #4, #5 + UI connect (§2) |
| `files-tree` / `editor` (read/write) | check #9 (PUT + `file:changed`), check #7 |
| `run-surface` / launch | check #10 (launch start/stop) |
| `tasks` (todos plugin panel) | check #8 (`todos` builtin + panel registered) |

Follow-up (separate work, not this task): add a `MAINFRAME_DAEMON_IMPL`/`RUST_DAEMON_PATH`
env pass-through to `fixtures/daemon.ts` so the existing tauri suite can run green against the
Rust daemon unchanged.

---

## 6. Accepted gaps (unchanged — not fixed here, per Phase-5 scope)

- Workflows engine deferred; `/api/workflows*` unmounted.
- External-sessions routes (Adapter-trait method) not ported.
- Trust-workspace: `trust_store` skeleton only.
- `GET /api/projects/:id/suggestions` route absent.
- User-plugin `loadAll` (on-disk discovery) omitted — builtin-only in v1.

---

## 7. Reproduce

```bash
# 1. build + stage
( cd packages/core-rs && cargo build --release -p mainframe-daemon )
( cd packages/app-tauri && node scripts/provision-rust-daemon.mjs --no-build )

# 2. dev canary (fresh temp data dir; port 31600)
DATA=$(mktemp -d)/data; mkdir -p "$DATA"
( cd packages/app-tauri && \
  MAINFRAME_DAEMON_IMPL=rust \
  MAINFRAME_RUST_DAEMON_PATH="$PWD/../core-rs/target/release/mainframe-daemon" \
  DAEMON_PORT=31600 MAINFRAME_DATA_DIR="$DATA" VITE_PORT=5199 \
  node scripts/tauri-dev.mjs )

# 3. wait for http://127.0.0.1:31600/health, then run the daemon-level matrix
#    (checks script used for this report: /tmp/mf-canary/checks.mjs)
```

Ports used: 31600 (shell-spawned), 31601–31603 (isolated direct-daemon proofs). All temp
dirs; `~/.mainframe` and ports 31415/31500 were never touched.
