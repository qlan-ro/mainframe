# Rust Daemon — Full Cutover Implementation Plan

## Goal

Make the Rust `mainframe-daemon` the only daemon Mainframe ships. Flip the Tauri
shell default from the bundled Node sidecar to the Rust binary, reimplement code
search in pure Rust (dropping `@vscode/ripgrep`), switch LSP to bring-your-own
discovery (dropping bundled Node + LSP `node_modules`), delete the Electron shell,
and rebuild the standalone distributable + release pipeline around the Rust binary.
End state: two lean native artifacts — the macOS-arm64 Tauri app (Rust daemon
inside) and standalone `mainframe-daemon` tarballs (macos-arm64, linux-x64,
linux-arm64) — with no Node, `rg`, or `node_modules` staged next to the daemon.

This executes the approved design in [`FULL-CUTOVER-PLAN.md`](FULL-CUTOVER-PLAN.md)
and the go/no-go runbook in [`CUTOVER.md`](CUTOVER.md). It is a task-level breakdown;
it does not re-litigate any decision.

- **Branch:** `feat/rust-daemon-cutover` (off latest `main`).
- **Structure:** a **stack of 6 PRs** (see rationale below). Each PR is one phase,
  independently verifiable, with its own changeset.

---

## Why a stacked PR, not one PR

The change set is too large and too sequenced for a single reviewable unit, and the
ordering is load-bearing: pure-Rust search and BYO LSP MUST prove out behind the
still-Node-default app before packaging drops the bundled Node; the standalone
rewrite MUST land before Electron is deleted (`scripts/build-standalone.sh:22`
shells out to `packages/app-electron/scripts/bundle-daemon.mjs`, which breaks the
moment Electron is removed). Each workstream in the design has a clean exit
criterion, so each maps to one PR in a stack:

| PR | Phase | Scope | Touches | Changeset |
|----|-------|-------|---------|-----------|
| 1 | Pure-Rust search | `core-rs` only | `mainframe-server` | empty (Rust-only) |
| 2 | BYO LSP discovery | `core-rs` only | `mainframe-lsp`, `mainframe-daemon` | empty (Rust-only) |
| 3 | Flip Tauri default → Rust | app-tauri Rust shell | `daemon_impl.rs` | app-tauri patch |
| 4 | Tauri packaging + retire Node arm | app-tauri shell + scripts + conf | `sidecar.rs`, `lib.rs`, `daemon_impl.rs`, scripts, `tauri.conf.json` | app-tauri minor |
| 5 | Standalone + Rust CLI | `build-standalone.sh`, Rust CLI subcommands, install/update | `core-rs`, `scripts/` | empty or core patch |
| 6 | Release pipeline + Electron deletion | CI, `packages/app-electron`, docs | `.github/`, root scripts, changeset config | app-electron major (removal) |

PRs 1–2 are safe to land early behind the Node default. PR 3 is the only
user-visible behavior change and is guarded by the CUTOVER §1 canary checks. PRs
1–4 can also be squashed into fewer PRs at the reviewer's discretion, but the
**order** must hold.

---

## Deviations from the design docs (surface to the user)

Two points where this plan follows the **user's 2026-07-24 instructions** over the
older `FULL-CUTOVER-PLAN.md`, plus one forced consequence:

1. **`packages/core` is KEPT in-tree, not deleted.** `FULL-CUTOVER-PLAN.md` §W6
   says "Delete `packages/core`." The user's instruction is to keep the Node daemon
   TS source in-tree as a library/reference. Investigation confirms it has **zero**
   TypeScript importers and exactly one `package.json` consumer (`app-electron`), so
   it becomes an orphan package after Electron is deleted — harmless. Keeping it also
   means `prepare-release.yml`'s version source (`packages/core/package.json`) still
   works untouched.
2. **`MAINFRAME_DAEMON_IMPL` is deleted (no one-release escape hatch).**
   `FULL-CUTOVER-PLAN.md` §W3/§5 recommends keeping `MAINFRAME_DAEMON_IMPL=node`
   selectable for one release. That is **impossible** once the Node arm is retired in
   the same effort (there is no Node daemon left to select). The user's instruction
   explicitly directs collapsing to a single impl and deleting the flag. This removes
   the "pin back to Node without a rebuild" rollback lever — rollback becomes
   "revert the PR / ship the prior tag." Flagged as a risk below.
3. **Standalone CLI is ported to Rust subcommands** (see PR 5 decision), because a
   truly Node-free standalone cannot exec the Node CLI in `packages/core/src/cli`.

---

## PR 1 — Pure-Rust search (`core-rs` only)

Replace the `rg` shell-out in `mainframe-server` with an in-process searcher built
on the crates ripgrep itself uses. `search_with_ripgrep` keeps its signature; the
call sites stay green except `list_files_with_ripgrep`, whose return type changes
(see T1.4 — in-process it is infallible, so its `Option` wrapper goes away). TDD:
tests first.

**Crate deps.** The `ignore` / `grep-searcher` / `grep-regex` crates are **not** yet
in the workspace (`packages/core-rs/Cargo.toml` has no entries; `mainframe-server`
uses `{ workspace = true }` deps).

### T1.1 — Add search crates to the workspace
- **Files:** `packages/core-rs/Cargo.toml` (`[workspace.dependencies]`),
  `packages/core-rs/crates/mainframe-server/Cargo.toml` (`[dependencies]`).
