# Todo #338 — Resolve the Claude CLI spool root from the daemon's real uid

**Branch:** `todo/338-cli-spool-root-uid`
**Route:** no-spec (works directly from the approved Agent Brief)
**Packages:** `packages/core-rs` only (Rust daemon). No TypeScript, no UI.

## Goal

`mainframe-background-tasks::spool_root::current_uid()` is a port-time stub that returns `None` on
every platform, and `spool_root()` falls back to `unwrap_or(0)`. A daemon running as a normal user
therefore computes `/tmp/claude-0/...` while the Claude CLI it spawns writes to
`/tmp/claude-<real uid>/...`. That single wrong integer breaks four production paths: the
background-task output tail (`409 invalid_path`, because `canonicalize` on a nonexistent
`/tmp/claude-0` fails), boot reconciliation, the worktree-removal kill sweep, and the liveness sweep
(`lsof` exits 1 for a missing path exactly as it does for a live file with no writers, so live bash
tasks are falsely ended as `stopped`). This plan replaces the stub with a safe, compile-time
platform-split `getuid(2)` via `rustix`, deletes the `0` fallback from both the resolver and the
validator's production default, and adds the coverage the suite lacks today — every existing test
injects uid 501 through a seam, so the un-injected production path has never been exercised.

## Established facts

Every line below was verified while planning. Downstream implementers and reviewers should trust
these receipts rather than re-deriving them.

**Claude CLI (leaked source, `~/Projects/qlan/claude-code/src/`, 2026-03-31 leak)**

- The CLI's per-user temp-dir name is `claude-${uid}` on unix and the bare `claude` on Windows —
  `utils/permissions/filesystem.ts:307-315`. The uid comes from `process.getuid?.() ?? 0`
  (`filesystem.ts:313`), i.e. the process's **real** uid, not the effective uid.
- The base directory is `process.env.CLAUDE_CODE_TMPDIR || (platform === 'windows' ? tmpdir() : '/tmp')`
  — `filesystem.ts:333-335`. On unix the fallback is the **literal** `/tmp`, never the process temp
  dir. This confirms the existing Rust branch shape is right and only the uid is wrong.
- `getClaudeTempDir()` realpath-resolves the base before joining the dir name
  (`filesystem.ts:340-346`), so on macOS the CLI's own paths are `/private/tmp/claude-<uid>/…`. This
  is why the daemon may keep recording the unresolved `/tmp/...` form: `MadeSpoolValidator::validate`
  realpaths **both** sides before comparing (`spool_validator.rs:112-119`), and `read_tail` opens the
  path through the `/tmp` symlink.
- The project sub-directory is `join(getClaudeTempDir(), sanitizePath(getOriginalCwd()))` —
  `filesystem.ts:376-377`.
- The task output file is `join(getProjectTempDir(), getSessionId(), 'tasks')/<taskId>.output` —
  `utils/task/diskOutput.ts:52` and `diskOutput.ts:71-73`. This is exactly the shape
  `ClaudeTaskEvents::handle_task_started` composes at
  `crates/mainframe-adapter-claude/src/task_events.rs:207-213`; only its root is wrong.
- The sandbox shell reuses the same construction — `utils/Shell.ts:204-207` joins
  `process.env.CLAUDE_CODE_TMPDIR || '/tmp'` with `getClaudeTempDirName()`.

**Rust dependency behaviour**

- `libc` cannot be used: `getuid` is declared in a plain `extern` block
  (`~/.cargo/registry/src/index.crates.io-*/libc-0.2.186/src/unix/mod.rs:1086`), so calling it needs
  an `unsafe` block. `grep -c "safe fn" libc-0.2.186/src/unix/mod.rs` returns `0` — libc 0.2.186 has
  no edition-2024 `safe fn` declarations. Every crate in this workspace carries
  `#![forbid(unsafe_code)]` (`crates/mainframe-background-tasks/src/lib.rs:6`), so libc is out
  despite already being in the production tree.
- `rustix::process::getuid()` is a **safe** function returning `Uid`
  (`rustix-1.1.4/src/process/id.rs:31-34`); the `unsafe` inside rustix is encapsulated behind
  `#![allow(unsafe_code)]` in rustix's own module (`id.rs:8`), which does not propagate to callers.
