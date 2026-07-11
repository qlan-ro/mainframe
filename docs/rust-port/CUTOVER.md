# Rust Daemon — Cutover Checklist & Operational Runbook

Go/no-go gate and runbook for flipping the **Tauri** desktop shell from the bundled
Node daemon to the ported Rust `mainframe-daemon`. Electron is out of scope: the
Electron shell keeps the Node daemon untouched and is not part of this cutover.

- **Branch:** `feat/daemon-rust-port`
- **Scope:** Tauri shell only (`packages/app-tauri`), Rust daemon (`packages/core-rs`).
- **Default is unchanged:** the Node sidecar remains the default until an explicit flip.
- **Last verified:** 2026-07-11, macOS `aarch64-apple-darwin`.

---

## 1. Current state (phases 0–5)

| Metric | Value | Source |
|---|---|---|
| Rust workspace tests | **1,303 passed / 0 failed** (64 test binaries) | `cargo test --workspace`, verified 2026-07-11 on this branch |
| HTTP route diff parity | **84 routes** compared: 76 IDENTICAL, 5 DEVIATION (understood), 3 EXPECTED(gap), **0 unexplained (DIVERGENT)** | `DIFF-REPORT-phase5.md` |
| Live soak (real claude CLI) | 3 scenarios; **no new Rust-side structural divergence**; residual deltas explained | `SOAK-REPORT-phase4.md` |
| Tauri canary | Shell boots the Rust daemon; **10/10** daemon checks (shell-spawned) + **10/10** (isolated PATH-enrichment daemon) | `CANARY-REPORT.md` |

### Diff parity (Phase-5, 84 routes)

Byte-equal after normalizing timestamps / ids / durations / paths / SHAs. The 5
DEVIATIONs are understood and documented (they are Node **leaks** the canonical types
do not declare, so the Rust port deliberately does not reproduce them):

- `chats-list` / `chats-for-project` / `chat-get` — Node leaks a raw snake_case
  `adaptive_thinking` key alongside canonical `adaptiveThinking` (leaky `...row` spread).
- `chat-context` — Node leaks `materializedPath` (host-local absolute FS path) per
  attachment; canonical `SessionAttachment` does not declare it.
- `lsp-languages` — `installed` is host-dependent: Node resolves bundled TS/Python via
  `require.resolve` in dev `node_modules`; Rust's `bundled_root` was an explicit
  `TODO(port)` at report time. On a host without those packages Node also reports
  `false` → IDENTICAL. (See §3 gap "bundled LSP".)

The 3 EXPECTED(gap) are the deliberately-unported workflow routes (§3).

### Live soak (Phase-4/5, real claude CLI `2.1.206`)

Event-type structure and normalized payload fields match Node; the only reproducible
structural difference is the codex connect-replay: Node opens each stream with **two**
`adapter.models.updated` (claude + codex), Rust with **one** (codex stays
`catalogSource: fallback / 0 models` in this environment — tracked as the codex catalog
bug, §3). That accounts for the `-1` event-length delta on `tool-permission` (27→26) and
`interrupt` (17→16); their bodies otherwise align event-for-event. `parity-text` read
`21 → 22` (Rust +1) from live-LLM prose chunking, **not** a defect — assistant-text parity
(`PARITY_OK`) held. Three adversarial-review findings (connect-replay, title-update
ordering) were fixed and re-verified.

### Canary (Task 6.3)

The Tauri dev shell selected `daemon_impl="rust"`, spawned the release binary, bound a temp
data dir, and rendered the UI wired to the Rust daemon (renderer `get_daemon_port` → 31600,
renderer `GET /api/projects` returned the canary project). A real `claude` turn completed to
`OK` / `processState=idle` over the full WS pipeline. Both Phase-5 OPEN GAPS were closed or
accounted (§ below).

---

## 2. Flag mechanics (`MAINFRAME_DAEMON_IMPL`)

The Tauri shell chooses which daemon to spawn at boot. Resolution lives in
`packages/app-tauri/src-tauri/src/daemon_impl.rs`.

### Precedence (highest first)

1. **Env `MAINFRAME_DAEMON_IMPL`** — `rust` | `node`, case-insensitive and trimmed.
   An unrecognized value is logged (`warn`) and ignored, falling through to (2)/(3).
