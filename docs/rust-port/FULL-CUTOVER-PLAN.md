# Rust Daemon — Full Cutover Plan

Retire the Node daemon, the in-app Node sidecar, and the Electron shell. After this
plan the Release pipeline builds **two artifacts only**, both lean native binaries:

1. **Tauri desktop app** running the Rust `mainframe-daemon` (macOS-arm64).
2. **Standalone `mainframe-daemon`** tarball (macos-arm64, linux-x64, linux-arm64).

This executes the go/no-go flip described in [`CUTOVER.md`](CUTOVER.md) and extends it
from "Tauri shell only, default unchanged" to "the Rust daemon is the only daemon we
ship." Electron, the Node sidecar (`daemon.cjs`), and the Node standalone tarball are
deleted.

- **Branch:** `feat/e2e` (planning + the e2e auto-publish gate); implementation lands in follow-up PRs.
- **Confirmed:** 2026-07-23, via four scoping rounds with the user.

---

## 1. Why this is possible now

The Rust daemon (`packages/core-rs` → `mainframe-daemon`) is at parity: **84 routes,
0 unexplained divergences**, Tauri canary boots it 10/10 (see `CUTOVER.md` §1). It has
been the default in the e2e suite since the daemon swap on this branch. Three of the
five documented route deviations and the one remaining gap all trace back to the two
runtime dependencies this plan removes.

**The Node runtime existed only to host the JavaScript LSP servers.** Everything else is
already native:

| Concern | Today | After cutover |
|---|---|---|
| Database | `rusqlite` (`bundled` — SQLite compiled in) | unchanged |
| TLS / HTTP | `reqwest` on `rustls` (no OpenSSL) | unchanged |
| PTY / terminal | Tauri shell (`app-tauri/src-tauri`), not the daemon | unchanged |
| Code search | shells to `rg` (`@vscode/ripgrep`) | **pure Rust** (`ignore` + `grep-*`) |
| LSP (ts / python) | bundled Node + `node_modules` LSP servers | **bring-your-own**, discovered from the environment |

Drop bundled search and bundled LSP and the daemon becomes a true single native binary —
no Node, no `rg`, no `node_modules` staged next to it.

---

## 2. Confirmed decisions

1. **Full cutover now.** Flip the Tauri default from the Node sidecar to the Rust daemon
   and delete the Node/Electron build paths in the same effort. End users get the Rust
   daemon.
2. **Matrix unchanged.** Tauri app stays macOS-arm64 only (Linux/Windows remain disabled
   — signing key / pnpm-PATH constraints, out of scope). Standalone Rust daemon builds on
   three native runners (macos-arm64, linux-x64, linux-arm64) — native `cargo build
   --release`, no cross-compile. No system-library blockers (rusqlite bundled, rustls);
   the runners only need a C toolchain (already present) plus a rust-toolchain step.
3. **Search → pure Rust.** Reimplement the search layer on the `ignore` +
   `grep-searcher` + `grep-regex` crates (the libraries ripgrep itself is built from). No
   feature loss; drops `@vscode/ripgrep` from every artifact.
4. **LSP → bring-your-own, no install prompt.** Drop bundled Node + the LSP
   `node_modules`. TypeScript / Python language servers resolve from the developer's
   environment the way `jdtls` already does. Editors without a discoverable server get no
   in-editor intelligence — accepted ("let's see if it works").

---

## 3. Workstreams

Ordered so each lands independently behind the still-Node-default app, and the risky
default flip (W3) comes only after search and LSP are proven native. W1–W2 are pure
`core-rs` work; W3–W4 are the app; W5 is the standalone; W6 is release + deletions.

### W1 — Pure-Rust search

Replace the `rg` shell-out with an in-process searcher.

- Rewrite `packages/core-rs/crates/mainframe-server/src/ripgrep.rs` on `ignore`
  (gitignore-aware parallel walk) + `grep-searcher` + `grep-regex`, preserving the
  current result shape (path, line, column, match text, context) so callers are
  untouched.
- **Consumers to keep green** (7): server `ripgrep.rs` / `lib.rs` / `fs_utils.rs`; routes
  `search` / `files` / `suggestions`; `suggestions/build_suggestions.rs`.