- `Uid::as_raw()` is a `const fn` returning `RawUid`, and `pub type RawUid = ffi::c_uint`
  (`rustix-1.1.4/src/ugid.rs:11` and `ugid.rs:46-48`) — a plain `u32` on every supported target.
- `rustix::process` is gated on `#[cfg(feature = "process")]` **and** `#[cfg(not(windows))]`
  (`rustix-1.1.4/src/lib.rs:266-269`). The feature itself only adds `linux-raw-sys/prctl`
  (`rustix-1.1.4/Cargo.toml:119`), and rustix's `default = ["std"]`
  (`rustix-1.1.4/Cargo.toml`, `[features]` block).
- `rustix 1.1.4` is already resolved in `packages/core-rs/Cargo.lock:2214-2224` with deps
  `bitflags 2.13.0`, `errno`, `libc`, `linux-raw-sys`, `windows-sys 0.61.2` — all already in the
  lock. It currently reaches the graph **only through `tempfile` as a dev-dependency**
  (`cargo tree -i rustix --target all`), so this change moves it into the production tree without
  adding a package to the lock.
- `libc 0.2.186` is already a production transitive dep of `mainframe-background-tasks` via
  `tokio → mio / signal-hook-registry / socket2` and `dashmap → parking_lot_core`
  (`cargo tree -p mainframe-background-tasks -i libc --edges normal`).

**Repo constraints**

- `std::env::set_var` is `unsafe` under edition 2024 and these crates forbid unsafe — the crate
  already documents the workaround it uses instead
  (`crates/mainframe-background-tasks/src/spawn_env.rs:1-13`, `docs/rust-port/PORTING.md:516`).
  Tests therefore cannot set `CLAUDE_CODE_TMPDIR`; the env lookup must be parameterised.
- CI's Rust gate runs `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and
  `cargo test` from `packages/core-rs` (`.github/workflows/rust-port.yml:28,31,34`).
- `packages/core-rs/tools/verify-gate.sh` greps for forbidden *patterns* (`unsafe`, `todo!(`,
  `panic!(`, `anyhow`, …) — it has **no dependency allowlist**, and it is not wired into any CI
  workflow (`grep -rn "verify.gate" .github/` finds nothing). Adding a crate cannot trip it.
- The dependency allowlist is prose in `docs/rust-port/PORTING.md:885-925`. That document states its
  own precedence rule at `PORTING.md:887-889`: "The Cargo workspace `[workspace.dependencies]` … is
  the runtime authority; if it and this list disagree, the scaffold wins and this document is
  updated."
- `docs/plans/` is gitignored (`.gitignore:53`) — plan artifacts need `git add -f`.
- Daemon-only fixes take a `'@qlan-ro/mainframe-ui': patch` changeset (release tags from `ui`); see
  `.changeset/background-activity-live-set.md` and `.changeset/cloudflared-reaping.md`.

## Constraints from CLAUDE.md

- Max 300 lines per file, 50 per function. `spool_validator.rs` is **already 358 lines** at HEAD —
  see Decision D5.
- No `unsafe`; `#![forbid(unsafe_code)]` stays on every crate.
- No silent catches — a rejection path that returns early must log via `tracing`.
- Tests required for new core logic; a changeset is required before committing.
- Never commit to `main`; work only in the worktree on `todo/338-cli-spool-root-uid`.

## Decisions

Recorded here so the reviewer can challenge them without re-deriving.

- **D1 — `rustix`, not `libc`.** The brief says one candidate crate "is already compiled into this
  crate's production dependency tree"; that crate is `libc`, and it is **unusable** because its
  `getuid` is an unsafe `extern` declaration (receipt above) while the crate forbids unsafe.
  `rustix::process::getuid()` is safe, is already at 1.1.4 in the lock, and pulls in no package that
  is not already there. Its only cost is that rustix moves from the dev-only graph into the
  production graph, so release builds now compile it.
- **D2 — the dependency is `cfg(unix)`-gated.** Declared once in `[workspace.dependencies]` with a
  justification comment, consumed by the crate under `[target.'cfg(unix)'.dependencies]`. A Windows
  build never sees rustix at all, which is stronger than a runtime branch and matches
  `rustix::process` being `#[cfg(not(windows))]` upstream anyway.
- **D3 — the platform split is `#[cfg(unix)]` / `#[cfg(windows)]`, not `cfg!(...)`.** The current
  code uses the runtime `cfg!(windows)` macro, which requires both branches to type-check on every
  target — impossible once one branch calls a unix-only function. Supported targets are macOS,
  Linux, and Windows; a hypothetical wasm target would now fail to compile with "no function
  `claude_dir_name`", which is a louder and more correct failure than silently producing `claude-0`.