2. **Persisted setting** — key `daemonImpl` in `<data_dir>/app-settings.json`
   (`data_dir` = `MAINFRAME_DATA_DIR` or `~/.mainframe`). Lets the UI flip the canary
   across restarts.
3. **Default: `node`.** The Node sidecar is the always-working path.

The daemon is spawned **once at boot**, so any flip (env or persisted) takes effect on the
**next app launch**, not live.

### How to flip

- **Per developer (one run):** set the env before launching.
  ```bash
  MAINFRAME_DAEMON_IMPL=rust pnpm tauri:dev      # from packages/app-tauri
  ```
  Dev also needs the binary located — either build it into
  `packages/core-rs/target/release/mainframe-daemon` (auto-discovered) or point at it:
  ```bash
  MAINFRAME_RUST_DAEMON_PATH=/abs/path/to/mainframe-daemon MAINFRAME_DAEMON_IMPL=rust pnpm tauri:dev
  ```
- **Per user, persistent:** the renderer calls the `daemon_impl_set("rust")` Tauri command
  (persists `daemonImpl` to `app-settings.json`, preserving other keys); `daemon_impl_get`
  reads the effective value. Restart the app to apply.
- **CI:** export `MAINFRAME_DAEMON_IMPL=rust` (plus `MAINFRAME_RUST_DAEMON_PATH` if the
  binary is not on the monorepo default path) in the job env. Note: the `packages/e2e`
  Tauri harness does **not** yet thread these vars into `fixtures/daemon.ts` — it hard-spawns
  `node …/core/dist/index.js`. Running the existing E2E suite against the Rust daemon needs a
  harness change first (see §3 / §6).
- **External daemon (dev):** `MAINFRAME_EXTERNAL_DAEMON=1` skips spawning entirely; the
  renderer connects to whatever daemon is already listening on `daemon_port()`.

### Rollback

Flip back to `node` — unset `MAINFRAME_DAEMON_IMPL` (or call `daemon_impl_set("node")`) and
relaunch. No data migration is involved.

### Data compatibility (both directions)

Both daemons share the **same SQLite migration chain** and target the same
`PRAGMA user_version` (`LATEST_VERSION = 24`, identical between the TS `migrations.ts` and
the Rust `migrations.rs`). `run_migrations` applies only migrations `> current user_version`
and stamps `user_version` after each, so switching node↔rust at v24 is a no-op in either
direction — the DB is left untouched.

**Caveat — no down-migration.** SQLite `user_version` is monotonic and there is **no**
down-migration path. Forward/back compatibility holds **only while both impls share the same
`LATEST_VERSION`**. If a future Rust build ships migration 25 and a user then rolls back to a
Node build still at 24:
- The Node daemon opens the v25 DB without downgrading (it only *adds* migrations), but any
  column/table added by migration 25 is invisible to it and writes may violate the older
  schema's assumptions.
- **Rule:** never ship a schema migration on one impl without landing the identical migration
  on the other **before** allowing rollback across that boundary. Keep the two migration
  chains lock-step; a migration is a coordinated change, not a per-impl change.

---

## 3. Known gaps register at cutover

Each gap = impact + tracking pointer. None blocks the Node default; each is a reason a given
user/workflow should stay on Node until closed.