- **Change:** add `ignore`, `grep-searcher`, `grep-regex` (and `grep-matcher` for
  the sink) to the workspace table; reference them with `{ workspace = true }` in
  `mainframe-server`. Pin `grep-*` to versions from the **same ripgrep release** so
  regex syntax and gitignore semantics match the existing parse-test oracle
  (`parses_match_events_into_results`); a mismatched set can drift the hardcoded
  T1.2 expectations.
- **Verify:** `cd packages/core-rs && cargo fetch && cargo check -p mainframe-server`.

### T1.2 — Write the searcher unit tests FIRST (TDD, red)
- **Files:** new tests in `packages/core-rs/crates/mainframe-server/src/ripgrep.rs`
  `#[cfg(test)] mod tests` (or a `ripgrep/tests.rs` submodule if the file nears 300
  lines).
- **Change:** using `tempfile`, build a fixture tree with a `.gitignore`, a nested
  ignored dir, a binary-ish file, a UTF-8 multibyte line, and long lines. Assert,
  against **hardcoded** expected values (test-writer agent, no recomputation):
  - content search returns `{file (relative), line, column (1-based, = match
    start+1), text (trailing-newline stripped, capped at 500 chars)}` matching the
    current `SearchContentResult` shape and the existing parse tests
    (`parses_match_events_into_results`: `a.txt`, line 3, col 7, `"hello world"`).
  - gitignored paths are excluded by default and included when `include_ignored`.
  - `list_files` builtin-ignore-only mode surfaces `.gitignore`d config files but
    still excludes `IGNORED_DIRS` (parity with `--no-ignore --hidden` + glob excludes
    in `ripgrep.rs:201-215`).
  - `max_results` / per-file `--max-count 50` equivalents cap output.
- **Verify:** `cargo test -p mainframe-server ripgrep` — tests compile and FAIL
  (no impl yet).

### T1.3 — Reimplement the searcher bodies
- **Files:** `packages/core-rs/crates/mainframe-server/src/ripgrep.rs`.
- **Change:** replace `rg_path()`, `find_on_path()`, `spawn_rg()`, `run_rg()`,
  `run_rg_strict()`, and the `--json` parser (`parse_ripgrep_output`) with an
  in-process implementation:
  - `search_with_ripgrep(scope_path, query, opts)` — build a `grep-regex`
    `RegexMatcher` (case-insensitive, matching the old `--ignore-case`), walk with
    `ignore::WalkBuilder` (respecting `.gitignore` unless `include_ignored`; honor
    `--max-filesize` via `max_filesize`), run `grep_searcher::Searcher` with a sink
    that collects `SearchContentResult` (1-based `column` = match start byte +1 to
    match the current contract), cap at `max_results` and per-file count.
  - `list_files_with_ripgrep(dir_path, opts)` — `ignore::WalkBuilder` file walk;
    `use_builtin_ignore_only` disables gitignore but excludes `IGNORED_DIRS`;
    `include_ignored` disables ignores + includes hidden. Its return type changes
    from `Option<Vec<String>>` to `Vec<String>` (the old `None` came only from
    `rg_path()?`, now gone) — call site updated in T1.4.
  - Delete `is_ripgrep_available()` in T1.4 (its only caller, search.rs, is removed
    there); do not leave a `true` stub.
  - Delete `MAINFRAME_RG_PATH`, the `@vscode/ripgrep` dev path, and the
    `CARGO_MANIFEST_DIR` reference. Update the module doc comment + the trailing
    `PORT STATUS` block to describe the in-process impl.
- **Keep 300-line/50-fn limits:** split the sink/walk helpers into a
  `ripgrep/` submodule if needed.
- **Verify:** `cargo test -p mainframe-server ripgrep` green.

### T1.4 — Remove the now-dead fallback branches; delete `is_ripgrep_available`
- **Files:** `packages/core-rs/crates/mainframe-server/src/routes/search.rs`
  (~L205 `if !rg_results.is_empty() || is_ripgrep_available()` and
  `search_directory_fallback` + its walker),
  `packages/core-rs/crates/mainframe-server/src/routes/files.rs` (~L214 `None`
  branch + `search_walk`), `ripgrep.rs` (`is_ripgrep_available`).
- **Change:** in-process search never reports "unavailable," so:
  - search.rs: simplify L205 to an unconditional call, delete
    `search_directory_fallback` + its walker, and remove the `is_ripgrep_available`
    import.
  - files.rs: `list_files_with_ripgrep` now returns `Vec<String>` (T1.3), so drop the
    `None` → `search_walk` branch and delete `search_walk`; adjust L214's binding.
  - ripgrep.rs: delete `is_ripgrep_available` entirely (search.rs was its only
    caller) — no-leftovers rule.
  - `suggestions.rs` (uses `search_with_ripgrep` at L82) needs no change.
- **Verify:** `cargo test -p mainframe-server routes::search routes::files
  routes::suggestions`; `cargo clippy -p mainframe-server` clean (no dead-code
  warnings); grep confirms `is_ripgrep_available` and `search_walk` are gone.

### T1.5 — Drop the ripgrep install steps from Rust CI gates
- **Files:** `.github/workflows/rust-port.yml` (~L29-30 "Install ripgrep"),
  `.github/workflows/e2e-mock.yml` (~L53-54 "Install ripgrep").
- **Change:** delete both steps. (The release-canary "Install ripgrep" at
  `release.yml` ~L342 is removed in PR 4/6 with that job.)