- **D4 — the validator's default fails closed, it does not substitute.** `SpoolValidatorDeps.getuid`
  stays `Option<...>` (the test seam is preserved verbatim). `make_spool_validator` fills the `None`
  case with the real uid **on unix at construction time**. If a POSIX path is validated with no uid
  source at all — only reachable on a Windows host simulating Linux without injecting a uid —
  `validate` logs a warning and returns `false` rather than inventing a uid. No `0` survives in any
  form.
- **D5 — `spool_validator.rs`'s inline test module moves to an integration test.** The file is 358
  lines at HEAD, already over the 300-line hard limit, and this change edits it. Per "no leftovers",
  the `#[cfg(test)] mod tests` block moves verbatim to
  `crates/mainframe-background-tasks/tests/spool_validator.rs` (every symbol it touches —
  `Platform`, `SpoolValidatorDeps`, `RealpathFn`, `make_spool_validator`, `SpoolValidator` — is
  already `pub`), leaving the source at roughly 155 lines. Pure move: no test body changes.
- **D6 — no caching.** `spool_root()` stays a recompute-per-call string join, per the brief. The
  `CLAUDE_CODE_TMPDIR` read is parameterised into a private inner function purely so tests can
  exercise the override without `set_var`; the public signature is unchanged.
- **D7 — the liveness probe's "missing file vs. no writers" ambiguity is NOT fixed here.** The brief
  puts it explicitly out of scope. It is covered transitively: once the recorded path is right,
  `lsof` probes a real file. File it separately.

## Task groups

Two groups. `red-tests` writes only new files under `tests/`; `core` touches only `src/`,
`Cargo.toml`, `Cargo.lock`, docs, and `.changeset/`. They share no files, but `core` must not start
until `red-tests` has been observed failing.

---

## Group `red-tests` (kind: test)

Three failing tests that pin the acceptance criteria. **Every one must compile against HEAD and fail
on an assertion, not on a compile error** — a test file that does not compile breaks the whole
crate's test build and destroys the red signal. Use only symbols that exist today.

No `Cargo.toml` edits are needed: `tempfile` and `tokio` (full, plus `test-util`) are already
dev-dependencies of `mainframe-background-tasks` and `mainframe-adapter-claude`, `reqwest` and
`tempfile` are already dev-dependencies of `mainframe-server`, and `mainframe-background-tasks` is
already a normal dependency of both `mainframe-adapter-claude` and `mainframe-server`.

**Shared test conventions for all three tasks:**

- Gate each new file with `#![cfg(unix)]` — every assertion is about the unix uid segment.
- Add `#![allow(clippy::unwrap_used, clippy::expect_used)]` under it. `packages/core-rs/Cargo.toml`
  declares `[workspace.lints.clippy] unwrap_used = "deny"` / `expect_used = "deny"` and every crate
  carries `[lints] workspace = true`, which reaches integration-test targets too — the crate-level
  `#![cfg_attr(test, allow(…))]` in `lib.rs` covers only that crate's own unit tests. The conventions
  below (`Command::new("id")`, `parse::<u32>()`, `TempDir::new_in`, `DirBuilder::create`) all produce
  unwrap-shaped code, so without this attribute Task 4's and Task 13's
  `cargo clippy --all-targets -- -D warnings` gate fails. Every existing integration test carries it —
  see `crates/mainframe-server/tests/routes_projects.rs:4` and
  `crates/mainframe-adapter-claude/tests/workflow_task_events.rs:7`.
- Get the uid from an **independent oracle**, never from `rustix`: run
  `std::process::Command::new("id").arg("-u")`, trim, `parse::<u32>()`. Asserting rustix against
  rustix proves nothing.
- If the oracle uid is `0` (test running as root), `return` early — `claude-0` is then correct and
  the test is meaningless. Add a one-line comment saying so.
- Compute the base from `std::env::var("CLAUDE_CODE_TMPDIR").unwrap_or_else(|_| "/tmp".into())`.
  Never hardcode `/tmp`, or the suite breaks in a shell that sets the override.
