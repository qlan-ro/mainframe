# Implementation plan — Title generation fails silently in four of five paths (#287)

**Brief (the contract):** todo #287, `## Agent Brief` (route `no-spec`; there is no spec document). Its Decisions block is settled; this plan implements it and does not reopen it.
**Worktree:** `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-287-title-generation-logging`, branch `todo/287-title-generation-logging`, off `5f7fdcaa`.
**Paths** below are relative to the worktree root. **All `cargo` commands run from `packages/core-rs/`.** Line numbers are as of `5f7fdcaa` and will shift as tasks land — anchor on the function name, not the number.
**Revision:** rev 2, after review round 1 (`NOT APPROVED`). Every accepted finding is folded into the tasks below; the two findings not adopted are recorded verbatim in "Review findings not adopted" at the end.

**Goal.** A chat gets a deterministic truncated title, then a spawned task tries to replace it with a model-generated one; of the ways that task can give up, exactly one logs today. This change makes every one of them emit a daemon log line carrying a stable `reason` token plus the chat id and adapter id wherever they are in scope, captures the title child's stderr instead of discarding it, and treats a non-zero exit as a failure rather than as an empty-but-successful result. The deterministic fallback title is never blanked, altered, or overwritten on any of these paths — that invariant is what the new tests lock. Nothing user-facing changes: no UI surface, no retries, no change to which candidates `finalize_title` accepts, no change to the fallback title format.

**Counting terminology, used consistently below.** The brief documents **five failure modes** (non-zero exit, unknown adapter id, adapter with no title model, chat evicted before the task ran, candidate rejected by the length/format check). The brief's "Key interfaces" section additionally requires a line at the `do_generate_title` call site and a debug line on the disabled-by-setting return. So: **five modes, seven emitted lines, seven reason tokens.** Where the changeset or the PR body speaks to users, it names the five modes.

---

## Ground rules for every task

- **Rust only.** No TypeScript, no UI, no `pnpm install`. The only non-Rust file this PR adds is the changeset (T12).
- **One cargo build at a time.** Cargo holds an exclusive lock on `packages/core-rs/target`; every task here is Rust, so the whole plan is strictly sequential. No two tasks may run concurrently.
- **This worktree will grow its own `packages/core-rs/target`** (a few GB). That is expected — per `CLAUDE.md` § Disk Hygiene, **do not** set `CARGO_TARGET_DIR` to share one.
- **Verification commands** (from `packages/core-rs/`):
  - `cargo test -p <crate>` — prefer the per-crate, per-filter form given in each task over a bare `cargo test`.
  - `cargo fmt` — a `lint-staged` pre-commit hook runs `rustfmt --edition 2024` on staged `.rs` files, and CI runs `cargo fmt --check`. Run `cargo fmt` before finishing any Rust task.
  - `cargo clippy --all-targets -- -D warnings` and `tools/verify-gate.sh` — both are CI gates (`.github/workflows/rust-port.yml`).
- **Workspace lints:** `clippy::unwrap_used` and `clippy::expect_used` are `deny` at the workspace root. Unit tests inside `src/` are exempted by each crate's `#![cfg_attr(test, allow(...))]`. **An integration test under `tests/` is a separate crate and inherits no such exemption** — it needs its own `#![allow(clippy::unwrap_used, clippy::expect_used)]` header, exactly like `crates/mainframe-adapter-codex/tests/list_models.rs:9`.
- **Code rules that bite here:** ≤50 lines per function (T7 must decompose, see below); no silent catch or bare unlogged early return on the title path; comments say *why*, not *what*.
- **`docs/plans/` is gitignored.** The lane contract requires this plan committed, so it is added with `git add -f`. Verify with `git ls-files docs/plans/`, never `git status`.
- **Do not commit or push.** The orchestrator owns commits and the PR.

---

## The log contract

One `reason` token per outcome; every line is emitted at exactly one site. The "Fields" column is exhaustive — where a field is absent, it is genuinely not in scope at that site (see D2).

| # | Outcome | Site | Level | Message | `reason` | Fields |
|---|---|---|---|---|---|---|
| 1 | Title child exited non-zero (or timed out, or failed to spawn) | `chat_deps.rs::generate_title` error arm | `warn` | `title generation failed` | `adapter_error` | `adapter_id`, `%err` (err text carries the exit code + truncated stderr) |
| 2 | Chat's adapter id is not registered | `chat_deps.rs::generate_title` | `warn` | `title generation skipped` | `unknown_adapter` | `adapter_id` |
| 3 | Adapter has no title model | `mainframe-adapter-api` `Adapter::generate_title` default body | `debug` | `title generation skipped` | `adapter_has_no_title_model` | `adapter_id` (`self.id()`) |
| 4 | Chat evicted before the spawned task ran | `lifecycle_manager.rs::do_generate_title` | `debug` | `title generation skipped` | `chat_not_active` | `chat_id` |
| 5 | Title generation returned no title (envelope) | `lifecycle_manager.rs::do_generate_title` call site, and `external_session_service.rs::generate_import_title` | `debug` | `title generation produced no title` | `no_title` | `chat_id`, `adapter_id` |
| 6 | Model reply failed the length/format check | `title_generator.rs::generate_claude_title` | `debug` | `title generation skipped` | `candidate_rejected` | `adapter_id = "claude"` (literal — this site is claude-only), `binary`, `candidate_chars` |
| 7 | Disabled by setting | `lifecycle_manager.rs::do_generate_title`, and `external_session_service.rs::generate_import_title` | `debug` | `title generation skipped` | `disabled_by_setting` | `chat_id`, `adapter_id` |