- **Verify:** workflow YAML lints; the search/suggestions route tests do not shell
  out.

### T1.6 — Gate + changeset
- **Verify:** `cd packages/core-rs && cargo test --workspace && ./tools/verify-gate.sh`
  (clippy + fmt + gate clean). Run the e2e `find-in-path` and `sessions-draft` specs
  as the integration guard with no `rg` on `PATH`
  (`cd packages/e2e && pnpm build:app:tauri && <run those specs>`).
- **Changeset:** `pnpm changeset --empty` (Rust-only; no JS package version change).

**Exit:** `cargo test` green; search/suggestions e2e specs green with no `rg` on PATH.

---

## PR 2 — Bring-your-own LSP discovery (`core-rs` only)

Resolve TypeScript / Python servers from the environment (like `jdtls`), including
project-local `node_modules/.bin` and Python venvs; delete the bundled Node path.
Fail soft when nothing resolves. TDD: tests first.

### T2.1 — Thread the project root into command resolution
- **Files:** `packages/core-rs/crates/mainframe-lsp/src/lsp_manager.rs` (trait
  `CommandResolver` ~L39-53; `do_spawn` call site ~L258-262 where `project_path` is
  already in scope), `packages/core-rs/crates/mainframe-lsp/src/lsp_manager/tests.rs`
  (fake resolver ~L37).
- **Change:** extend the trait to `resolve_command(&self, language, project_path)`
  and pass `project_path` at the `do_spawn` call. Update the fake resolver in tests.
- **Verify:** `cargo check -p mainframe-lsp`.

### T2.2 — Discovery unit tests FIRST (TDD, red)
- **Files:** `packages/core-rs/crates/mainframe-lsp/src/lsp_registry/tests.rs`.
- **Change:** replace the `with_bundled` tests (~L76, L86, L99) with discovery-order
  tests using `tempfile` + a scoped `PATH`/`VIRTUAL_ENV`. Assert hardcoded outcomes:
  - project-local `node_modules/.bin/typescript-language-server` wins over `PATH`.
  - `pyright-langserver` resolves from `.venv/bin` and from `$VIRTUAL_ENV/bin`.
  - falls back to `command -v` on the resolved `PATH`.
  - returns `None` cleanly when nothing resolves (no panic, no error surfaced).
- **Verify:** `cargo test -p mainframe-lsp lsp_registry` — FAILS (no impl).

### T2.3 — Reimplement `resolve_command`; delete the bundled path
- **Files:** `packages/core-rs/crates/mainframe-lsp/src/lsp_registry.rs`.
- **Change:**
  - Remove `with_bundled`, `node_exec`, `bundled_root`, `resolve_bundled_bin_path`,
    `bundled_bin_entry`, and `RegistryError::PackagingUnconfigured` (leave
    `RegistryError` only if still used; otherwise delete the enum).
  - For every language (ts, python, java uniformly), resolve by: project-local
    `{project_path}/node_modules/.bin/<cmd>`, then Python venv
    (`{project_path}/.venv/bin/<cmd>`, `$VIRTUAL_ENV/bin/<cmd>`), then `command -v`
    on `resolved_path`. Return `None` when unresolved. Keep the existing log strings
    where they still apply; update the `PORT STATUS` block.
  - The canonical `LspServerConfig.bundled` field (in `mainframe-types`) stays for
    TS parity but no longer gates a separate code path — note this in a one-line
    comment; do not churn `mainframe-types`.
- **Verify:** `cargo test -p mainframe-lsp lsp_registry` green.

### T2.4 — Drop the bundled-Node env wiring in the daemon + spawn cleanup
- **Files:** `packages/core-rs/crates/mainframe-daemon/src/main.rs` (~L314-325:
  `MAINFRAME_BUNDLED_NODE` / `MAINFRAME_BUNDLED_LSP_ROOT` → `with_bundled`),
  `packages/core-rs/crates/mainframe-lsp/src/lsp_manager.rs` (~L270
  `ELECTRON_RUN_AS_NODE`).
- **Change:** delete the `MAINFRAME_BUNDLED_*` reads and the `with_bundled` call;
  keep `with_resolved_path`. Remove the now-dead `ELECTRON_RUN_AS_NODE` env (only
  meaningful for a bundled Electron/node spawn). Update the trailing daemon
  `PORT STATUS` comment (~L886).
- **Verify:** `cargo check -p mainframe-daemon`; grep confirms `MAINFRAME_BUNDLED_`
  no longer appears in `packages/core-rs`.

### T2.5 — `lsp-languages` route parity + gate + changeset
- **Files:** none expected (route derives `installed` from `resolve_command`); verify
  only.
- **Verify:** `cd packages/core-rs && cargo test --workspace && ./tools/verify-gate.sh`.
  Run the e2e `context-panel` / editor specs (they must stay green; they do not
  assert a live server). Confirm `lsp-languages` returns `installed:false` cleanly on
  a host with no servers and `true` with a locally-installed server.
- **Changeset:** `pnpm changeset --empty`.

**Exit:** daemon starts and serves `lsp-languages` with no bundled Node; a project
with a locally-installed server is discovered; unresolved servers fail soft.

---

## PR 3 — Flip the Tauri default to Rust

Smallest possible behavior change, landed only after PRs 1–2 prove native search +
LSP.