- Delete `rg_path()` and the `MAINFRAME_RG_PATH` env contract. Remove the
  `Install ripgrep` step from `e2e-mock.yml` and drop `@vscode/ripgrep` from packaging.
- **Tests:** port/extend the existing search route tests; add a crate unit test that
  greps a fixture tree and asserts gitignore semantics + context lines. `sessions-draft`
  and `find-in-path` e2e specs are the integration guard.

**Exit:** `cargo test` green, e2e search/suggestions specs green with no `rg` on PATH.

### W2 — Bring-your-own LSP discovery

Make TypeScript / Python servers resolve from the environment; delete the bundled path.

- `packages/core-rs/crates/mainframe-lsp/src/lsp_registry.rs`: remove `with_bundled` /
  `node_exec` / `bundled_root`. For `ts` / `python`, resolve like `jdtls` does today —
  probe the resolved login-shell `PATH` via `command -v`, **plus** project-local
  `node_modules/.bin/` and Python venv (`.venv/bin`, `VIRTUAL_ENV`) so a project that
  installs its own server is discovered. Return "not available" cleanly when nothing
  resolves (no install prompt).
- `lsp-languages` route: `installed` becomes purely environment-derived — this closes the
  documented `bundled_root` TODO / deviation in `CUTOVER.md` §1.
- **Regression acknowledged:** most developers don't have `typescript-language-server` /
  `pyright-langserver` on `PATH` (VS Code ships its own tsserver; pyright is used via
  Pylance / pip). Document in `CUTOVER.md` that in-editor intelligence is best-effort and
  requires a discoverable server. UI already wires this via
  `packages/ui/src/features/editor/use-lsp-document.ts`.