| Gap | Impact on Rust impl | Tracking pointer |
|---|---|---|
| **Workflows engine (deferred)** | `/api/workflows`, `/api/workflow-connectors`, `/api/workflow-credentials` return **404** (routes unmounted). Any workflow feature is unavailable on the Rust daemon. | Deliberate scope decision 2026-07-10: the TS workflows implementation is unstable; porting an unstable surface would bake in churn. Node retains it. `DIFF-REPORT-phase5.md` EXPECTED(gap). |
| **External-sessions routes** | The Adapter-trait external-session scan method is unported; external `/resume` session discovery is absent on Rust. | Accepted Phase-5 gap. Adapter-trait method, follow-up port. |
| **Trust-workspace** | `trust_store` is a **skeleton** only; workspace-trust gating is not enforced by the Rust daemon. | Accepted Phase-5 gap. |
| **`GET /api/projects/:id/suggestions`** | Route **unmounted** on Rust (Node serves churn + TODO-scan suggestions). The suggestions panel is empty on the Rust impl. | Genuine non-workflows functional gap, `routes/mod.rs`; distinct from the workflow gap. `DIFF-REPORT-phase5.md` "Skipped". |
| **User-plugin `loadAll` (on-disk discovery)** | **Builtin-only** in v1 (`claude`, `codex`, `todos`). User-authored on-disk plugins are not discovered/loaded. | Accepted Phase-5 gap; see release note §4. |
| **Message attachments dropped** | `message.send` with `attachmentIds` reaches the mounted attachments route, but `process_attachments` (`chat_manager.rs`) only warns and returns default — the text is delivered, the attachments are silently dropped. | `attachment-processor.ts` unported (`chat_deps.rs` seam + `attachment_processor.rs` skeleton). Attachment users stay on Node. |
| **Resumed chats not re-scanned** | On chat load/resume (`lifecycle_manager.rs`) `scan_loaded_history` is a **no-op**, so PR-URL detection, @-mention extraction, and plan/skill-file extraction are absent on the Rust arm. | `pr-detection.ts` re-scan unported — the seam receives only the `chatId`, not the live session handle (`chat_deps.rs`). Follow-up port. |
| **Codex fallback catalog (#226)** | Codex stays `catalogSource: fallback / 0 models` even when `codex` is installed — `CodexAdapter::list_models` (temp app-server + `model/list`) yields no live catalog in the tested env, so codex is never `probed` and is excluded from connect-replay. Codex model list is empty on Rust. | Pre-existing codex-adapter probe matter, tracked as **#226**. Independent of the connect-replay wiring (which faithfully replays exactly the probed adapters). |
| **Bundled LSP spawn (packaged only)** | `MAINFRAME_BUNDLED_NODE` / `MAINFRAME_BUNDLED_LSP_ROOT` wiring is in place (`sidecar.rs` injects them on the Rust arm in **release** builds), but the bundled TS/Python LSP spawn is only exercisable from a **packaged** build and was **not** verified in the dev canary (both env vars are `None` from source → only external servers like `jdtls` spawn). | OPEN GAP 2 (Phase-5), flagged for the packaging pass. `CANARY-REPORT.md` §4. |

No canary failures: the DEV canary and isolated-PATH daemon both ran 10/10.

---

## 4. Release-note items

User-facing behavior changes when a build ships the Rust daemon as default:

- **Plugin system is builtin-only.** Only the built-in `claude`, `codex`, and `todos`
  plugins load. User-authored on-disk plugins are not discovered on the Rust daemon
  (`loadAll` is unported in v1). Users relying on custom plugins must stay on the Node build.
- **Workflows are unavailable on the Rust daemon.** The workflow builder, connectors, and
  credentials surfaces are disabled (routes return 404). Workflow users must stay on the Node
  build until the engine is ported.
- **Codex model catalog may be empty** until #226 lands (codex adapter still spawns/runs;
  only its advertised model list is affected).
- **Message attachments are dropped on the Rust daemon.** The attachment processor is
  unported; sending a message with attachments delivers the text but discards the
  attachments. Attachment users must stay on the Node build.
- **Resumed chats skip re-scanning on the Rust daemon.** Reopening a chat does not re-run
  PR-URL detection, @-mention extraction, or plan/skill-file extraction (the post-load scan
  is unported). PR links and mentions surfaced only on resume are absent; new activity in a
  live session is unaffected.

---

## 5. Platform matrix

| Platform | Status | What's needed |
|---|---|---|
| **macOS arm64** (`aarch64-apple-darwin`) | **Verified** — canary + soak + 84-route diff on this host | — |
| macOS x64 (`x86_64-apple-darwin`) | **TODO** | Build `mainframe-daemon` for the triple; stage as `binaries/mainframe-daemon-x86_64-apple-darwin` (Tauri `externalBin` requires the triple-suffixed name). Codesign the Mach-O. Re-run the canary matrix on an Intel host. |
| Windows x64 (`x86_64-pc-windows-msvc`) | **TODO — platform-sensitive** | Signal semantics are **unix-only**: process teardown shells out to `kill` — launch stop uses `kill -<SIG> -<pid>` (process-group SIGTERM→5s→SIGKILL, `launch_manager.rs`) and LSP shutdown uses `kill -TERM <pid>` (`lsp_manager.rs::send_sigterm`). **Windows has no `kill`** — both are flagged platform-sensitive for the Windows packaging pass and need a Windows teardown path (e.g. `taskkill` / job objects) before Windows is viable. |
| Linux x64 (`x86_64-unknown-linux-gnu`) | **TODO** | Build + stage the triple binary; the unix `kill` teardown paths already apply. Re-run the canary matrix. |