### T3.1 — Flip the resolver default + tests
- **Files:** `packages/app-tauri/src-tauri/src/daemon_impl.rs`.
- **Change:** line ~59 `read_persisted_impl(settings).unwrap_or(DaemonImpl::Node)`
  → `.unwrap_or(DaemonImpl::Rust)`. Update the module doc comment (lines 3, 9:
  "Default: Node" → "Default: Rust"). Rename/flip the test
  `defaults_to_node_when_unset` (L178-182) → `defaults_to_rust_when_unset` asserting
  `DaemonImpl::Rust`. Keep `env_wins_over_persisted`, `invalid_env_falls_back...`,
  and `persisted_rust_used_when_env_unset` (still valid). Add/keep a test that
  persisted `node` still overrides the default (escape hatch still works *in this
  PR*, before PR 4 removes the Node arm).
- **Verify:** `cd packages/app-tauri/src-tauri && cargo test daemon_impl`.

### T3.2 — Canary the default + changeset
- **Verify:** run the CUTOVER §1 canary against the **default** (no
  `MAINFRAME_DAEMON_IMPL`, no persisted setting) with a cargo-built binary:
  ```
  MAINFRAME_RUST_DAEMON_PATH="$PWD/packages/core-rs/target/release/mainframe-daemon" \
  DAEMON_PORT=31600 MAINFRAME_DATA_DIR="$(mktemp -d)" VITE_PORT=5199 \
  node packages/app-tauri/scripts/tauri-dev.mjs
  ```
  Host log shows `daemon_impl="rust"`; `GET http://127.0.0.1:31600/health` → ok;
  UI lists projects; one real `claude` turn reaches `idle`.
- **Changeset:** `pnpm changeset` → `@qlan-ro/mainframe-app-tauri` patch.

**Exit:** a fresh install with no persisted setting boots the Rust daemon.

> **Stack guard (PR 3 ↔ PR 4):** after PR 3 flips the default to `Rust`, base
> packaging still bundles only Node until PR 4 (the Rust binary lives in the canary
> overlay). A release tag cut in that window would default to Rust and fail in
> `resolve_rust_daemon_bin` (no bundled binary). **Do not cut a release tag mid-stack**
> — land PR 3 and PR 4 together, or hold tagging until PR 4 merges.

---

## PR 4 — Tauri packaging: stop bundling Node / rg / LSP; retire the Node arm

Delete the Node sidecar machinery, collapse the canary overlay into the base config,
and reduce `daemon_impl.rs` to a single impl. This is the largest app-tauri PR.

### T4.1 — Collapse the Rust shell's Node arm
- **Files:** `packages/app-tauri/src-tauri/src/sidecar.rs`,
  `packages/app-tauri/src-tauri/src/lib.rs`.
- **Change (sidecar.rs):** replace `enum DaemonProgram { Node{..}, Rust{..} }`
  (L107-127) with the single Rust program (a struct or a `daemon_bin: PathBuf`
  parameter). Drop the `bundled_node` / `bundled_lsp_root` fields and the
  `MAINFRAME_BUNDLED_NODE` / `MAINFRAME_BUNDLED_LSP_ROOT` env wiring (L118-126,
  L161-177). Delete `find_bundled_node`, `find_bundled_node_in`, `find_node`
  (L255-372) and their tests (`bundled_node_scan` L419-449, `find_node_result_is_file`,
  `nvm_sort_numeric_not_lexical`). Keep `find_bundled_rust_daemon` /
  `find_bundled_binary_in` and `bundled_rust_daemon_scan`. Simplify the `spawn_daemon`
  match and the `program` name log (L149-210) to the single arm.
- **Change (lib.rs):** delete `boot_node_daemon` (L331-369); collapse `boot_daemon`
  (defined L304; its resolve-and-match block L322-327) to call `boot_rust_daemon`
  directly (drop the `match impl_`). Simplify
  `boot_rust_daemon` (L379-420) to drop `bundled_node` / `bundled_lsp_root`
  resolution (L389-399). Delete `resolve_daemon_entry` (~L506-540),
  `pick_daemon_entry` (~L482-494), and the `daemon.cjs` / `resource_dir()/daemon`
  resolution (~L445-460, L510-513). Keep `resolve_rust_daemon_bin` (L431-477).
- **Verify:** `cd packages/app-tauri/src-tauri && cargo test && cargo clippy`;
  grep confirms no `DaemonProgram::Node`, `boot_node_daemon`, `find_bundled_node`,
  `find_node`, `daemon.cjs`, `MAINFRAME_BUNDLED_` remain in `src-tauri/src`.

### T4.2 — Delete `MAINFRAME_DAEMON_IMPL` / `daemon_impl.rs`
- **Files:** `packages/app-tauri/src-tauri/src/daemon_impl.rs` (delete file),
  `packages/app-tauri/src-tauri/src/lib.rs` (module decl + `invoke_handler`
  registrations of `daemon_impl_get` / `daemon_impl_set`), and the renderer canary
  toggle — grep `packages/ui/src` for `daemon_impl_get` / `daemon_impl_set` /
  `daemonImpl` and remove the settings control + its `data-testid`.
- **Change:** remove the flag, the two Tauri commands, the persisted `daemonImpl`
  read/write, and the UI toggle. `boot_daemon` no longer resolves an impl.