`candidate_chars` is defined as **the char count of the child's stdout after `String::from_utf8_lossy` and `.trim()`, before quote-stripping** — i.e. the length of what the model actually returned, not of what `finalize_title` would have produced. Never log the candidate text itself.

Every line uses the structured field `reason = "<token>"`, so an operator greps either the token or the message. Tokens are `&'static str` literals at each site — no shared enum, no helper (brief decision; see D3).

**Mapping to the brief's five modes:** non-zero exit → #1; unknown adapter id → #2; adapter with no title model → #3; chat evicted → #4; candidate rejected → #6. Lines #5 and #7 are the two extra lines the brief's "Key interfaces" section explicitly asks for.

---

## Acceptance-criteria → task matrix

| # | Brief acceptance criterion | Implemented by | Verified by |
|---|---|---|---|
| A1 | Five modes, five distinct reason tokens | log contract above; T7 (#6), T8 (#3), T9 (#1, #2), T10 (#4) | T3 (#4), T5 (#2), T6 (#1); #3 and #6 by returned-value tests (T6 cases 3 and 5) — see "Test-coverage boundary" |
| A2 | stderr captured; bounded stderr in the log on non-zero exit | T7 (`interpret_output` + `truncate_stderr`), T9 (`%err` on the warn) | T6 cases 1–2 (error text carries the stderr, bounded, multibyte-safe); T9's verify step confirms the warn interpolates `%err` |
| A3 | Non-zero exit is a failure, not an empty success | T7 | T6 case 1 (now `Err`), T6 case 3 (a *zero*-exit no-candidate run is still `Ok(None)`) |
| A4 | Every line carries chat id / adapter id where in scope | Fields column; T7, T8, T9, T10, T11 | T3, T4, T5 assert level + reason; the Fields column and D2 fix where ids are absent, and T12's clippy/`fmt` pass is the compile-level check |
| A5 | Fallback title unchanged in all five modes | no task writes a title; T10's `else` branch is log-only | T3 cases 1–3 and T4 cases 1–2: title unchanged, no title write recorded, no `chat.updated` emitted. Modes #1, #2, #3, #6 all reach the call site as `None`, which is T3 case 3 |
| A6 | Rust unit tests via the lifecycle test double: unknown adapter id, no active chat cell, `None` outcome | — | T3 (no active chat cell, `None` outcome) + T5 (unknown adapter id — see D11: that branch does not exist behind the lifecycle double) |
| A7 | Stub-executable test for exit status; `finalize_title` tests stay green and unmodified | T7 | T6; T7's verify step asserts an empty `git diff` over the `finalize_title` region |
| A8 | Manual verification stated in the PR | — | T12 step 4 (the note handed to the orchestrator) |
| A9 | No silent catch or bare early return left on the title path | T7, T9, T10, T11 | T11's `rg` sweep over the three files |

**Test-coverage boundary (accepted limit).** Modes #3 (`adapter_has_no_title_model`) and #6 (`candidate_rejected`) are verified by their *returned value* — T6 case 5 asserts `CodexAdapter` (the one shipped adapter that uses the default body; only `mainframe-adapter-claude` overrides `Adapter::generate_title`) still returns `Ok(None)`, and T6 case 3 asserts a zero-exit unusable candidate still returns `Ok(None)` — plus review of the single added log line at each site. Neither has a *captured-log* assertion: capturing them would put the `LogCapture` helper into `mainframe-adapter-api`/`mainframe-adapter-claude`/`mainframe-adapter-codex` as well, making it a third and fourth copy and tripping the repo's "extract shared helpers at 3+ duplications" rule for a test-only utility. The brief's test criteria (A6, A7) do not ask for either. Recorded as a deliberate limit, not an oversight.

---

## Decisions taken by this plan

**D1 — the `no_title` envelope line is deliberate double-logging, kept at `debug`.** The brief says "every one of those outcomes emits exactly one daemon log line" and *also* says `do_generate_title`'s "`None` outcome at the call site" needs its own line. Those two cannot both hold: modes #1, #2, #3 and #6 log downstream, then return `None` to the call site. Resolution: the downstream line is the *reason* (`warn` where it is a genuine failure), the call-site line is the *envelope* (`debug`, carrying `chat_id` + `adapter_id`, which none of the downstream sites has). At the default `LOG_LEVEL=info` an operator sees exactly one line per failure (the two `warn` cases); the second line appears only at `debug`. The reviewer's alternative — a typed no-title outcome threaded through the seams so one owner logs once — is recorded and declined under "Review findings not adopted".

**D2 — `chat_id` is not threaded into the adapter-routing layer.** `ChatManagerDeps::generate_title(adapter_id, content, binary)` has no chat id, by design, and neither does `Adapter::generate_title(content, binary)`. The brief scopes the requirement to "the chat id **where it is in scope**", so modes #1, #2, #3 and #6 log without one; the operator correlates via the `no_title` envelope (#5), which fires on the same chat immediately after. Threading a chat id through two traits for a log field is not worth six impl changes.

**D3 — no shared reason-token module.** Brief decision, adopted: the seven tokens are string literals at their sites, in four crates. A shared `&'static str` module would add a cross-crate dependency for constants and buys only compile-time typo protection; the tests in T3–T6 assert the exact tokens, covering drift on every site a test reaches.

**D4 — the adapter does not log the non-zero exit itself; it returns it.** `generate_claude_title` folds the exit code and the truncated stderr into `AdapterError::Message`, and `chat_deps` logs it once as `adapter_error`. Logging in both places would produce two lines for one failure and split the operator's grep.

**D5 — a spawn failure gains the binary name.** Today a missing or unexecutable title binary surfaces as a bare `AdapterError::Io("No such file or directory (os error 2)")` naming nothing. This maps directly to the brief's load-bearing scenario — "an unauthenticated **or misconfigured** CLI" — because a `provider.<adapter>.titleBinary` pointing at a path that no longer exists is the most common misconfiguration, and the current message cannot tell the operator *which* binary failed. T7 wraps it as `failed to spawn title binary <binary>: <io error>`; T6 pins it.

**D6 — the external-session import path is in scope, with tests.** `external_session_service.rs::generate_import_title` is a second call site of the same `generate_title` seam and has the same two silent returns (disabled-by-setting, and `let Some(title) = … else { return }`). The brief's task list does not name it, but its acceptance criterion A9 is "no silent catch or bare early return remains on the title path". Round-1 review required tests if it stays; T4 adds them, at no extra cost because they reuse the same crate's `LogCapture` and the existing `SweepDeps` double.

**D7 — the daemon-side tests assert captured log events, not log strings.** The brief asks for assertions on "observable outcome (title unchanged, one event per case) rather than on log string formatting". An observability-only change whose tests ignore observability verifies nothing, so T3–T5 install a `tracing` capture layer and assert *(a)* exactly one captured event, *(b)* its level and its `reason` field value, *(c)* the title is unchanged and no `chat.updated` is emitted. No assertion touches message formatting or field ordering. Cost: `tracing-subscriber` as a **dev**-dependency of `mainframe-chat` and `mainframe-server` (already a workspace dependency, already linked into the daemon binary).

**D8 — the capture helper is defined twice, not shared across crates.** `mainframe-chat` gets it in its existing `#[cfg(test)] mod test_support` (used by both T3 and T4); `mainframe-server` gets a copy in the `chat_deps.rs` test module. Two definitions — the repo rule is "extract shared helpers at 3+". Sharing across crates would mean either a non-`cfg(test)` `pub mod` (dragging `tracing-subscriber` into a shipped lib) or a new cargo feature; neither is worth it.

**D9 — the new lifecycle tests live in a new child module, and the existing test module is not moved.** Round-1 review rejected the wholesale ~380-line move of `lifecycle_manager.rs`'s inline `mod tests` as unrelated churn; adopted. Instead T2 declares `#[cfg(test)] mod title_logging_tests;` next to the existing `mod tests` and widens the four doubles the new file reuses (`FakeDeps`, its constructors, `manager()`, `chat_over()`) from private to `pub(super)`. A sibling `#[cfg(test)]` child module of `lifecycle_manager` can then name them as `super::tests::FakeDeps` — no duplicated 120-line double, no move. `lifecycle_manager.rs` grows by two lines instead of shrinking by 380; its pre-existing 300-line-rule violation is left exactly as found, which is the correct scope for a bug fix.

**D10 — stderr is bounded at 1024 *characters*, not bytes.** Truncating UTF-8 bytes can split a code point; the capture is `String::from_utf8_lossy(&stderr).trim()`, then `.chars().take(1024)`, with a trailing `…` when the source was longer.

**D11 — the unknown-adapter test lives in the routing layer, not behind the lifecycle double.** The brief's A6 says all three daemon-side cases use "the existing lifecycle dependency test double". That is not achievable for the unknown-adapter case: the branch exists only in `DaemonChatDeps::generate_title` (`mainframe-server`), and `FakeDeps::generate_title` returns `None` directly without consulting any registry, so a lifecycle-level "unknown adapter" test would assert nothing that T3 case 3 does not already assert. T5 therefore drives the real routing layer via the existing `test_deps()` harness (which already builds an empty `AdapterRegistry`), and the fallback-retention half of that mode is covered structurally by T3 case 3 (any `None`, whatever its cause, leaves the title alone).

---

## Task graph

```
G1 (test)  T1 → T2 → T3 → T4 → T5 → T6
G2 (core)  T7 → T8                        # turns T6 green
G3 (core)  T9 → T10 → T11 → T12           # turns T5, T4, T3 green; changeset + sweep
```

Strictly sequential, end to end: every task compiles Rust in the same cargo workspace, and the target-dir lock forbids concurrency. **No group is parallel-safe.**

**Red/green status of each G1 task, precisely** (a test that is green when the plan says red is asserting the wrong thing — stop and fix the test, not the plan):

| Task | Expected before G2/G3 |
|---|---|
| T1 | **green** — helper plus its own self-test |
| T2 | **green** — visibility widening and double extensions only |
| T3 | **red** — all three cases (zero captured events today) |
| T4 | **red** — both cases (zero captured events today) |
| T5 | **red** — the event assertion fails; the `is_none()` half already passes |
| T6 | cases 1, 2, 4 **red**; cases 3 and 5 **green** (regression pins — case 3 for A3's converse, case 5 for mode #3's return value) |

### File-collision map

| File | Tasks | Order |
|---|---|---|
| `crates/mainframe-chat/Cargo.toml` | T1 | T1 only |
| `crates/mainframe-chat/src/test_support.rs` | T1 | T1 only |
| `crates/mainframe-chat/src/lifecycle_manager.rs` | T2 (mod decl + `pub(super)`), T10 (impl) | T2 → T10 |
| `crates/mainframe-chat/src/lifecycle_manager/title_logging_tests.rs` (new) | T3 | T3 only |
| `crates/mainframe-chat/src/external_session_service.rs` | T4 (tests mod), T11 (impl) | T4 → T11 |
| `crates/mainframe-server/Cargo.toml` | T5 | T5 only |
| `crates/mainframe-server/src/chat_deps.rs` | T5 (`mod scan_loaded_history_tests`), T9 (impl) | T5 → T9 |
| `crates/mainframe-adapter-claude/tests/title_generation.rs` (new) | T6 | T6 only |
| `crates/mainframe-adapter-codex/src/adapter.rs` (`mod tests`, case 5 only) | T6 | T6 only |
| `crates/mainframe-adapter-claude/src/title_generator.rs` | T7 | T7 only |
| `crates/mainframe-adapter-api/src/adapter.rs` | T8 | T8 only |
| `.changeset/*.md` | T12 | T12 only |

---

## G1 — tests (kind: test)

### T1 — log-capture helper in `mainframe-chat`'s test support

**Files:** `crates/mainframe-chat/Cargo.toml`, `crates/mainframe-chat/src/test_support.rs` (already `#[cfg(test)] mod test_support;`, `lib.rs:38`).

1. Add to `[dev-dependencies]` in `crates/mainframe-chat/Cargo.toml`:
   ```toml
   tracing-subscriber = { workspace = true }
   ```
2. Add a `LogCapture` helper to `test_support.rs` (keep it under ~40 lines):
   - A `Layer` impl over `tracing_subscriber::registry()` whose `on_event` pushes `(Level, Option<String> /* the `reason` field */)` into an `Arc<Mutex<Vec<_>>>`. Read `reason` with a small `tracing::field::Visit` impl matching `field.name() == "reason"` in `record_str` **and** `record_debug` (a `&'static str` field may arrive through either, depending on the call form).
   - `LogCapture::new()` returns `(impl Subscriber, Arc<Mutex<Vec<(Level, Option<String>)>>>)`, plus a `fn events_with_reason(&…) -> Vec<(Level, String)>` convenience that drops events carrying no `reason` (other daemon logging must not perturb the counts).
   - Usage inside a `#[tokio::test]`: `let (sub, events) = LogCapture::new(); let _guard = tracing::subscriber::set_default(sub);` — `#[tokio::test]` runs a current-thread runtime and neither `do_generate_title` nor `generate_import_title` spawns a task, so the thread-local dispatcher covers everything awaited in the test body. **Do not** use `set_global_default` (process-wide; it would fight parallel tests).
   - Doc comment must state the `set_default` + no-spawn requirement, so a future test that adds a `tokio::spawn` knows why its events vanished.
3. Add one self-test in `test_support.rs`: emit `tracing::debug!(reason = "probe", "x")` under the guard and assert one captured `(Level::DEBUG, "probe")`. This proves the harness before any production line depends on it.

**Verify:** `cargo test -p mainframe-chat log_capture` — green. `cargo clippy -p mainframe-chat --all-targets -- -D warnings` clean.

### T2 — widen the lifecycle doubles and declare the new test module

**File:** `crates/mainframe-chat/src/lifecycle_manager.rs` (inline `mod tests` starts at line 969).

1. Add, directly above the existing `#[cfg(test)] mod tests {`:
   ```rust
   #[cfg(test)]
   mod title_logging_tests;
   ```
2. In the existing `mod tests`, change the visibility of exactly the four items the new module reuses — `struct FakeDeps` (and the fields `events` and the new `title_updates`), its constructors (`new`, `build`), `fn manager(...)`, and `fn chat_over(...)` — from private to `pub(super)`. Nothing else changes visibility.
3. Extend `FakeDeps`:
   - `pub(super) title_updates: Mutex<Vec<String>>`, initialised in `build`. `chats_update` (currently an empty body) pushes `title.clone()` **only** when `patch.title.is_some()`, so unrelated lifecycle updates do not pollute assertions.
   - `disabled: bool` (default `false`) plus a `pub(super) fn title_disabled(chat: Chat) -> Arc<Self>` constructor. `settings_get` currently returns `None` unconditionally; make it match on the `(namespace, key)` pair — return `Some("true")` for `("general", "titleGeneration.disabled")` when `disabled` is set, `None` otherwise. Do **not** return a blanket `Some("true")`: the same method also answers `provider.<adapter>.titleBinary`.

**Verify:** `cargo test -p mainframe-chat lifecycle_manager` — the pre-existing lifecycle tests stay green (none asserts on titles or settings). `cargo fmt`; `cargo clippy -p mainframe-chat --all-targets -- -D warnings`.

### T3 — lifecycle title tests (red)

**File:** `crates/mainframe-chat/src/lifecycle_manager/title_logging_tests.rs` (new). Header: `use super::tests::{FakeDeps, chat_over, manager};` plus `use crate::test_support::LogCapture;`.

Three `#[tokio::test]`s. Each installs a `LogCapture` guard, calls `mgr.do_generate_title("c1", "some first message").await`, and asserts **exactly one** captured reason-bearing event with the expected level and token, **plus** the invariants below.

1. `evicted_chat_logs_chat_not_active_and_leaves_the_title_alone` — nothing inserted into `mgr.active_chats`. Expect one `(DEBUG, "chat_not_active")`; `deps.title_updates` empty; `deps.events` contains no `DaemonEvent::ChatUpdated`.
2. `disabled_setting_logs_disabled_by_setting` — insert an active chat whose `chat.title` is `Some("Fallback Title".into())`, built through `FakeDeps::title_disabled`. Expect one `(DEBUG, "disabled_by_setting")`; the cell's `chat.title` still `Some("Fallback Title")`; `title_updates` empty; no `ChatUpdated`.
3. `none_outcome_logs_no_title_and_keeps_the_fallback` — active chat with `chat.title = Some("Fallback Title")`, `FakeDeps::generate_title` returning `None` (its current behaviour). Expect one `(DEBUG, "no_title")`; the cell's title unchanged; `title_updates` empty; no `ChatUpdated`.

Test 3 is also the fallback-retention cover for modes #1, #2, #3 and #6: all four reach this call site as `None`, so "a `None` of any origin leaves the title alone" is proven once here (A5). It does **not** cover those modes' reason tokens — those are T5, T6 and the boundary note above.

**Verify:** `cargo test -p mainframe-chat title_logging` — all three **fail** (zero captured events today). Paste the failure output into the task handoff.

### T4 — external-import title tests (red)

**File:** `crates/mainframe-chat/src/external_session_service.rs`, `#[cfg(test)] mod tests` (starts ~line 458).

1. Extend the existing `SweepDeps` double: add `title_disabled: bool` (branch on the `("general", "titleGeneration.disabled")` pair in `settings_get`, as in T2) and `title_updates: StdMutex<Vec<String>>` recorded by `chats_update` when `updates.title.is_some()`. Its `generate_title` already returns `None`. Leave `emit_event` recording events (add an `events: StdMutex<Vec<DaemonEvent>>` field — today it discards them).
2. Two `#[tokio::test]`s driving the private `generate_import_title(&deps, &mut chat, "first message", "claude").await` with `chat.title = Some("Fallback Title".into())`, each under a `LogCapture` guard:
   - `import_with_title_generation_disabled_logs_and_keeps_the_title` — expect one `(DEBUG, "disabled_by_setting")`; `chat.title` unchanged; `title_updates` empty; no `ChatUpdated` recorded.
   - `import_with_no_title_logs_no_title_and_keeps_the_title` — expect one `(DEBUG, "no_title")`; same three invariants.

**Verify:** `cargo test -p mainframe-chat import_with_` — both **fail** (zero captured events today).

### T5 — unknown-adapter test in the routing layer (red)

**Files:** `crates/mainframe-server/Cargo.toml`, `crates/mainframe-server/src/chat_deps.rs`. The crate's only test module is `#[cfg(test)] mod scan_loaded_history_tests` (line 1099) — there is **no** `mod tests` here, and `fn test_deps()` (line 1294) is private inside `scan_loaded_history_tests`. Both the helper and the new test go **inside that module**; do not add a second test module and do not widen `test_deps`.

1. Add `tracing-subscriber = { workspace = true }` to `[dev-dependencies]` in `crates/mainframe-server/Cargo.toml`.
2. Copy the `LogCapture` helper into `mod scan_loaded_history_tests` (second and final copy — D8). Add a one-line comment pointing at its twin in `mainframe-chat`'s `test_support.rs` and at D8's reason for not sharing it.
3. In the same module, add `#[tokio::test] async fn unknown_adapter_id_logs_and_returns_none`: build `test_deps()` (it already constructs an empty `AdapterRegistry::new()`), install the capture guard, call
   `ChatManagerDeps::generate_title(&deps, "not-a-real-adapter", "hello", "claude").await`,
   and assert the result is `None` **and** exactly one captured `(Level::WARN, "unknown_adapter")`.

**Verify:** `cargo test -p mainframe-server unknown_adapter_id_logs` — **fails** on the event assertion. `cargo clippy -p mainframe-server --all-targets -- -D warnings` clean.

### T6 — adapter exit-status tests (mostly red)

**Files:** `crates/mainframe-adapter-claude/tests/title_generation.rs` (new integration test; `title_generator` is a `pub mod`, so `generate_claude_title` is reachable as `mainframe_adapter_claude::title_generator::generate_claude_title`) — cases 1–4; and `crates/mainframe-adapter-codex/src/adapter.rs`'s existing `#[cfg(test)] mod tests` (line 313) — case 5.

Header, mirroring `crates/mainframe-adapter-codex/tests/list_models.rs:8-9`:
```rust
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]
```
Use `tempfile::tempdir()`, write a `/bin/sh` stub, `set_mode(0o755)`, and pass its absolute path as the `binary` argument with `path = "/usr/bin:/bin"`. Four cases:

1. `nonzero_exit_surfaces_the_status_and_the_cli_stderr` (**red**) — stub: `printf 'Invalid API key · Please run /login\n' >&2; exit 1`. Assert `Err(_)` whose `to_string()` contains both the exit code `1` and `Invalid API key`.
2. `chatty_stderr_is_truncated_at_the_character_cap` (**red**) — stub emits, in order: `HEAD-MARKER`, then ~64 KiB of a multibyte character (`é`), then `TAIL-MARKER`, all to stderr, then `exit 1`. Assert the error text (a) contains `HEAD-MARKER`, (b) does **not** contain `TAIL-MARKER`, (c) contains the `…` truncation marker, (d) has `chars().count() < 1200` (1024-char cap plus the surrounding message), and (e) contains no U+FFFD replacement character — a byte-sliced truncation of `é` would produce one, so this is the multibyte-safety assertion for D10.
3. `zero_exit_with_unusable_stdout_is_still_ok_none` (**green today — a regression pin**) — stub: `printf 'a\n'`, exit `0`. Assert `Ok(None)`: a successful run that produced no usable candidate must not become an error.
4. `spawn_failure_names_the_binary` (**red**) — pass a path inside the tempdir that does not exist. Assert `Err(_)` whose message contains that path (D5).

Case 5 lives in the codex crate instead, because that is where the default body is actually exercised (`mainframe-adapter-claude` is the only crate that overrides `Adapter::generate_title`):

5. `default_generate_title_returns_no_title` (**green today — a regression pin for mode #3**) — in `crates/mainframe-adapter-codex/src/adapter.rs`'s `mod tests`, a `#[tokio::test]` asserting `CodexAdapter::default().generate_title("hello".into(), "codex".into()).await` is `Ok(None)`. `Adapter` is already in scope there via `use super::*`, and `tokio` is a full-feature dependency of the crate, so `#[tokio::test]` needs no `Cargo.toml` change. This pins that T8's added log line does not change the returned value.

**Verify:** `cargo test -p mainframe-adapter-claude --test title_generation` — cases 1, 2 and 4 fail; 3 passes. `cargo test -p mainframe-adapter-codex default_generate_title` — passes.

---

## G2 — adapter crate (kind: core)

### T7 — capture stderr, honour the exit status, log the rejected candidate

**File:** `crates/mainframe-adapter-claude/src/title_generator.rs` (118 lines; must stay ≤300, and every function ≤50 lines).

1. `.stderr(Stdio::null())` (line 48) → `.stderr(Stdio::piped())`.
2. In the `match tokio::time::timeout(...)` block, replace `Ok(res) => res?` with an arm that maps the io error to
   `AdapterError::Message(format!("failed to spawn title binary {binary}: {err}"))` (D5). The timeout arm keeps its current `AdapterError::Message("claude title generation timed out")` verbatim.
3. Replace the trailing `Ok(finalize_title(&String::from_utf8_lossy(&output.stdout)))` with a call to a new private helper, so `generate_claude_title` stays under 50 lines:
   ```rust
   fn interpret_output(output: std::process::Output, binary: &str) -> Result<Option<String>, AdapterError>
   ```
   - Non-zero (or signal-terminated) status → `Err(AdapterError::Message(format!("claude title generation exited with {status}: {stderr}")))`, where `status` is `output.status.code()` rendered as the code or the literal `unknown` when the process was signalled, and `stderr` is `truncate_stderr(&output.stderr)`. When stderr is empty, substitute the literal `<no stderr>` so the line still reads as a diagnosis.
   - Success → decode + `trim()` stdout once, keep its `chars().count()` as `candidate_chars` (the definition fixed in the log contract), then `finalize_title(...)`. When that returns `None`, emit
     `tracing::debug!(adapter_id = "claude", reason = "candidate_rejected", binary, candidate_chars, "title generation skipped")` before returning `Ok(None)`. Log the count, never the model text.
4. Add `fn truncate_stderr(raw: &[u8]) -> String`: `String::from_utf8_lossy(raw)`, `.trim()`, then `.chars().take(1024)`, appending `'…'` only when the source was longer (D10). Character-based by construction, so no code point can be split.
5. Update the file's trailing `// PORT STATUS:` note: the `maxBuffer` line ("unbounded read is safe") is now wrong for stderr — replace it with a line stating stderr is piped and capped at 1024 chars, and that a non-zero exit is an error rather than an empty result.

Do **not** touch `finalize_title` or its two existing unit tests (brief requirement A7: they stay green and unmodified).

**Verify:**
- `cargo test -p mainframe-adapter-claude --test title_generation` — all four cases green.
- `cargo test -p mainframe-adapter-claude title_generator` — the two pre-existing `finalize_title` tests green; `git diff` over the `finalize_title` fn and its `mod tests` block is empty.
- `wc -l crates/mainframe-adapter-claude/src/title_generator.rs` ≤ 300; no function over 50 lines.
- `cargo fmt`; `cargo clippy -p mainframe-adapter-claude --all-targets -- -D warnings`.

### T8 — the default "no title model" implementation announces itself

**File:** `crates/mainframe-adapter-api/src/adapter.rs`, `Adapter::generate_title` default body (lines 220–227).

Replace the body's `let _ = (content, binary); Box::pin(async { Ok(None) })` with a version that first emits
`tracing::debug!(adapter_id = self.id(), reason = "adapter_has_no_title_model", "title generation skipped")`,
keeps the `let _ = (content, binary);` discard, then returns `Box::pin(async { Ok(None) })`. Log **outside** the async block so nothing borrows `self` into the returned future. Extend the doc comment: the default is expected (Codex today), it fires once per attempt at `debug`, and it is what distinguishes "no title model" from "tried and failed".

`tracing` is already a dependency of `mainframe-adapter-api`; no `Cargo.toml` change.

**Verify:** `cargo test -p mainframe-adapter-api`; `cargo clippy -p mainframe-adapter-api --all-targets -- -D warnings`; `cargo test -p mainframe-adapter-codex default_generate_title` — T6 case 5 still green, proving the added log line did not change the returned value for the one shipped adapter that relies on this default.

---

## G3 — daemon sites + changeset (kind: core)

### T9 — log both routing outcomes

**File:** `crates/mainframe-server/src/chat_deps.rs`, `ChatManagerDeps::generate_title` (lines 572–591).

1. The registry lookup already happens **synchronously**, before `Box::pin` (`let adapter = self.adapters.get(adapter_id);`), so log there and drop the `let adapter = adapter?;` line inside the async block:
   ```rust
   let Some(adapter) = self.adapters.get(adapter_id) else {
       tracing::warn!(adapter_id, reason = "unknown_adapter", "title generation skipped");
       return Box::pin(async { None });
   };
   ```
   No clone needed on this arm — it never enters the future.
2. The existing error arm keeps its `warn` but gains context:
   `tracing::warn!(%err, adapter_id, reason = "adapter_error", "title generation failed")`. This arm *is* inside the `move` future, so clone `adapter_id` into the block alongside the existing `content`/`binary` clones. `%err` is what carries T7's exit code + truncated stderr into the log (A2) — do not replace it with a summary.
3. Update the leading comment: it currently explains only the "adapter has no `generateTitle`" case; state that an unregistered adapter id and an adapter error are now distinguishable in the log.

**Verify:** `cargo test -p mainframe-server unknown_adapter_id_logs` — green (T5 flips). `cargo fmt`; `cargo clippy -p mainframe-server --all-targets -- -D warnings`.

### T10 — log the three lifecycle outcomes

**File:** `crates/mainframe-chat/src/lifecycle_manager.rs`, `do_generate_title` (line 753). Add `debug` to the `use tracing::{info, warn};` import.

1. `let Some(cell) = self.get_active(chat_id) else { return; }` → log
   `debug!(chat_id, reason = "chat_not_active", "title generation skipped")` before returning. Keep a one-line rationale that this is reachable because the task is spawned and races chat eviction.
2. **Move the `adapter_id` read above the disabled-by-setting check** (it only reads the already-held cell, so the reorder is free), then log
   `debug!(chat_id, adapter_id = %adapter_id, reason = "disabled_by_setting", "title generation skipped")` on that return. Without the reorder the line would lack the adapter attribution the log contract promises.
3. The `if let Some(title) = …` at the call site gains an `else` that logs
   `debug!(chat_id, adapter_id = %adapter_id, reason = "no_title", "title generation produced no title")`. Nothing else in the `else` — the deterministic title is already in place and must not be touched.

**Verify:** `cargo test -p mainframe-chat title_logging` — T3's three tests green. `cargo test -p mainframe-chat lifecycle_manager` — all pre-existing tests green. `cargo fmt`; `cargo clippy -p mainframe-chat --all-targets -- -D warnings`.

### T11 — close the external-session import path (D6)

**File:** `crates/mainframe-chat/src/external_session_service.rs`, `generate_import_title` (line ~339). Add `debug` to the existing `use tracing::{info, warn};`.

1. The `titleGeneration.disabled` early return → `debug!(chat_id = %chat.id, adapter_id, reason = "disabled_by_setting", "title generation skipped")`.
2. `let Some(title) = deps.generate_title(...) else { return; }` → log
   `debug!(chat_id = %chat.id, adapter_id, reason = "no_title", "title generation produced no title")` before returning.

**Verify:**
- `cargo test -p mainframe-chat import_with_` — T4's two tests green.
- `cargo test -p mainframe-chat` — whole crate green.
- Leftover sweep (A9): `rg -n 'return;|else \{ *return' crates/mainframe-chat/src/lifecycle_manager.rs crates/mainframe-chat/src/external_session_service.rs crates/mainframe-server/src/chat_deps.rs` — every hit inside a title function must be preceded by a log line.

### T12 — changeset, full sweep, PR note

**Files:** `.changeset/title-generation-observability.md` (new).

1. `pnpm changeset --empty`, rename the generated file to `.changeset/title-generation-observability.md`, and add a body under the empty frontmatter — Rust-only daemon changes take no package bump, matching `.changeset/automations-v2-rust-engine.md`. Body (plain prose, no bullets, naming the five modes):
   > Title generation now leaves evidence when it gives up. A chat still falls back to the deterministic title taken from its first message, but each of the five ways the model-generated title can fail — the CLI exiting non-zero, an unknown adapter, an adapter with no title model, a chat closed before the title arrived, and a reply that fails the length check — now writes a daemon log line naming the reason. The CLI's own error output is captured (capped at 1 KB) instead of discarded, and a non-zero exit is treated as a failure rather than as an empty title.
2. Full gate run from `packages/core-rs/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `tools/verify-gate.sh`. All four must pass.
3. Confirm this plan is tracked: `git ls-files docs/plans/2026-07-27-todo-287-title-generation-logging-plan.md` prints the path (it was added with `git add -f` — `docs/plans/` is gitignored).
4. Hand the orchestrator the **manual-verification note** for the PR body (A8), to be run before the PR is opened:
   > Set `provider.claude.titleBinary` to a CLI that exits non-zero (a shell script that prints to stderr and exits 1), start the daemon, and send a first message in a new chat. Expected at the default `LOG_LEVEL=info`: the chat keeps its truncated fallback title, and the daemon log contains exactly one line — `title generation failed` with `reason=adapter_error`, quoting the exit status and the script's stderr. Re-run with `LOG_LEVEL=debug` and a second, `debug`-level `reason=no_title` line appears for the same chat: that is the call-site envelope described in the plan's D1, not a duplicate failure.

**Verify:** the four gate commands above, plus `git status --short` showing only this PR's files.

---

## Out of scope (from the brief, restated so no task drifts)

- The deterministic fallback title's format and truncation rule (`derive_title_from_message`).
- #257's mobile-origin title symptom — this change only makes it leave evidence.
- Adding a title implementation to any adapter that lacks one, or changing which binary is used for titles.
- Retries, backoff, or any user-visible surface for title failure.
- The accept/reject thresholds in `finalize_title`.

## Review findings not adopted

**Round-1 finding 2 — "replace D1's deliberate double logging; introduce a typed no-title outcome propagated through the title-generation seams so each attempt has one distinct reason and one logging owner."** Not adopted. It contradicts the brief on two settled points: the "Key interfaces" list explicitly requires that "`LifecycleManager::do_generate_title` — the no-active-chat early return **and the `None` outcome at the call site** each need a log line", and the brief's decisions answer "Is a shared helper warranted for the five log sites? → recommended: **no** — they live in three crates with different context in scope". A typed outcome threaded through `ChatManagerDeps::generate_title`, `ExternalSessionDeps::generate_title`, `LifecycleManagerDeps::generate_title` and `Adapter::generate_title` would change four trait signatures, six impls and three test doubles — a refactor the brief declined — and would still not let the call site name the adapter-internal reasons without a new public error taxonomy. Mitigation instead of restructuring: the envelope is `debug`, so the default `info` level shows exactly one line per failure, and T12's manual note tells the operator what the second `debug` line is. **Carried to the orchestrator as an unresolved disagreement.**

**Round-1 finding 3 (partial) — "expand tests to cover all five distinct modes end-to-end", specifically adding captured-log tests for T8's default impl and T7's `candidate_rejected`.** Partially adopted: the AC matrix and the "Test-coverage boundary" note now state exactly which modes are log-asserted and which are value-asserted, so nothing is silently untested. Not adopted: the two extra captured-log tests, which would require the `LogCapture` helper in `mainframe-adapter-api` and `mainframe-adapter-claude` — a third and fourth copy, tripping the repo's "extract shared helpers at 3+ duplications" rule for a test-only utility, to cover two `debug` lines that the brief's test criteria (A6, A7) do not ask for.

## Open risks

1. **The `no_title` envelope doubles up with the specific reason** (D1, above). Accepted deliberately; both extra lines are `debug`, so production at the default `info` level sees only the two `warn` cases.
2. **`tracing-subscriber` as a dev-dependency in two crates** (D7). It is already a workspace dependency and already linked into `mainframe-daemon`, so this adds no shipped weight — but it is the one dependency change in this PR.
3. **Every codex chat's first message now emits a `debug` line** (#3). Intended by the brief's decision; invisible at the default log level.
4. **`pub(super)` on the lifecycle test doubles** (D9) couples the new `title_logging_tests` module to the existing `mod tests`. If a later change moves that module, both files move together.