- **Tests:** unit-test the discovery order (PATH → project bin → venv → none); the
  `context-panel` / editor e2e specs must stay green (they don't assert a live server).

**Exit:** daemon starts and serves `lsp-languages` with no bundled Node; a project with a
locally-installed server is discovered.

### W3 — Flip the Tauri default to Rust

- `packages/app-tauri/src-tauri/src/daemon_impl.rs`: `read_persisted_impl(settings)
  .unwrap_or(DaemonImpl::Node)` → `.unwrap_or(DaemonImpl::Rust)` (line ~59). Flip the
  `defaults_to_node_when_unset` test to `defaults_to_rust_when_unset` and fix the doc
  comments (lines 3 / 9).
- Keep `MAINFRAME_DAEMON_IMPL` as an escape hatch (`node` still selectable) for one
  release, so a regression can be pinned back without a rebuild. Remove it in a later
  cleanup once the Rust daemon has soaked in production.

**Exit:** a fresh install with no persisted setting boots the Rust daemon; the canary
checks in `CUTOVER.md` §1 pass against the default (not the overlay).

### W4 — Tauri packaging: stop bundling Node / rg / LSP

- `packages/app-tauri/src-tauri/src/sidecar.rs`: delete the `DaemonProgram::Node` arm
  (~150–160) and the `MAINFRAME_BUNDLED_NODE` / `MAINFRAME_BUNDLED_LSP_ROOT` env wiring
  (~161–176). `find_bundled_rust_daemon` (~267–306) becomes the only path.
- Provisioning scripts: delete `provision-node.mjs` and `bundle-daemon.mjs`; keep
  `provision-rust-daemon.mjs`. Fold the Rust externalBin + updater artifacts from
  `tauri.rust-canary.conf.json` into the base `tauri.conf.json` and delete the canary
  overlay + the `build-app-tauri-canary` release job.
- Remove `node` / `rg` / LSP `node_modules` from `externalBin` / `resources`. The only
  bundled binary is `mainframe-daemon`.

**Exit:** `cargo tauri build --debug` produces an app with no `node`, `rg`, or LSP
`node_modules` in the bundle; it boots and reaches Connected.

### W5 — Standalone Rust daemon + CLI/update

The standalone distributable is more than the daemon binary — decide the CLI shape here.

- Rewrite `scripts/build-standalone.sh`: build `mainframe-daemon` via `cargo build
  --release` per platform and tar it as `mainframe-daemon-<os>-<arch>.tar.gz`. **Remove
  the `node packages/app-electron/scripts/bundle-daemon.mjs` call (line ~22)** — it breaks
  the moment Electron is deleted.
- Decide the `mainframe` CLI: today it's a Node CLI (`packages/core/src/cli`) that the
  launch wrapper `exec`s. Options — (a) keep a thin `mainframe` shell wrapper that execs
  the Rust binary; (b) add a CLI subcommand surface to the Rust binary itself
  (`mainframe-daemon <cmd>`). **Recommend (a)** for this pass: smallest change, keeps
  `install.sh` / `update.ts` semantics, defers a Rust CLI to later.
- Update consumers: `scripts/install.sh` (curl + untar layout) and
  `packages/core/src/cli/update.ts` (`standaloneArtifactName`, `resolveInstallRoot`,
  `runUpdate`) for the new tarball name/layout. If `packages/core` is deleted with the
  Node daemon, `mainframe update` must move into the wrapper or the Rust binary — resolve
  alongside the CLI-shape decision.
- **Open sub-decision (flag for the user at W5 kickoff):** is the standalone in scope for
  this cutover, or staged after the Tauri flip ships? The Tauri app (W3–W4) is the
  higher-value, self-contained deliverable; the standalone can follow.

**Exit:** `build-standalone.sh` produces a working tarball with no Node/Electron
dependency; `install.sh` installs it; `mainframe update` self-updates to it.

### W6 — Release pipeline + Electron deletion

- `.github/workflows/release.yml`: delete `build-desktop` (Electron) and
  `build-app-tauri-canary`. `build-daemon` builds the **Rust** daemon (add rust-toolchain
  + `Swatinem/rust-cache`; drop the Node build) across the three-runner matrix.
  `build-app-tauri` stays macOS-arm64. Net: two artifact producers + the existing
  `e2e` / `release` / `publish-release` gate (already wired, see §4).
- Delete the Electron package (`packages/app-electron`) and repoint the scripts that
  reference it: `build-standalone.sh` (W5), plus `setup-ports.sh`, `install-electron.mjs`,
  `generate-icons.sh` (icon sources) — audit `scripts/` for `app-electron` references.
- Delete `packages/core` (the Node daemon) once W5 no longer depends on it. Remove the
  `npm install -g node-gyp` / `node-pty` workaround from `e2e-mock.yml` (it existed only
  for app-electron).
- Update `CUTOVER.md` to "shipped": Rust is the only daemon; record the removed deviations
  (bundled-LSP `installed`, the two Node key leaks are moot once Node is gone).

**Exit:** a tag push builds exactly two artifacts, the e2e gate publishes the draft on
green, and no Node/Electron build path remains.

---

## 4. Already shipped on this branch (the gate)

The auto-publish gate this cutover's release stage depends on is **done** (this PR):

- `e2e-mock.yml` gains `workflow_call` so `release.yml` can invoke it.
- `release.yml` gains an `e2e` job (runs the mock suite in parallel with the builds; it
  compiles its own daemon + UI bundle, needs no release artifacts or secrets) and a
  `publish-release` job that flips the draft to published **only** when both the draft was
  assembled and e2e is green. A failed/cancelled e2e leaves the draft for manual publish,
  exactly as before.

This is independent of W1–W6 and ships first so the release plumbing is proven before the
artifact set changes underneath it.

---

## 5. Sequencing & risk

- **Order:** W1 → W2 (prove native search + LSP behind the Node default) → W3 (flip) → W4
  (strip the bundle) → W5 (standalone) → W6 (release + delete). W1/W2 are safe to land
  early; W3 is the only user-visible behavior change and is guarded by the canary checks
  and the `MAINFRAME_DAEMON_IMPL` escape hatch.
- **Search parity risk:** the pure-Rust searcher must match `rg`'s gitignore + context
  semantics; the `find-in-path` / `sessions-draft` specs are the arbiter, plus a crate
  unit test on a fixture tree.
- **LSP regression is intentional** but must fail *soft* — no crash, clean "not available"
  when nothing resolves.
- **Electron deletion is broad:** `build-standalone.sh:22` and three other `scripts/`
  references break the moment `app-electron` is removed; repoint them in the same PR (W5
  first, W6 for the rest).
- **Escape hatch:** keep `MAINFRAME_DAEMON_IMPL=node` selectable for one release so a Rust
  regression is pinnable without a rebuild; remove it in a later cleanup.