- **Verify:** `cargo test` (src-tauri) + `pnpm --filter @qlan-ro/mainframe-ui
  typecheck && pnpm --filter @qlan-ro/mainframe-ui exec vitest run <touched files>`;
  grep confirms `MAINFRAME_DAEMON_IMPL` / `daemonImpl` gone from `src-tauri` + `ui`.

### T4.3 — Point the base Tauri config at the Rust daemon; delete the canary overlay
- **Files:** `packages/app-tauri/src-tauri/tauri.conf.json`,
  `packages/app-tauri/src-tauri/tauri.rust-canary.conf.json` (delete).
- **Change:** in `tauri.conf.json`: `externalBin: ["binaries/node"]` →
  `["binaries/mainframe-daemon"]`; delete the `resources: { "resources/daemon":
  "daemon" }` mapping (bundled `daemon.cjs` + LSP `node_modules`); set
  `beforeBuildCommand` to `pnpm --filter @qlan-ro/mainframe-ui build && pnpm
  --filter @qlan-ro/mainframe-app-tauri bundle` where `bundle` now means
  provision-rust-daemon (see T4.4). Keep `createUpdaterArtifacts: true`, icons,
  signing, updater. Delete the canary overlay file.
- **Verify:** `jq . tauri.conf.json` valid; no `binaries/node` / `resources/daemon`
  remain.

### T4.4 — Rewire app-tauri package scripts; delete Node bundling scripts
- **Files:** `packages/app-tauri/package.json`; delete
  `packages/app-tauri/scripts/provision-node.mjs`,
  `packages/app-tauri/scripts/bundle-daemon.mjs`,
  `packages/app-tauri/scripts/codesign-daemon.mjs`, and
  `scripts/collect-daemon-deps.mjs` (repo root; only Node-daemon consumers). Check
  `packages/app-tauri/scripts/lib/mach-o-sign.mjs` for remaining users
  (`codesign:daemon` referenced it) — delete if orphaned, else keep.
- **Change (package.json):** redefine `bundle` → `pnpm run provision:rust-daemon`;
  delete `provision:node`, `bundle:daemon`, `bundle:canary`, `codesign:daemon`,
  `codesign:daemon:dry-run`, `tauri:build:canary`; drop the `esbuild` devDependency.
  Keep `provision:rust-daemon`, `tauri:dev`, `tauri:build`, `tauri`.
- **Verify:** `node -e "require('./packages/app-tauri/package.json')"`; grep confirms
  `bundle-daemon` / `provision-node` / `collect-daemon-deps` no longer referenced
  outside `packages/core` and docs.

### T4.5 — Clean the binaries/resources scaffolding
- **Files:** `packages/app-tauri/src-tauri/binaries/README.md`,
  `packages/app-tauri/src-tauri/binaries/.gitignore`,
  `packages/app-tauri/src-tauri/resources/.gitignore`,
  `packages/app-tauri/src-tauri/resources/` (bundled daemon dir).
- **Change:** update READMEs/gitignores to describe only `mainframe-daemon-<triple>`;
  remove Node-sidecar / `daemon.cjs` / `resources/daemon` references.
- **Verify:** grep the `src-tauri` tree for `binaries/node`, `daemon.cjs`,
  `resources/daemon` — none remain.

### T4.6 — Packaged-build gate + signed smoke test + changeset
- **Verify:**
  - `cd packages/app-tauri && pnpm run provision:rust-daemon && cd src-tauri &&
    cargo tauri build --debug` — produces an app with no `node`, `rg`, or LSP
    `node_modules` in the bundle (inspect `.app/Contents/Resources` +
    `MacOS/`); it boots and reaches Connected.
  - **Signed + notarized smoke test (CUTOVER §4b/§5-step-5):** build on the release
    cert, install the `.dmg` on a clean machine (no dev tools), confirm the Rust
    sidecar launches under Gatekeeper + hardened runtime. Watch for a nested-binary
    entitlements/notarization rejection (`entitlements.plist` targets the main app;
    the `mainframe-daemon` sidecar may need `allow-jit`/inherit or its own
    entitlements). Confirm bundled LSP is gone and BYO LSP resolves a
    project-local server (closes the old OPEN GAP 2 by removing the bundled path).
- **Changeset:** `pnpm changeset` → `@qlan-ro/mainframe-app-tauri` minor.

**Exit:** the packaged app bundles only `mainframe-daemon`; boots to Connected;
no Node/rg/LSP `node_modules` present.

---

## PR 5 — Standalone Rust daemon + Rust CLI (update / pair / status)

Rebuild the standalone tarball around the Rust binary and give it a Node-free CLI.

**Decision (unilateral — surface to user).** The standalone must be Node-free
("Pure-Rust standalone NOW"), so it cannot exec the Node CLI in
`packages/core/src/cli`. Investigation of that CLI (`packages/core/src/index.ts`
L334-345 dispatches `pair` | `status` | `update`, else boots the daemon):
- `update.ts` (230 lines) — self-update via the GitHub releases API + semver compare
  + downgrade guard + `tar` extract over the install root.
- `pair.ts` (73) / `status.ts` (45) — thin HTTP clients that GET `/health` and print.

**Chosen shape:** a thin `mainframe` **bash wrapper** that execs the Rust
`mainframe-daemon`, plus **port `update` / `pair` / `status` into the Rust binary's
argv dispatch** (it already handles `--version` / `version` at
`mainframe-daemon/src/main.rs:86`). `packages/core/src/cli/*` stays in-tree as the
reference/spec, and its Vitest suite (`update.test.ts`) is the parity oracle for the
port. Cheaper fallback if the user wants to minimize scope: reimplement only
`update` in bash (curl + a small semver check + `tar`) and drop pair/status from
standalone — noted, not chosen.