- Create real directories under `<base>/claude-<oracle uid>` with
  `std::fs::DirBuilder::new().recursive(true).mode(0o700)` (via
  `std::os::unix::fs::DirBuilderExt`), and put every test's files inside a `tempfile::TempDir`
  created with `TempDir::new_in(<that root>)` so cleanup is automatic and concurrent tests cannot
  collide.
- **Never create `<base>/claude-0`.** The rejection assertions rely on it not existing.

### Task 1 — Red: the un-injected default validator and `spool_root()` agree with the real uid

**File (new):** `packages/core-rs/crates/mainframe-background-tasks/tests/spool_root_default_uid.rs`

Two `#[tokio::test]`s:

1. `spool_root_uses_the_real_uid` — assert
   `spool_root() == PathBuf::from(format!("{base}/claude-{oracle_uid}"))`.
   Red today: `spool_root()` returns `<base>/claude-0`.
2. `default_validator_accepts_the_real_uid_root_and_rejects_claude_0` — build the **production
   default** validator, i.e. exactly what `routes/background_tasks.rs:60-67` builds:
   ```rust
   make_spool_validator(SpoolValidatorDeps {
       platform: Platform::current(),
       getuid: None,
       env: std::env::vars().collect(),
       realpath: None,
       tmpdir: None,
   })
   ```
   Create `<real root>/<tempdir>/sess-a/tasks/` and write `task-xyz.output` with some bytes.
   - Assert `validate(<that path>, "task-xyz").await == true`. Red today: the default root is
     `claude-0`, `canonicalize` returns `ENOENT`, and `validate` returns `false` at
     `spool_validator.rs:113`.
   - Assert `validate(&format!("{base}/claude-0/p/sess-a/tasks/task-xyz.output"), "task-xyz").await
     == false`.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-background-tasks --test spool_root_default_uid`
→ both tests FAIL on assertions (not on compilation). Record the failure output.

### Task 2 — Red: the adapter's recorded path, `spool_root()`, and the default validator agree in one assertion

**File (new):** `packages/core-rs/crates/mainframe-adapter-claude/tests/spool_path_agreement.rs`

This is acceptance criterion "asserted in one test rather than three independent constant checks".
One `#[tokio::test]`, `recorded_task_output_path_is_accepted_by_the_default_validator`:

- Build `let tracker = Arc::new(BackgroundTaskTracker::new());` and
  `let store = Arc::new(ClaudeWorkflowStore::new(...));`, then
  `ClaudeTaskEvents::new(tracker.clone(), store)` (constructor at `task_events.rs:107-116`; check
  `ClaudeWorkflowStore`'s constructor and mirror how `tests/workflow_task_events.rs` builds one).
- Call `handle_task_started("chat-1", TaskStartedPayload { task_id: "task-agree".into(),
  tool_use_id: None, description: None, task_type: None, workflow_name: None },
  TaskStartedCtx { claude_session_id: "sess-agree".into(), real_cwd: <a real temp dir path> })`.
- Read the task back through the tracker's public read API and take its `output_path`.
- Assert `output_path.starts_with(&spool_root().to_string_lossy().into_owned())`.
- Assert `output_path` starts with `<base>/claude-<oracle uid>/` — the independent-oracle check.
- `create_dir_all` the parent of `output_path`, write the file, and assert the **production default**
  validator (same struct literal as Task 1) accepts `(&output_path, "task-agree")`.
- Clean the created tree up at the end (it lives under the user's real CLI temp dir; use a unique
  `real_cwd` temp dir so the encoded-cwd segment is unique, then `remove_dir_all` that segment).

Red today on the `claude-<oracle uid>` prefix assertion and on the validator assertion.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-adapter-claude --test spool_path_agreement`
→ FAILS on an assertion.

### Task 3 — Red: the background-task output-tail route succeeds for a real spool file

**File (new):** `packages/core-rs/crates/mainframe-server/tests/routes_background_tasks_output.rs`

Follow the shape of `crates/mainframe-server/tests/routes_projects.rs` (`mod support;`,
`support::spawn_test_server(None)`, plain `reqwest`; no auth header is needed when the harness is
spawned with `None`). `TestServer` exposes `pub ctx: Arc<AppCtx>`
(`tests/support/mod.rs:28-32`), and `ctx.background_tasks` is the real
`Arc<BackgroundTaskTracker>` (`src/ctx.rs:114`), so tasks can be seeded directly with
`tracker.start(chat_id, TaskSeed { … }, output_path)` (signature at `tracker.rs:109`; `TaskSeed`
fields at `tracker.rs:36-46`).

Two `#[tokio::test]`s against `GET /api/chats/{chatId}/background-tasks/{taskId}/output`
(route registered at `routes/background_tasks.rs:164-167`):

1. `returns_the_tail_of_a_spool_file_under_the_real_spool_root` — seed a task whose `output_path` is
   a real file created under `<base>/claude-<oracle uid>/<tempdir>/sess/tasks/task-tail.output`
   containing known bytes; assert the response is `200` and the body ends with those bytes.
   Red today: the default validator rejects, and the route returns `409` with `invalid_path`
   (`routes/background_tasks.rs:110-113`).
2. `rejects_a_path_outside_the_spool_root` — seed a task whose `output_path` is a real file in a
   plain `tempfile::TempDir` outside the spool root; assert `409` and that the JSON error is
   `invalid_path`. This one passes today and must keep passing — it is the guard that the fix does
   not widen the validator.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-server --test routes_background_tasks_output`
→ test 1 FAILS (409 ≠ 200), test 2 PASSES.

### Task 4 — Confirm the red baseline

Run all three new test binaries plus the existing suites that must stay green:

```
cd packages/core-rs
cargo test -p mainframe-background-tasks
cargo test -p mainframe-adapter-claude
cargo test -p mainframe-server --test routes_background_tasks_output
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

**Verify:** exactly the four assertions named in Tasks 1-3 fail; every pre-existing test still
passes; clippy and fmt are clean on the new files. Paste the failing assertion names into the commit
message for the red commit.

---

## Group `core` (kind: core) — depends on `red-tests`

### Task 5 — Declare `rustix` at the workspace level and wire it into the crate

**Files:**
- `packages/core-rs/Cargo.toml`
- `packages/core-rs/crates/mainframe-background-tasks/Cargo.toml`

In `[workspace.dependencies]`, next to the other justified entries, add:

```toml
# Safe `getuid(2)` for the Claude CLI's per-user spool root (`/tmp/claude-<uid>`);
# libc's binding is an unsafe extern and every crate here is `forbid(unsafe_code)`.
rustix = { version = "1", features = ["process"] }
```

In the crate manifest, add a target-gated table (do **not** put it in `[dependencies]`):

```toml
[target.'cfg(unix)'.dependencies]
rustix = { workspace = true }
```

**Verify:**
- `cd packages/core-rs && cargo check -p mainframe-background-tasks` succeeds.
- `git diff packages/core-rs/Cargo.lock` shows **no new `[[package]]` stanza** — only the
  `mainframe-background-tasks` dependency edge. Prove it with
  `git show HEAD:packages/core-rs/Cargo.lock | grep -c '^\[\[package\]\]'` versus
  `grep -c '^\[\[package\]\]' packages/core-rs/Cargo.lock` — the two counts must be identical.
- `cargo tree -p mainframe-background-tasks -i rustix --edges normal` now lists
  `mainframe-background-tasks` as a direct parent.

### Task 6 — Replace the uid stub in the resolver

**File:** `packages/core-rs/crates/mainframe-background-tasks/src/spool_root.rs`

Rewrite the module:

- Delete `current_uid() -> Option<u32>` and its `TODO(port)` comment (line 12) entirely.
- Add a unix-only, infallible resolver:
  ```rust
  /// Real uid of this process — the value `process.getuid()` returns inside the
  /// CLI, which names its per-user temp dir `claude-<uid>`. `getuid(2)` cannot fail.
  #[cfg(unix)]
  pub fn current_uid() -> u32 {
      rustix::process::getuid().as_raw()
  }
  ```
- Split the directory name and the default base into `#[cfg]`-gated pairs (Decision D3):
  `claude_dir_name()` → `format!("claude-{}", current_uid())` on unix, `"claude".to_string()` on
  windows; `default_tmp_base()` → `"/tmp".to_string()` on unix,
  `std::env::temp_dir().to_string_lossy().into_owned()` on windows.
- Add a private inner function so the override is testable without `set_var` (Decision D6):
  ```rust
  fn spool_root_with(tmpdir_override: Option<String>) -> PathBuf {
      PathBuf::from(tmpdir_override.unwrap_or_else(default_tmp_base)).join(claude_dir_name())
  }

  pub fn spool_root() -> PathBuf {
      spool_root_with(std::env::var("CLAUDE_CODE_TMPDIR").ok())
  }
  ```
  Add a one-line `why` comment on `spool_root_with` naming the edition-2024 `set_var` reason.
- **`unwrap_or(0)` must not appear anywhere in the file.**
- Add an inline `#[cfg(test)] mod tests`:
  - `honors_claude_code_tmpdir_override` — `spool_root_with(Some("/var/cache".into()))` ends with
    the same `claude_dir_name()` under `/var/cache`.
  - `defaults_to_the_literal_tmp_on_unix` (`#[cfg(unix)]`) — `spool_root_with(None)` starts with
    `/tmp/claude-`, i.e. does not use `std::env::temp_dir()`.
  - `dir_name_carries_the_real_uid` (`#[cfg(unix)]`) — `claude_dir_name()` equals
    `format!("claude-{}", <`id -u` oracle>)`.
  - `dir_name_has_no_uid_segment` (`#[cfg(windows)]`) — `claude_dir_name() == "claude"`.
- Rewrite the `PORT STATUS` trailer: `todos: 1` → `todos: 0`, `confidence: medium` → `high`, and
  replace the BLOCKER paragraph with a description of the shipped behaviour (safe `rustix::process::getuid`,
  `cfg(unix)`-gated dep, literal `/tmp` base on unix per the CLI).

**Verify:** `cargo test -p mainframe-background-tasks --lib spool_root` passes;
`cargo test -p mainframe-background-tasks --test spool_root_default_uid spool_root_uses_the_real_uid`
is now GREEN; `grep -n "unwrap_or(0)\|TODO(port)" crates/mainframe-background-tasks/src/spool_root.rs`
prints nothing.

The binary's other test, `default_validator_accepts_the_real_uid_root_and_rejects_claude_0`, **stays
red until Task 7** — it builds the production-default validator with `getuid: None`, which still
routes through `spool_validator.rs:108`'s `unwrap_or(0)`. That line is Task 7's edit, not Task 6's.
Do not chase it here.

### Task 7 — Give the validator a real production default (fail closed, no `0`)

**File:** `packages/core-rs/crates/mainframe-background-tasks/src/spool_validator.rs`

- Add a `#[cfg]`-gated default supplier:
  ```rust
  #[cfg(unix)]
  fn default_getuid() -> Option<Arc<dyn Fn() -> u32 + Send + Sync>> {
      Some(Arc::new(crate::spool_root::current_uid))
  }

  #[cfg(windows)]
  fn default_getuid() -> Option<Arc<dyn Fn() -> u32 + Send + Sync>> {
      None // Windows spool paths carry no uid segment.
  }
  ```
- In `make_spool_validator`, fill the seam at construction:
  `getuid: deps.getuid.or_else(default_getuid),`. The `SpoolValidatorDeps.getuid` field type is
  unchanged, so every injecting test keeps working untouched.
- In `validate`, replace `.unwrap_or(0)` (line 108) with a fail-closed match:
  ```rust
  let temp_dir_name = if platform == Platform::Win32 {
      "claude".to_string()
  } else {
      match &self.getuid {
          Some(f) => format!("claude-{}", f()),
          None => {
              tracing::warn!(
                  target: "background-tasks:spool",
                  %output_path,
                  "no uid source for a POSIX spool path; rejecting"
              );
              return false;
          }
      }
  };
  ```
  Add `use tracing;` only if the file does not already reach it (`tracing` is a crate dependency).
- **`unwrap_or(0)` must not appear anywhere in the file.**
- Update the `PORT STATUS` trailer's `deps.getuid` sentence: the seam is still injectable, and the
  production default now resolves the real uid on unix and fails closed elsewhere.

**Verify:** `cargo test -p mainframe-background-tasks --lib` and
`cargo test -p mainframe-background-tasks --test spool_root_default_uid` are GREEN;
`grep -n "unwrap_or(0)" crates/mainframe-background-tasks/src/spool_root.rs
crates/mainframe-background-tasks/src/spool_validator.rs` prints nothing. Scope the grep to those two
files: `liveness.rs:41` (miss-count default) and `reconcile.rs:173` (the `#[cfg(not(unix))]`
timestamp fallback) hold correct, unrelated `unwrap_or(0)` calls this todo does not own.

### Task 8 — Move `spool_validator`'s inline tests out (300-line limit, Decision D5)

**Files:**
- `packages/core-rs/crates/mainframe-background-tasks/src/spool_validator.rs` (delete the
  `#[cfg(test)] mod tests { … }` block, keep the `PORT STATUS` trailer at the bottom)
- `packages/core-rs/crates/mainframe-background-tasks/tests/spool_validator.rs` (new)

Pure mechanical move of all 8 existing cases. Replace `use super::*;` with
`use mainframe_background_tasks::spool_validator::{Platform, RealpathFn, SpoolValidator,
SpoolValidatorDeps, make_spool_validator};` and add
`#![allow(clippy::unwrap_used, clippy::expect_used)]` at the top, matching the other integration
tests. Do not change a single assertion.

**Verify:** `cargo test -p mainframe-background-tasks --test spool_validator` runs all 8 cases green;
`wc -l crates/mainframe-background-tasks/src/spool_validator.rs` is under 300.

### Task 9 — Remove the stale port markers

**File:** `packages/core-rs/crates/mainframe-background-tasks/src/reconcile.rs`

- Delete the `TODO(port)` comment and the "production callers should inject a validator until that
  dep lands" instruction at lines 95-97, leaving the bare `getuid: None,`.
- Update the doc comment on `ReconcileDeps.validator` (line 31): it is a test seam for pinning a
  validator, not a workaround for `process.getuid()` not matching CI.
- Delete the trailing `// TODO(port): default validator uid — see spool_root.rs blocker.` (line 587)
  and change the trailer's `todos: 1` to `todos: 0`.

**Verify:**
`grep -rn "TODO(port)" packages/core-rs/crates/ | grep -i "uid\|spool\|validator"` prints nothing;
`grep -n "allowlist" packages/core-rs/crates/mainframe-background-tasks/src/spool_root.rs
packages/core-rs/crates/mainframe-background-tasks/src/reconcile.rs` prints nothing. Scope the grep
to those two files: `kill.rs:3` and `kill.rs:925` document a different missing crate (`tree-kill`,
not `getuid`), are correct, and are not this todo's to edit.

### Task 10 — Update the consumed-surface checklist and the dependency allowlist

**Files:**
- `docs/adapters/claude/CONSUMED-SURFACE.md` (row `CLAUDE-FILE-08`, line 40)
- `docs/rust-port/PORTING.md` (§8 dependency table, around line 905)

`CLAUDE-FILE-08` currently documents this defect as a known gap ("`current_uid()` is a `TODO(port)`
stub returning `None`, so production always resolves `claude-0`…"). Rewrite it to describe the
shipped behaviour, keeping the table's column shape:

- **Coverage** column: replace `none` with the two pinning tests —
  `crates/mainframe-background-tasks/tests/spool_root_default_uid.rs` and
  `crates/mainframe-adapter-claude/tests/spool_path_agreement.rs`.
- **Risk/notes** column: the daemon resolves the same `<CLAUDE_CODE_TMPDIR or /tmp>/claude-<real uid>`
  the CLI builds at `filesystem.ts:307-315`; the risk is now that an upstream change to the dir-name
  scheme silently breaks the output tail, reconciliation, the worktree kill sweep, and liveness.
- Do **not** touch `CLAUDE-FILE-07` (the three divergent cwd encodings) — explicitly out of scope.

In `PORTING.md` §8, add one row so the document matches the workspace it defers to
(`PORTING.md:887-889`):
`| `rustix` (`process`) | safe `getuid(2)` for the Claude CLI spool root (`libc`'s binding is an unsafe extern; every crate is `forbid(unsafe_code)`) | in workspace |`

**Verify:** `grep -n "CLAUDE-FILE-08" docs/adapters/claude/CONSUMED-SURFACE.md` shows no
`TODO(port)`, no `claude-0`, and no "known gap" wording; `grep -n "rustix" docs/rust-port/PORTING.md`
finds the new row.

### Task 11 — Changeset

**File (new):** `.changeset/cli-spool-root-real-uid.md`

```
---
'@qlan-ro/mainframe-ui': patch
---
```

Body (prose, no bullet salad): background-task output never loaded. The daemon derived the Claude
CLI's spool directory from a uid it never read, so it looked for task output in `/tmp/claude-0` — a
directory that does not exist for a normal user — and the output request failed as an invalid path.
The same wrong directory meant tasks were not recovered after a daemon restart, shells writing into a
removed worktree were never signalled, and live bash tasks were falsely reported as stopped. The
daemon now reads its real uid.

**Verify:** the file exists and `pnpm changeset status` does not error.

### Task 12 — Confirm the untouched call sites and the non-unix build

No code changes. This task is the traceable evidence for the acceptance bullets about the three
sweeps and about the Windows build.

1. **Call sites that inherit the fix with no edit** — confirm each still passes `spool_root: None`
   and therefore now resolves the real root:
   - `crates/mainframe-daemon/src/main.rs:585` (boot reconciliation)
   - `crates/mainframe-server/src/routes/worktree.rs:315` (worktree-removal kill sweep)
   - `crates/mainframe-server/src/chat_deps.rs:501`
   Command: `grep -rn "spool_root: None" packages/core-rs/crates/` — expect exactly those three
   plus nothing new. `reconcile.rs:36-39` and `kill.rs:410-413` are the `unwrap_or_else(||
   default_spool_root())` sites they fall through to. `liveness.rs` takes no spool root at all — it
   probes `task.output_path` as recorded by the adapter, which Task 2 pins.
2. **Non-unix build** — run
   `rustup target add x86_64-pc-windows-msvc && cargo check -p mainframe-background-tasks --target
   x86_64-pc-windows-msvc`. If a transitive build script cannot run without a Windows linker, fall
   back to `cargo tree -p mainframe-background-tasks --target x86_64-pc-windows-msvc | grep rustix`
   (must print nothing, proving the dep is correctly `cfg(unix)`-gated) and record in the PR which
   of the two ran and why.

**Verify:** both commands produce the stated output; paste them into the PR description.

### Task 13 — Full green gate

```
cd packages/core-rs
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test -p mainframe-background-tasks
cargo test -p mainframe-adapter-claude
cargo test -p mainframe-server
bash tools/verify-gate.sh
```

Plus a final grep sweep proving no marker survived:

```
grep -n "unwrap_or(0)" packages/core-rs/crates/mainframe-background-tasks/src/spool_root.rs \
                       packages/core-rs/crates/mainframe-background-tasks/src/spool_validator.rs
grep -rn "TODO(port)" packages/core-rs/crates/ | grep -i "uid\|spool\|validator"
grep -rni "claude-0" packages/core-rs/crates/ docs/adapters/claude/CONSUMED-SURFACE.md
```

The first two must print nothing. The third must print only the deliberate *rejection* assertions in
`tests/spool_root_default_uid.rs`.

The first grep names the two edited files rather than sweeping the crate: `liveness.rs:41` and
`reconcile.rs:173` carry correct `unwrap_or(0)` calls that are out of scope, so a crate-wide sweep
could never clear and would push an implementer into deleting behaviour this todo does not own.

**Verify:** everything above exits 0 (or prints nothing, as specified). Then push the branch —
unpushed worktree work is lost when the worktree is removed.

## Out of scope

- The rest of #328 (background-task persistence and daemon-restart reconciliation).
- Teaching the liveness probe to distinguish a missing spool file from a live file with no writers
  (`lsof` exits 1 for both) — a separate latent defect; file it.
- The three divergent cwd-encoding implementations (`CLAUDE-FILE-07`).
- Any redesign of the spool protocol, the spool directory layout, or the output-tail route contract.
- Windows spool-root behaviour, which has no uid segment and is unchanged.
- How the CLI is spawned, its environment, or its working directory.

## Risks

- **R1 — tests write into the developer's real `/tmp/claude-<uid>`.** Every new test creates its
  files inside a `tempfile::TempDir` nested under that root, so they are removed on drop even on
  panic. They cannot collide with the CLI's own project segments, which are encoded absolute cwd
  paths. Worst case a stray `.tmpXXXX` directory is left behind in a directory `/tmp` reaps anyway.
- **R2 — `rustix` enters the production dependency graph.** No new lock entry (it is already there
  via `tempfile`), but release builds now compile it where before only test builds did. Accepted:
  it is the only safe `getuid` available without violating `forbid(unsafe_code)`.
- **R3 — the tests assume a writable `<base>/claude-<uid>`.** In a hardened CI sandbox with a
  read-only `/tmp`, directory creation fails and the tests error rather than skip. If CI shows this,
  the fix is to honour `CLAUDE_CODE_TMPDIR` in the CI env (the tests already read it) — not to
  weaken the assertions.