Cross-cutting for every non-arm64 target: `tauri.conf.json` `externalBin` entries resolve to
**target-triple-suffixed** binaries next to the app exe; each CI runner must build/stage its
own `mainframe-daemon-<triple>` (and, until §6 cleanup, its own Node sidecar + per-platform
native `node_modules`).

---

## 6. Cutover steps & post-cutover cleanup

### Ordered cutover steps (with verification)

1. **Build + stage the Rust daemon** for the release triple.
   ```bash
   ( cd packages/core-rs && cargo build --release -p mainframe-daemon )
   ( cd packages/app-tauri && node scripts/provision-rust-daemon.mjs --no-build )
   ```
   Verify: `src-tauri/binaries/mainframe-daemon-<triple>` exists and `--version` prints.

2. **Gate the Rust workspace green.**
   ```bash
   ( cd packages/core-rs && cargo test --workspace )   # 1,303 pass / 0 fail
   ( cd packages/core-rs && ./tools/verify-gate.sh )   # clippy + fmt + gate clean
   ```

3. **Confirm wire parity** is unchanged for the shipping tree.
   ```bash
   ( cd packages/core-rs && node tools/diffd/diffd.mjs )   # 0 DIVERGENT
   ( cd packages/core-rs && node tools/diffd/soak.mjs )    # no new Rust divergence
   ```

4. **Canary the packaged/dev shell** on the Rust arm (fresh temp data dir, non-default port).
   ```bash
   MAINFRAME_DAEMON_IMPL=rust \
   MAINFRAME_RUST_DAEMON_PATH="$PWD/packages/core-rs/target/release/mainframe-daemon" \
   DAEMON_PORT=31600 MAINFRAME_DATA_DIR="$(mktemp -d)" VITE_PORT=5199 \
   node packages/app-tauri/scripts/tauri-dev.mjs
   ```
   Verify: host log shows `daemon_impl="rust"` + `daemon sidecar started`;
   `GET http://127.0.0.1:31600/health` → `{"status":"ok",…}`; UI renders and lists projects.

5. **Verify bundled LSP in a real packaged build** (closes OPEN GAP 2, currently unverified —
   §3). Build the app, launch it, open a TS/Python file, confirm the bundled LSP server spawns
   (host log shows non-`None` `bundled_node` / `bundled_lsp_root`).

6. **Flip the default.** Change the resolution default in `daemon_impl.rs` (or ship a build
   that persists `daemonImpl: "rust"`) **only after** steps 2–5 pass and the §3 gaps are
   acceptable for the target audience. Until then, keep `node` the default and roll out via the
   per-user/env flag.

**Rollback at any point:** flip back to `node` (§2). No data changes to undo (§2 caveat).

### Post-cutover cleanup (pointers only — do after Node is fully retired for Tauri)

Once the Rust daemon is the permanent default and Node is removed from the Tauri shell, delete
the Node-sidecar bundling machinery (Electron is unaffected — it keeps its own Node daemon):

- **Node bundling scripts:** `packages/app-tauri/scripts/bundle-daemon.mjs` (the esbuild
  `daemon.cjs` single-file build + Mach-O codesign), `packages/app-tauri/scripts/provision-node.mjs`,
  `packages/app-tauri/scripts/codesign-daemon.mjs`, and the shared dep-collector
  `scripts/collect-daemon-deps.mjs` (repo root).
- **package.json:** drop the `bundle:daemon` / `provision:node` scripts (and the `node`
  legs of the `bundle` chain), and the `esbuild` devDependency
  (`packages/app-tauri/package.json`).
- **tauri.conf.json:** remove `"binaries/node"` from `externalBin` and the
  `"resources/daemon": "daemon"` resource mapping (the bundled `daemon.cjs` + `node_modules`).
- **Rust shell:** remove the Node arm — `boot_node_daemon` and the
  `DaemonProgram::Node` variant (`lib.rs`, `sidecar.rs`), `find_bundled_node` /
  `find_node`, and the `daemon.cjs` bundled-resource resolution (`lib.rs` ~L445–460).
  Then `MAINFRAME_DAEMON_IMPL` / `daemon_impl.rs` can collapse to a single impl.

Do **not** touch `packages/app-electron`, `packages/core` TS source, `pnpm-lock.yaml`, or
`packages/mobile` as part of this cleanup.
</content>
</invoke>