### T5.1 — Port `update` to a Rust subcommand (TDD)
- **Files:** new module in `packages/core-rs/crates/mainframe-daemon/src/`
  (e.g. `cli/update.rs`, split to respect 300 lines), dispatch in `main.rs` (~L86
  argv match).
- **Change:** port `standaloneArtifactName`, `pickRelease`, `compareSemver`,
  `assertNotDowngrade`, `assetUrl`, `resolveInstallRoot`, `runUpdate` using `reqwest`
  (already a workspace dep) for the GitHub API + download and system `tar` (shell out,
  as `update.ts` does) for extraction. `resolveInstallRoot` checks the new layout
  marker (`bin/mainframe-daemon`) instead of `lib/daemon.cjs`;
  `MAINFRAME_STANDALONE_ROOT` still honored. Tests first: port `update.test.ts`'s
  cases (semver ordering, downgrade refusal, artifact-name mapping, release picking)
  as Rust unit tests with hardcoded expectations.
- **Verify:** `cargo test -p mainframe-daemon update`.

### T5.2 — Port `pair` / `status` subcommands (TDD)
- **Files:** `packages/core-rs/crates/mainframe-daemon/src/cli/` + `main.rs` dispatch.
- **Tests first (red):** unit tests over the pure pieces — the health-payload → status
  line formatting, the tunnel-URL → QR/output rendering, and the connect-failure path
  (asserts the exact "Cannot reach daemon" message + exit code 1). Hardcode expected
  strings (test-writer agent); do not recompute them from the impl.
- **Change:** `status` GETs `/health` and prints; `pair` GETs `/health` and renders
  the tunnel URL as a terminal QR (a small Rust QR crate) — match the current output
  contract. Fail with the same "Cannot reach daemon" message + exit 1 on connect
  error.
- **Verify:** `cargo test -p mainframe-daemon cli`; `cargo build --release -p
  mainframe-daemon`; manual `./mainframe-daemon status` against a running daemon.

### T5.3 — Rewrite `build-standalone.sh`
- **Files:** `scripts/build-standalone.sh`.
- **Change:** remove the `pnpm --filter mainframe-core build` +
  `node packages/app-electron/scripts/bundle-daemon.mjs` (line ~22),
  `collect-daemon-deps.mjs`, better-sqlite3 collection, and the Node.js download
  (steps 1-3). Instead: `cargo build --release -p mainframe-daemon
  --manifest-path packages/core-rs/Cargo.toml` (native per platform; add a
  rust-toolchain assumption — the CI job installs it in PR 6), stage the binary as
  `${DIST_DIR}/bin/mainframe-daemon`, keep the cloudflared download (step 4), and
  write the thin `mainframe` wrapper (step 5) to exec `${SCRIPT_DIR}/mainframe-daemon
  "$@"` (preserving `MAINFRAME_ORIG_PATH` + `MAINFRAME_STANDALONE_ROOT`). The
  `mainframe` wrapper execs the real `bin/mainframe-daemon` directly — **no symlink**
  (matches the `install.sh` chmod list in T5.4, which chmods both binaries). Tar as
  `mainframe-daemon-<os>-<arch>.tar.gz` (unchanged name → `install.sh` /
  `standaloneArtifactName` stay valid).
- **Verify:** `bash scripts/build-standalone.sh darwin arm64` on macOS produces a
  tarball with no Node/`node_modules`/`daemon.cjs`; extract + run
  `bin/mainframe --version` and `bin/mainframe status`.

### T5.4 — Update install/update consumers
- **Files:** `scripts/install.sh` (untar layout: `chmod +x bin/mainframe` +
  `bin/mainframe-daemon` + `bin/cloudflared`), `scripts/build-release-local.sh`
  (`--daemon` path still calls `build-standalone.sh`; drop the `--electron` leg in
  PR 6). `packages/core/src/cli/update.ts` + its test stay as the reference (core is
  kept); no runtime change needed there since the standalone now self-updates via the
  Rust subcommand.
- **Verify:** dry-run `install.sh` against a locally-served tarball; `bin/mainframe
  update --help` prints usage.

### T5.5 — Changeset
- **Changeset:** `pnpm changeset --empty` (Rust CLI + shell scripts; no JS package
  version change) — or a `@qlan-ro/mainframe-core` patch if you choose to annotate
  the CLI move in the changelog.

**Exit:** `build-standalone.sh` produces a working Node-free tarball; `install.sh`
installs it; `mainframe update` self-updates to a newer release.

---

## PR 6 — Release pipeline + Electron deletion + docs

Land last: deleting `app-electron` breaks `build-standalone.sh` (fixed in PR 5) and
the CI jobs that build it.

### T6.1 — Rework `release.yml`
- **Files:** `.github/workflows/release.yml`.
- **Change:**
  - Delete the `build-desktop` job (Electron, L9-77).
  - Delete the `build-app-tauri-canary` job (L306-400); its Rust-build approach is
    now the base `build-app-tauri`.
  - Repurpose `build-daemon` (L79-122) to build the **Rust** daemon across the
    three-runner matrix (`macos-14`, `ubuntu-latest`, `ubuntu-24.04-arm`): add
    `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2 (core-rs)`, replace the
    `npm install -g node-gyp` step and the `build-standalone.sh` Node path with the
    PR-5 Rust `build-standalone.sh`. Upload `dist-standalone/*.tar.gz`.
  - `build-app-tauri` (L129-296): drop the "Install node-gyp" step (L198-201) and the
    Node-sidecar `bundle-daemon` beforeBuildCommand assumptions; keep
    `rust-toolchain` + `rust-cache` + the version stamp. It now builds the Rust
    daemon into the app (base config from PR 4). Runner stays `macos-14` (arm64).
  - `release` job (L410-445): rewrite `needs:` / `if:` (L411, L417) to gate on
    `build-app-tauri` (not the deleted `build-desktop`; `build-daemon` still feeds
    the tarballs). Prune the electron artifact globs (`*.exe`, `*.AppImage`, `*.deb`,
    `*.rpm`, electron `latest*.yml`) from `files:` (L432-438), keeping `*.dmg`,
    Tauri `latest.json`/updater artifacts, and `*.tar.gz`.
  - `e2e` (L407) + `publish-release` (L453-476): unchanged (the auto-publish gate is
    already wired — see "Prerequisite" below).
- **Verify:** `actionlint .github/workflows/release.yml`; trace the DAG — two artifact
  producers (`build-app-tauri`, `build-daemon`) + `e2e` gate `publish-release`.

### T6.2 — Clean `ci.yml`, `e2e-mock.yml`, `setup-workspace`
- **Files:** `.github/workflows/ci.yml`,
  `.github/actions/setup-workspace/action.yml`, `.github/workflows/e2e-mock.yml`.
- **Change (ci.yml):** delete the app-electron typecheck step (L36) and the
  `types-and-electron` / `core` electron test legs (L49-56) — keep the `types` +
  `ui` legs. Keep `build:core` / core typecheck only if you want the orphan core
  package still gated (recommended, since it stays in-tree); otherwise drop.
  **(setup-workspace):** delete `npm install -g node-gyp` (L21-24), the
  native-module `side-effects-cache` `.npmrc` (L26-31), and the Electron download
  cache (L33-39). **(e2e-mock.yml):** delete the `npm install -g node-gyp` step
  (L56-57) — the ripgrep step already went in PR 1.
- **Verify:** `actionlint`; a dry PR run of ci.yml + e2e-mock.yml is green.

### T6.3 — Delete `packages/app-electron` + repoint remaining scripts
- **Files:** delete `packages/app-electron/`. Repoint/clean:
  `scripts/setup-ports.sh` (L61, L70-71 electron build),
  `scripts/install-electron.mjs` (delete; remove root `package.json` `postinstall`
  hook that calls it), `scripts/generate-icons.sh` (L2, L6, L11 icon sources — move
  the source `icon.svg`/`favicon.png` into `packages/app-tauri` or repo assets, or
  drop the script if icons are already generated), `scripts/sign-electron-dev.sh`
  (delete), root `package.json` scripts (`dev`, `dev:desktop`, `dev:electron`,
  `build:desktop`, `package`, `postinstall`) — remove the electron legs.
- **Verify:** `pnpm install` succeeds with no `postinstall` electron step; grep the
  repo (excluding `docs/`, `pnpm-lock.yaml`, `CHANGELOG.md`) for `app-electron` —
  only historical/doc references remain.

### T6.4 — Changeset config + lockfile + orphan-core note
- **Files:** `.changeset/config.json`, `pnpm-lock.yaml`.
- **Change:** remove `@qlan-ro/mainframe-app-electron` from the `fixed` group
  (`[["@qlan-ro/mainframe-types", "@qlan-ro/mainframe-core"]]`) — a `fixed` group
  referencing a deleted package errors. **This edit must be committed before any
  `changeset version` runs**, else the stale `fixed` entry fails the release job the
  same way. Regenerate `pnpm-lock.yaml` via
  `pnpm install`. Confirm `packages/core` remains a valid (orphan) workspace member;
  `prepare-release.yml` L29 still reads `packages/core/package.json` for the tag.
- **Verify:** `pnpm changeset status`; `pnpm install --frozen-lockfile` clean.

### T6.5 — Docs to "shipped"
- **Files:** `docs/rust-port/CUTOVER.md`, `docs/DEVELOPER-GUIDE.md`, `CONTRIBUTING.md`,
  `AGENTS.md`, `.claude/launch.json`, `packages/app-tauri/CLAUDE.md`/agent docs as
  needed.
- **Change:** update `CUTOVER.md` to "shipped: Rust is the only daemon" — record the
  removed deviations (bundled-LSP `installed` is now env-derived; the two Node
  snake_case key leaks are moot once Node is not shipped) and note the escape hatch is
  gone. Strip Electron dev instructions from `DEVELOPER-GUIDE.md` / `CONTRIBUTING.md`.
- **Verify:** manual doc read; links resolve.

### T6.6 — Changeset
- **Changeset:** `pnpm changeset --empty`. A frontmatter entry naming
  `@qlan-ro/mainframe-app-electron` would reference a package that no longer exists in
  the workspace (deleted in T6.3) and hard-fail `changeset version`; the removal is
  covered by the T6.4 config edit + the CHANGELOG note. The remaining live packages
  (`types`, `core`, `ui`, `app-tauri`) are unaffected by this PR.

**Exit:** a tag push builds exactly two artifacts (Tauri app + standalone tarballs);
`e2e` gates `publish-release`; no Node/Electron build path remains.

---

## Prerequisite already landed (the auto-publish gate)

`FULL-CUTOVER-PLAN.md` §4's e2e auto-publish gate is confirmed present:
`e2e-mock.yml` declares `workflow_call` (~L17-23) and `release.yml` has the `e2e`
job (`uses: ./.github/workflows/e2e-mock.yml`, ~L407) + `publish-release`
(`needs: [release, e2e]`, gated on both green, ~L453-476). This plan builds on it;
do not re-implement it.

---

## Final verification phase (run before merging the top of the stack)

Cross-cutting gates, run on the fully-stacked branch:

- **V1 — Rust workspace:** `cd packages/core-rs && cargo test --workspace`
  (expect ~1,303+ pass / 0 fail; new search + LSP + CLI tests added) and
  `./tools/verify-gate.sh` (clippy + fmt + gate clean).
- **V2 — Wire parity:** `node tools/diffd/diffd.mjs` (0 DIVERGENT) and
  `node tools/diffd/soak.mjs` (no new Rust divergence). Note: diffd/soak shell out to
  `pnpm --filter mainframe-core build` — they keep working because core stays in-tree.
- **V3 — E2E suite:** `pnpm test:e2e` (or `cd packages/e2e && pnpm build:app:tauri`
  then the tauri project). Runs permanently against the Rust daemon. Must be green
  with no `rg` and no bundled Node on `PATH`. Leave the untracked
  `packages/e2e/plugins/` dir alone (not ours).
- **V4 — Packaged canary:** signed + notarized `.dmg` on a clean machine boots the
  Rust daemon to Connected; open a TS/Python file and confirm BYO LSP resolves a
  project-local server (or fails soft when absent).
- **V5 — Standalone:** `build-standalone.sh` tarball installs via `install.sh`;
  `mainframe --version` / `status` / `update --help` work; the tarball contains no
  Node.
- **V6 — Typecheck/lint:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`;
  `pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit` (orphan core still
  compiles); `pnpm -r run lint`.
- **V7 — Changesets:** `pnpm changeset status` clean; every PR carries a changeset.

---

## Release notes (accepted gaps — do NOT plan work for these)

Carry these into the release changelog; they are accepted at cutover
(`CUTOVER.md` §3-4):

- **Plugin system is builtin-only** (`claude`, `codex`, `todos`); user on-disk
  plugins are not discovered on the Rust daemon.
- **Workflows are unavailable** on the Rust daemon (`/api/workflows`,
  `/api/workflow-connectors`, `/api/workflow-credentials` return 404).
- **Codex model catalog may be empty** until #226 (the adapter still runs).
- **Resumed chats skip re-scanning** — reopening a chat does not re-run PR-URL
  detection, @-mention, or plan/skill-file extraction.
- **Trust-workspace is a skeleton** — workspace-trust gating is not enforced.
- **In-editor LSP is best-effort** — TypeScript/Python intelligence requires a
  discoverable server (`PATH`, project `node_modules/.bin`, or a venv); many
  developers won't have one and get no in-editor server (intentional).

---

## Open decisions & risks (surface to the user)

1. **No Node escape hatch (deviation #2).** Retiring the Node arm deletes the only
   thing `MAINFRAME_DAEMON_IMPL=node` could select, so the flag is removed. Rollback
   after PR 4 = revert/ship the prior tag, not a per-user flag. If the user wants a
   one-release hatch, PRs 3–4 must keep `boot_node_daemon` + the Node bundle alive —
   which contradicts "retire the Node sidecar in the same effort." Recommend
   proceeding without the hatch, guarded by the canary + e2e gates.
2. **Standalone CLI port scope (PR 5 decision).** Porting `update`/`pair`/`status`
   to Rust is chosen over a bash-only `update` to keep the standalone truly
   Node-free and testable. This adds ~1 module + tests to `mainframe-daemon`.
   `FULL-CUTOVER-PLAN.md` §W5 also flags "is the standalone in scope for this
   cutover, or staged after the Tauri flip?" — if the user wants the higher-value
   Tauri app to ship first, PRs 5–6's standalone/CLI work can be deferred to a
   follow-up stack while still deleting Electron (repoint `build-standalone.sh` to a
   stub or gate its CI job off).
3. **Icon sources move (T6.3).** `generate-icons.sh` sources
   `packages/app-electron/resources/icon.svg` + `favicon.png`. Deleting Electron
   orphans them; the committed generated icons in `app-tauri/src-tauri/icons` are
   unaffected, but the regen script needs the source assets relocated or the script
   retired. Low risk; flagged so it isn't missed.
4. **Platform teardown (unchanged, accepted).** `launch_manager.rs` /
   `lsp_manager.rs` shell out to unix `kill`; Windows stays unsupported. Linux
   standalone's `kill` paths already apply (CUTOVER §5). The shebang-child sweep
   integration test (`records_a_shebang_child…`) is ignored on Linux (ps argv
   matcher) — leave it; do not fix.
5. **Nested-binary notarization (T4.6).** The Rust sidecar may need its own
   entitlements/`allow-jit` under the hardened runtime; the signed smoke test is the
   gate before any public build ships (CUTOVER §4b). Unverified until run.
6. **`packages/mobile`** (git submodule) is untouched; no pointer bump.
