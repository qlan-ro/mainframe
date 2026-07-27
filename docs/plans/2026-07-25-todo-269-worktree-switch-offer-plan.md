# Implementation plan — worktree switch offer (todo #269)

Spec: `docs/specs/2026-07-25-todo-269-worktree-switch-offer.md` (commit `dd086e54`).
Design gate: variant B, `proto/design-gates` @ `cee842ef`, `packages/ui/src/prototypes/worktree-switch/{VariantB,offer,stub}.tsx`.
Worktree: `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-269-worktree-switch-offer`, branch `todo/269-worktree-switch-offer`.

## Goal

When an agent registers a new git worktree mid-session, the daemon notices and offers to move the session into it. A confirmed, non-error `Bash` tool call whose command mentions `worktree` (or a Claude `EnterWorktree` call) triggers a rescan of `git worktree list`; any registered worktree that is new since the chat's activation baseline, and that passes five eligibility gates, becomes a pending **switch offer** broadcast to that chat's subscribers. The UI renders pending offers as a banner pinned above the composer with load-bearing restart-warning copy. Accepting rebinds the chat through the existing attach machinery — stop the CLI, relocate Claude session files from the chat's *current* effective directory, persist `worktreePath`/`branchName`, restart with `--resume` — and the binding change (not the route) is the single source of the `resolved{accepted}` event. Declining records the canonical path in a new daemon-internal `chats` column so it never prompts again. Everything is additive: three WS event arms, two chat-scoped routes, one DB column.

## Architecture decisions (made here; the spec left the seam open)

Each of these resolves a question the spec named but did not answer at the code level. Implementers must not re-litigate them.

**A1 — `attach_worktree` is generalized, not forked.** `config_manager.rs:450`'s `if has_worktree { return Ok(()) }` becomes `if current_worktree.as_deref() == Some(worktree_path) { return Ok(()) }`, and the Claude session-file source becomes the chat's *current effective directory* (`current_worktree.unwrap_or(project.path)`) instead of always the project root. **Why not a sibling method:** the composite is `stop_chat` → `move_session_files` → `apply_worktree_update` → `start_chat`, ~45 lines; a sibling would duplicate all of it to change one guard, and spec ruling 11 explicitly chose "extend the attach path rather than add a parallel one". The only behavior lost is the accidental idempotence of "attach a worktree'd chat to a *different* worktree is a silent no-op" — which is the bug.

**A2 — detection is main-thread-only; subagent tool blocks are not hooked.** Claude's adapter diverts every block carrying `parent_tool_use_id` to `on_subagent_child` (`assistant_event.rs:72-82`, `user_event.rs:278`) before `on_message`/`on_tool_result` run, so a `git worktree add` inside a subagent is invisible to the stash/confirm pattern. The spec accepted this ("Known latency gap, accepted", §Detection). We honor it: **do not** add a hook to `on_subagent_child`. The coarse rescan means the next top-level trigger picks the worktree up, and the offer identity is the path, so nothing is lost but latency. Recorded as a limitation in the module doc comment.

**A3 — the three events are chat-scoped.** The banner lives inside one chat's composer footer, so `fanout` (`websocket.rs:648-677`) gating them to that chat's subscribers is exactly right. **Do not** add them to `CONNECTION_GLOBAL_EVENT_TYPES` (`websocket.rs:51`, `[&str; 3]` — its length is in the type) and **do not** touch the `broadcastScoping` prose in `docs/rust-port/CONTRACT/ws-events.json:47`. That whole file is a frozen Phase-0 snapshot of the retired Node daemon's contract, regenerated only by the orphaned `packages/core/scripts/extract-contract.mjs`; post-cutover events do not belong in it. Leave it untouched.

**A4 — the registry is chat-crate-local, so the sink callback needs no server-side plumbing.** `WorktreeOfferRegistry` is a field on `ChatManager`, so `EhDeps` (`chat_manager.rs:405-467`) holds an `Arc<WorktreeOfferRegistry>` directly and implements the new `EventHandlerDeps` method against it. The `ChatManagerDeps` → `DaemonChatDeps` reach-through is needed **only** for the two DB methods (dismissed set), which follow the `add_plan_file` chain verbatim. Same for `ConfigManagerDeps::on_binding_changed` — `CmDeps` (`chat_manager.rs:665-732`) holds the registry directly.

**A5 — the accept composite lives on the `ChatManager` facade, not inside the registry.** The registry would otherwise need `Arc<ChatConfigManager<CmDeps>>`, while `CmDeps` needs the registry — a construction cycle in `ChatManager::new`. Instead `ChatManager::accept_worktree_offer` orchestrates: registry validates + claims the switch guard → `self.config.attach_worktree(...)` → guard released → on error the offer stays pending. Construction order in `ChatManager::new` becomes `deps` → `active_chats` → `worktree_offers` → `EhDeps`/`LcDeps`/`CmDeps`. This matches the existing facade style (`ChatManager::attach_worktree`, `chat_manager.rs:1551`).

**A6 — the switch guard lives *only* in the registry; `Guards` is not extended.** The registry's `ChatOffers.switching: Option<String>` (Task 7) already holds the in-flight target per chat, so `claim_accept`/`release_accept` are the whole guard. Rejected alternative: a fourth `switching: HashMap<String, Arc<Notify>>` on `Guards` (`lifecycle_manager.rs:143-148`) for symmetry with `loading`/`starting`/`interrupting` — it would be a second copy of the same truth, acquired and released on different lines (drift risk), wrapping a `Notify` that nothing ever awaits. `join_flight` (`:157-172`) exists to *await* an in-flight operation; the spec requires accept to fail 409 rather than wait, so there is no awaiter and no reason to reach into `Guards` at all. `lifecycle_manager.rs` is therefore untouched except for the baseline-seeding dep (Task 10).

**A7 — `refs/heads/` gets one helper.** The registry adds a third Rust stripping site, so extract `short_branch(&str) -> &str` into `mainframe-services/src/workspace/worktree.rs` next to `parse_worktree_list` and route `routes/worktree.rs:267` through it. It returns `&str`, not `Option<&str>`: detachedness is already carried by `WorktreeEntry.branch: Option<String>`, so the helper only ever sees a ref that exists. That site currently uses `.replace("refs/heads/", "")` (replace-all), which mangles a branch like `feat/refs/heads/x`; the helper's `strip_prefix` is strictly correct. The two TS sites (`WorktreePopover.tsx:141`, `WorktreeExistingTab.tsx:87`) stay as-is — two duplications is below the 3+ threshold and they are legacy `'detached'`-literal paths outside this feature.

**A8 — the popover's legacy `'detached'` literal is left alone.** Spec ruling 16 makes the *accept route* persist `branchName = null` for a detached worktree. `WorktreePopover.tsx:141` sends the string `'detached'`, and Task 18 keeps that surface's existing `handleAttach` unchanged. The two paths therefore disagree for detached worktrees. This is deliberate: changing the popover would alter a shipped surface's persisted data for a case the spec did not scope. Recorded, not fixed.

**A9 — new route file, not `routes/worktree.rs`.** That file is already 425 lines. The two new routes go in `routes/worktree_offer.rs`, registered in `routes/mod.rs` and `.merge`d in `http.rs` next to `routes::worktree::router()`.

**A10 — every path compared inside the registry is canonicalized first.** `scan` (Task 5) is a pure string comparator; it does **not** canonicalize. The registry canonicalizes all four path sources before building `ScanInputs` — the `git worktree list` output, `project.path`, the chat's own `worktree_path`, and every other chat's `worktree_path`. Canonicalizing only the git output would break the "not the chat's own binding" and "not another chat's worktree" gates on macOS the moment a path involves `/tmp` → `/private/tmp` or any symlinked checkout, and the chat would be offered the worktree it is already sitting in (spec AC 5 requires canonical compare).

## Verifications the spec asked the plan to perform

**Codex needs no session relocation on cwd rebind — confirmed, and the existing `adapter == "claude"` gate is already correct.** Codex rollouts are keyed by date + thread UUID under a flat `~/.codex/sessions` root (`mainframe-adapter-codex/src/external_sessions.rs:84`, filename `rollout-<ts>-<uuid>.jsonl`), looked up from Codex's own `~/.codex/state_5.sqlite` `rollout_path` column (`thread_registry.rs:19-25`), and resumed purely by `threadId` (`session.rs:440-452`). No path component derives from cwd. The fresh cwd is re-sent on every resume (`session.rs:446`) and the child is respawned with `current_dir(project_path)` (`session.rs:333-335`), which lifecycle computes as `worktree_path.unwrap_or(project_path)` (`lifecycle_manager.rs:895`). Relocation would in fact be *harmful*: `rollout_reader.rs:121-133` and `transcript.rs:52-61` reject any rollout path outside `~/.codex/sessions`, and moving files would desync the externally-owned `state_5.sqlite`. `config_manager.rs:461-473` already gates the move on `adapter == "claude"`, so Task 9 leaves that gate exactly as-is. Known cosmetic consequence, unchanged by this feature: a rebound Codex rollout keeps its original `session_meta.cwd`, so it keeps listing under the old path in the external-session importer (`external_sessions.rs:368-371`).

**The queued-message mirror re-syncs on restart — confirmed; no queue handling is needed (spec ruling 23).** The mirror is cleared by the CLI-exit path, not by the restart path: when the child dies, `event_handler.rs:909` fires `on_queued_cleared`, which `EhDeps` (`chat_manager.rs:418-420`) routes to `clear_all_queued_for_chat`, emptying `queued_refs` for that chat; `:905-907` emits `MessageQueuedCleared` so connected clients drop their pills. Since `attach_worktree` stops the chat before restarting it, the restarted CLI (which has an empty queue) and the daemon mirror (now empty) agree. Nothing in this feature touches queued messages, and Task 9 adds no queue code.

## Constraints that bind every task

- **Rust:** Axum 0.8 (`{id}` path params); house `parse_body` (`routes/projects.rs`) + `ok`/`ok_empty`/`fail` (`respond.rs`); first-failing-issue validation messages mirroring Zod; `std::sync::Mutex` unlocked with `.unwrap_or_else(|e| e.into_inner())`, guard dropped before any `.await`; no `console`/`println` — `tracing`; every new dep-trait method that services can back gets a **default body** so tests override and no impl site is forced to change.
- **Functions ≤ 50 lines everywhere.** New TS/TSX files ≤ 300 lines. Existing `core-rs` modules routinely exceed 300 (`chat_manager.rs` 2180, `event_handler.rs` 1915); new Rust modules should still land under ~300 and split rather than grow (Task 5/7 are split for exactly this reason).
- **Canonical types once** in `packages/types`, mirrored in `core-rs/crates/mainframe-types`.
- **`data-testid` on every interactive element**, kebab-case, keyed by the offer's canonical path (never array index).
- **Tests required** for new routes, DB methods, and core logic. Prefer single-file vitest runs: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`.
- **Do not run `pnpm install`** — the mobile submodule is absent from this worktree and a full install strips its lockfile entry.
- Comments say *why*, not *what*. No dead code, no deferred cleanups.

---

## Task 1 — Canonical `WorktreeSwitchOffer` type and three `DaemonEvent` arms

**Implementer:** core-dev

The two-chain lockstep. A new event arm touches five places; miss one and either the golden fixture sweep or the TS union drifts.

**Files:**
- `packages/types/src/worktree-offer.ts` (new) — model on `packages/types/src/background-task.ts`. Exactly the spec's shape, no `source` field:
  ```ts
  export interface WorktreeSwitchOffer {
    chatId: string;
    worktreePath: string;      // canonical absolute path — the offer's identity
    branchName: string | null; // short name (refs/heads/ stripped); null when detached
    detectedAt: number;        // epoch ms; orders the multi-offer list
  }
  export type WorktreeOfferOutcome = 'accepted' | 'dismissed' | 'expired';
  ```
- `packages/types/src/index.ts:19` — add `export * from './worktree-offer.js';` alongside `background-task.js`.
- `packages/types/src/events.ts` — three arms in the `DaemonEvent` union, after the `message.queued.*` block (`:62`) or next to `chat.prDetected` (`:79`):
  ```ts
  | { type: 'worktree.offer.raised'; chatId: string; offer: WorktreeSwitchOffer }
  | { type: 'worktree.offer.resolved'; chatId: string; worktreePath: string; outcome: WorktreeOfferOutcome }
  | { type: 'worktree.offer.snapshot'; chatId: string; offers: WorktreeSwitchOffer[] }
  ```
- `packages/core-rs/crates/mainframe-types/src/worktree_offer.rs` (new) — serde mirror, `#[serde(rename_all = "camelCase")]`, `branch_name: Option<String>`, `detected_at: i64`; `WorktreeOfferOutcome` as a `#[serde(rename_all = "lowercase")]` enum.
- `packages/core-rs/crates/mainframe-types/src/lib.rs` — `pub mod worktree_offer;` (alphabetical, after `workflow`).
- `packages/core-rs/crates/mainframe-types/src/events.rs` — three arms with `#[serde(rename = "worktree.offer.raised" | ".resolved" | ".snapshot")]`, placed after `ChatPrDetected` (`:305`). Field names must match the TS exactly after camelCase rename.
- `docs/rust-port/fixtures/event.worktree-offer-raised.json`, `event.worktree-offer-resolved.json`, `event.worktree-offer-snapshot.json` (new) — dash-cased tag naming per `event.message-queued-snapshot.json`, `_provenance: "synthetic"`. The snapshot fixture uses the `{minimal, full}` wrapper (`minimal`: `offers: []`; `full`: two offers, one with `branchName: null`). The raised fixture carries `branchName: null` in `minimal` and a real short branch in `full`.
- `packages/core-rs/crates/mainframe-types/src/events.rs` `mod tests` (`:446`+, `include_str!` block ending `:611`) — three `assert_daemon_roundtrip(include_str!("../../../../docs/rust-port/fixtures/event.worktree-offer-*.json"))` tests following the existing shape.

**Do not touch:** `websocket.rs:51` `CONNECTION_GLOBAL_EVENT_TYPES`, `docs/rust-port/CONTRACT/ws-events.json` (see A3).

**Verify:**
```
cd packages/core-rs && cargo test -p mainframe-types
pnpm --filter @qlan-ro/mainframe-types build
```
`tests/golden_fixtures.rs` auto-sweeps `docs/rust-port/fixtures/event.*.json`, so a shape mismatch between the fixture and the Rust arm fails there too — both must be green.

---

## Task 2 — `chats.dismissed_worktrees` column, repository methods, tests

**Implementer:** core-dev

Three lockstep places for a new chats column; the third has a length in its type.

**Files:**
- `packages/core-rs/crates/mainframe-db/src/migrations.rs` — new `Migration { version: 27, up: |db| add_column_if_missing(db, "chats", "dismissed_worktrees", "ALTER TABLE chats ADD COLUMN dismissed_worktrees TEXT") }`, appended after the version-26 entry (`:432-443`). Comment says *why*: permanent per-path dismissal must survive daemon restarts.
- `packages/core-rs/crates/mainframe-db/src/migrations.rs:448` — `LATEST_VERSION = 27`.
- `packages/core-rs/crates/mainframe-db/tests/migrations.rs:36` — `ALL_CHATS_COLUMNS: [&str; 32]` (bump the length) + `"dismissed_worktrees"` entry.
- `packages/core-rs/crates/mainframe-db/src/chats.rs` — two methods immediately after `add_plan_file` (`:450-461`), copying its shape exactly:
  ```rust
  pub fn get_dismissed_worktrees(&self, chat_id: &str) -> Result<Vec<String>, DbError> {
      let raw = self.read_text_column("dismissed_worktrees", chat_id)?;
      Ok(parse_json_array(raw))
  }
  pub fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> Result<bool, DbError>
  ```
  `add_` returns `Ok(false)` on duplicate without writing. Parse via `parse_json_array` (`chats.rs:118-123`), never bare `serde_json::from_str`.
- Repository tests in `chats.rs`'s existing `mod tests` (or the crate's `tests/` file where `add_plan_file` is covered — match whichever the existing plan-file test uses): round-trip, duplicate returns `false` and does not grow the array, malformed stored JSON falls back to empty.

**Not on the `Chat` API payload.** Do not add the field to `mainframe-types::chat::Chat`, `packages/types/src/chat.ts`, or any row mapper — it is daemon-internal and the mobile contract must stay untouched.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-db`

---

## Task 3 — `short_branch` helper in `mainframe-services`

**Implementer:** core-dev

**Files:**
- `packages/core-rs/crates/mainframe-services/src/workspace/worktree.rs` — add next to `parse_worktree_list`:
  ```rust
  /// `refs/heads/feat/x` -> `feat/x`; any other string passes through unchanged.
  /// strip_prefix, not replace: a branch named `feat/refs/heads/x` is legal.
  pub fn short_branch(git_ref: &str) -> &str { git_ref.strip_prefix("refs/heads/").unwrap_or(git_ref) }
  ```
  plus unit tests in the existing `mod tests` covering the prefix case, the embedded-substring case (`feat/refs/heads/x` stays intact), and a bare name.
- `packages/core-rs/crates/mainframe-services/src/workspace/mod.rs:7-11` — re-export from the barrel.
- `packages/core-rs/crates/mainframe-server/src/routes/worktree.rs:265-268` — replace `.map(|b| b.replace("refs/heads/", ""))` with `.map(|b| short_branch(b).to_string())`; add the import at `:26`.

**Leave alone:** `mainframe-git/src/git_service.rs:171` (already `strip_prefix`, different crate) and the two TS sites (A7).

**Verify:** `cd packages/core-rs && cargo test -p mainframe-services -p mainframe-server`

---

## Task 4 — Tests for the pure offer-scan logic (TDD, fails first)

**Implementer:** test-writer

Write `packages/core-rs/crates/mainframe-chat/src/worktree_offer_scan.rs`'s `mod tests` **before** its implementation. The module under test is pure: it takes a baseline set, the current `Vec<WorktreeEntry>`, the chat's binding, the dismissed set, other chats' bindings, and the currently pending set, and returns candidates to raise plus paths to expire. No IO, no locks, no clock — `detected_at` is passed in.

Target API (Task 5 implements it):
```rust
pub struct ScanInputs<'a> {
    pub main_worktree_path: &'a str,
    pub baseline: &'a HashSet<String>,
    pub current: &'a [WorktreeEntry],
    pub chat_worktree_path: Option<&'a str>,
    pub dismissed: &'a HashSet<String>,
    pub other_chat_worktrees: &'a HashSet<String>,
    pub pending: &'a BTreeSet<String>,
}
pub struct ScanOutcome { pub raise: Vec<(String, Option<String>)>, pub expire: Vec<String> }
pub fn scan(inputs: ScanInputs<'_>) -> ScanOutcome;
```

Required cases (hardcoded expectations, never recomputed with the implementation's own filters) — these map 1:1 to spec acceptance criteria 1, 3, 4, 5:
1. A worktree absent from the baseline and present in `current` is raised, carrying the **short** branch (`refs/heads/feat/x` in → `feat/x` out; never a `refs/heads/…` string).
2. A detached entry (`branch: None`) is raised with `branchName: None`.
3. The main worktree path is never raised (even when absent from baseline).
4. The chat's own current binding is never raised.
5. A path already in `pending` is not raised again.
6. A path in `dismissed` is never raised.
7. A path that is another chat's current `worktreePath` is never raised.
8. A path present at baseline is never raised, including when it reappears in `current` unchanged.
9. Pending paths absent from `current` come back in `expire`; pending paths still present do not.
10. An empty `current` (git error → `get_worktrees` returns `Vec::new()`) raises nothing and expires every pending path. **Call this out in the test name** — it is the one case where a git failure has a visible effect.
11. `scan` compares its inputs **verbatim** — given `/tmp/wt/x` as the chat's binding and `/private/tmp/wt/x` in `current`, it raises the candidate. This pins the contract, not a bug: canonicalization is the registry's job (A10), and the test that proves it is Task 6 case 13.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat worktree_offer_scan` — expect compile failure / red until Task 5.

---

## Task 5 — `worktree_offer_scan.rs` pure logic

**Implementer:** core-dev

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/worktree_offer_scan.rs` (new) — implement `scan` to make Task 4 green. Use `short_branch` from Task 3 (`use mainframe_services::workspace::short_branch;` — `mainframe-services` is already a `mainframe-chat` dependency, zero Cargo changes). Keep `scan` ≤ 50 lines by splitting eligibility into a small `fn is_eligible(...) -> bool`.
- `packages/core-rs/crates/mainframe-chat/src/lib.rs` — `pub mod worktree_offer_scan;` (alphabetical, after `types`).

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat worktree_offer_scan && cargo clippy -p mainframe-chat --all-targets`

---

## Task 6 — Tests for the offer registry (TDD, fails first)

**Implementer:** test-writer

Write the `mod tests` for `packages/core-rs/crates/mainframe-chat/src/worktree_offer.rs` against a fake `WorktreeOfferDeps` (the trait's service-calling methods carry default bodies — the fake overrides them; precedent `DegradedRecoveryDeps` at `degraded_recovery.rs:74-91`). The fake records emitted `DaemonEvent`s and the dismissed-set writes.

Required cases (spec acceptance criteria 1–5, 10, 11):
1. `seed_baseline` captures the current registered set; a subsequent trigger over an unchanged set raises nothing.
2. A trigger with **no** baseline seeds it and raises nothing (the defensive rule) — assert zero events and a populated baseline.
3. A trigger over a set containing one new worktree emits exactly one `DaemonEvent::WorktreeOfferRaised` whose `offer.worktreePath` is the canonical path and whose `branchName` is the short name.
4. A second trigger over the same set emits nothing (already pending).
5. Re-seeding the baseline (daemon restart → re-activation) drops pending offers; a worktree removed and re-created is offered again.
6. Pruning: a pending offer whose path is gone from `current` emits `WorktreeOfferResolved { outcome: Expired }` and leaves the pending set.
7. `dismiss(chat, path)` on a pending offer writes the path through `add_dismissed_worktree`, emits `Resolved { outcome: Dismissed }`, and a later trigger over a set still containing that path raises nothing.
8. `dismiss` on an unknown path returns the "not pending" error (route maps to 400) and writes nothing.
9. `on_binding_changed(chat, Some(path))` for a pending path emits exactly one `Resolved { outcome: Accepted }` and removes it; for a path that was never pending it emits nothing (a manual popover attach to an unoffered worktree must stay silent).
10. Coalescing: N triggers fired while a rescan is in flight collapse to at most one trailing rescan — assert the fake's `list_worktrees` call count is ≤ 2 for a burst of 5.
11. `snapshot(chat)` returns pending offers ordered by `detectedAt` ascending.
12. `claim_accept` rejects an unknown path (`NotPending`) and rejects a second claim while one is in flight (`SwitchInProgress` → 409); after `release_accept`, a claim succeeds again.
13. **Canonicalization (A10).** The chat's binding is `/tmp/wt/x` while the fake's `list_worktrees` returns `/private/tmp/wt/x` (a real symlinked temp dir created by the test, so `canonicalize` resolves both to the same path). Assert **nothing** is raised — the chat is not offered the worktree it already occupies. Repeat with the colliding path as *another* chat's binding: also nothing raised.
14. `dismiss` for the path of an in-flight switch returns `SwitchInProgress` and writes nothing (see Task 7).
15. `forget(chat_id)` drops the chat's baseline and pending set; a trigger afterwards re-seeds instead of raising.

Use an injected clock (`NowFn = Arc<dyn Fn() -> i64 + Send + Sync>`, precedent `idle_scanner.rs:22`) so `detectedAt` ordering is deterministic.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat worktree_offer` — red until Task 7.

---

## Task 7 — `worktree_offer.rs` registry

**Implementer:** core-dev

Module shape follows `degraded_recovery.rs`: error enum with `status_code()`, one dep trait whose service-calling methods have default bodies, an `emit_*`-style seam (no inline `DaemonEvent` construction outside one small helper), async work in free-standing methods.

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/worktree_offer.rs` (new) — the sync offer state machine (`OfferError`, `WorktreeOfferDeps`, `ChatOffers`, `snapshot`/`dismiss`/`claim_accept`/`release_accept`/`expire`/`on_binding_changed`/`forget`).
- `packages/core-rs/crates/mainframe-chat/src/worktree_offer/rescan.rs` (new) — the async half (`seed_baseline`, `on_trigger`, `rescan`, canonicalization) as a second `impl WorktreeOfferRegistry` block. Split out to keep both files under the 300-line cap.
- `packages/core-rs/crates/mainframe-chat/src/worktree_offer/tests.rs` (new) — Task 6's tests, as `#[cfg(test)] mod tests;`.
- `packages/core-rs/crates/mainframe-chat/src/lib.rs` — `pub mod worktree_offer;`

**Shape:**
```rust
#[derive(Debug, thiserror::Error)]
pub enum OfferError {
    #[error("No pending worktree offer for that path")] NotPending,   // 400
    #[error("A worktree switch is already in progress")] SwitchInProgress, // 409
    #[error("Worktree no longer exists")] Vanished,                    // 400 + resolve Expired
    #[error("{0}")] Message(String),                                   // 400
}
impl OfferError { pub fn status_code(&self) -> u16 { … } }

pub trait WorktreeOfferDeps: Send + Sync {
    fn emit_event(&self, event: DaemonEvent);
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    /// (project_id, worktree_path) of the chat, from the active-chat cell or the DB.
    fn chat_binding(&self, chat_id: &str) -> Option<(String, Option<String>)>;
    /// Every *other* chat's current worktree_path in this project.
    fn other_chat_worktrees(&self, project_id: &str, chat_id: &str) -> HashSet<String>;
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Vec<String>;
    fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> bool;
    /// Default body calls the real `mainframe_services::workspace::get_worktrees`.
    fn list_worktrees<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, Vec<WorktreeEntry>> {
        Box::pin(async move { mainframe_services::workspace::get_worktrees(project_path).await })
    }
}

pub struct WorktreeOfferRegistry {
    deps: Arc<dyn WorktreeOfferDeps>,
    now: NowFn,
    state: Mutex<HashMap<String, ChatOffers>>, // std::sync::Mutex
}
struct ChatOffers {
    baseline: Option<HashSet<String>>,
    pending: BTreeMap<String, WorktreeSwitchOffer>, // keyed by canonical path
    rescanning: bool,
    rescan_queued: bool,
    switching: Option<String>, // target path of the in-flight switch
}
```

**Public API:**
- `pub async fn seed_baseline(&self, chat_id: &str, project_path: &str)` — rescan + replace baseline, clear pending (restart = drop pending, by design). Called from `do_load_chat` (Task 10).
- `pub fn on_trigger(self: &Arc<Self>, chat_id: &str)` — **sync**, called from the sink. Under the state lock: if `rescanning` set `rescan_queued = true` and return; else set `rescanning` and `tokio::spawn` the rescan. Guard dropped before the spawn.
- `async fn rescan(self: Arc<Self>, chat_id: String)` — resolve `project_path`, `list_worktrees`, canonicalize, build `ScanInputs`, call `scan`, emit `Raised` per new candidate and `Resolved{Expired}` per pruned path, then re-check `rescan_queued` and loop once.
  **Canonicalization is not optional and is not partial (A10).** One `async fn canon(p: &str) -> String` — `tokio::fs::canonicalize(p).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| p.to_string())`, mirroring `validate_and_delete_worktree` (`routes/worktree.rs:249-256`) — is applied to **all four** sources before they reach `ScanInputs`: every `WorktreeEntry.path`, `main_worktree_path` (from `projects_get_path`), `chat_worktree_path`, and every member of `other_chat_worktrees`. The stored baseline and pending keys are therefore canonical too, so `dismissed` (read back from the DB, written canonical) compares correctly. Skipping any one of these silently disables an eligibility gate on macOS.
- `pub fn snapshot(&self, chat_id: &str) -> Vec<WorktreeSwitchOffer>` — pending sorted by `detected_at` asc.
- `pub fn dismiss(&self, chat_id: &str, worktree_path: &str) -> Result<(), OfferError>` — validate pending (`NotPending`); **reject with `SwitchInProgress` when the path is the in-flight switch target**, otherwise a second client dismissing mid-rebind removes the offer, `on_binding_changed` finds nothing pending and never emits `resolved{accepted}`, and the chat's brand-new binding lands in its own dismissed set. Then `add_dismissed_worktree` → remove → emit `Resolved{Dismissed}`.
- `pub fn claim_accept(&self, chat_id: &str, worktree_path: &str) -> Result<WorktreeSwitchOffer, OfferError>` — validate pending (`NotPending`), reject when `switching.is_some()` (`SwitchInProgress` → 409; this is the *only* switch guard, A6), set `switching`, return the offer **without** removing it (a failed rebind must leave it pending).
- `pub fn release_accept(&self, chat_id: &str)` — clear `switching`.
- `pub fn expire(&self, chat_id: &str, worktree_path: &str)` — remove + emit `Resolved{Expired}` (the vanished-on-accept branch).
- `pub fn on_binding_changed(&self, chat_id: &str, worktree_path: Option<&str>)` — if the new path is pending, remove + emit `Resolved{Accepted}`. **This is the single source of `accepted`** (spec ruling 10).
- `pub fn forget(&self, chat_id: &str)` — drop per-chat state on chat delete/dispose (prevents an unbounded map).

**Concurrency:** every `state` lock is a short critical section; the guard is dropped before every `.await` and before every `deps.emit_event` that could re-enter. Module doc comment records A2 (subagent blocks bypass detection; the next top-level trigger catches up).

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat worktree_offer && cargo clippy -p mainframe-chat --all-targets -- -D warnings`

---

## Task 8 — Sink trigger: stash on `tool_use`, confirm on non-error `tool_result`

**Implementer:** core-dev

Mirror `pending_file_paths` exactly. The sink stays synchronous and narrow — one new callback, no rescanning inside the sink.

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`
  - `EventHandlerDeps` (`:64-104`) — add with a **default no-op body** (precedent `:92`, `:97`, `:103`):
    ```rust
    /// A completed, non-error tool call that may have registered a worktree.
    /// Sync fire-and-forget; the offer registry spawns its own rescan.
    fn on_worktree_trigger(&self, _chat_id: &str) {}
    ```
  - `SessionSinkImpl` (`:238-247`) — add `pending_worktree_triggers: Mutex<HashSet<String>>`; initialize empty in `EventHandler::build_sink` (`:181-196`, alongside `:193-194`).
  - `on_message` tool_use loop (`:399-423`) — inside the existing `MessageContentNode::ToolUse { id, name, input, .. }` arm, stash `id` when either:
    - `matches!(name.as_str(), "Bash" | "BashTool")` and `input.get("command").and_then(|v| v.as_str())` contains `"worktree"` case-insensitively (`cmd.to_ascii_lowercase().contains("worktree")`), or
    - `name == "EnterWorktree"` (Claude-only extra signal; its result JSON is **never** parsed).
  - `on_tool_result` (`:493-539`) — inside the existing loop, after the `if *is_error { continue; }` guard (`:503-505`), `remove(tool_use_id)` from the new set into a `let mut worktree_trigger = false;`. After the loop, `if worktree_trigger { self.deps.on_worktree_trigger(&self.chat_id); }` — fired **once** per tool-result batch, not per block.
- `packages/core-rs/crates/mainframe-chat/src/event_handler/worktree_trigger_tests.rs` (new, registered as `#[cfg(test)] mod worktree_trigger_tests;`) — a fake `EventHandlerDeps` counting `on_worktree_trigger` calls. Its own file rather than `event_handler.rs`'s `mod tests`, which is already ~800 lines:
  1. `Bash` with `git worktree add …` + non-error result → exactly 1 call.
  2. `Bash` with `GIT WORKTREE LIST` (mixed case) → 1 call (case-insensitive substring).
  3. `Bash` with `ls -la` → 0 calls.
  4. `Bash` with a worktree command + `is_error: true` result → 0 calls (the stash is never consumed).
  5. `EnterWorktree` + non-error result → 1 call.
  6. Two worktree tool_uses resolved in one tool_result batch → 1 call, not 2.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat event_handler`

---

## Task 9 — Worktree→worktree rebind in `attach_worktree` + binding-changed hook

**Implementer:** core-dev

**Files:** `packages/core-rs/crates/mainframe-chat/src/config_manager.rs`

1. `ConfigManagerDeps` (`:45-63`) — add with a **default no-op body** (the trait has none today; a default keeps every existing test impl compiling):
   ```rust
   /// Fired after a binding change persists — the offer registry's single
   /// source of `resolved{accepted}`.
   fn on_binding_changed(&self, _chat_id: &str, _worktree_path: Option<&str>) {}
   ```
2. `apply_worktree_update` (`:241-264`) — after the `emit_event(ChatUpdated)` at `:261-263`, call `self.deps.on_binding_changed(chat_id, worktree_path.as_deref())`. This is the *only* new call site; `enable_worktree`, `attach_worktree`, and `disable_worktree` all route through it, so a manual popover attach resolves an offer identically to an accept.
3. `attach_worktree` (`:434-494`) — signature becomes:
   ```rust
   pub async fn attach_worktree(&self, chat_id: &str, worktree_path: &str, branch_name: Option<&str>) -> Result<(), ConfigError>
   ```
   - The short lock at `:441-449` reads `current_worktree: Option<String>` instead of `has_worktree: bool`.
   - `:450-452` guard becomes `if current_worktree.as_deref() == Some(worktree_path) { return Ok(()); }` (target == current stays a no-op).
   - Mid-session path (`:454-483`): the Claude source dir becomes `get_claude_project_dir(current_worktree.as_deref().unwrap_or(&project.path))` — the chat's *current effective directory*, not always the project root.
   - Launch hygiene, after `stop_chat` and before the file move: `if let Some(old) = current_worktree.as_deref() { if let Some(fut) = self.deps.stop_launch_processes(&project_id, old) { fut.await; } }` — mirrors `disable_worktree:520-522`. Same blast radius as `disable_worktree` (whole `(project, path)` launch manager); record that in a one-line comment.
   - `apply_worktree_update(..., branch_name.map(str::to_string))` — `None` persists a null branch for a detached worktree (`apply_worktree_update` already accepts `Option`).
   - Pre-session path (`:485-493`) unchanged except the `Option` branch.
4. Callers: `ChatManager::attach_worktree` (`chat_manager.rs:1551-1558`) takes `Option<&str>` and forwards; `routes/worktree.rs`'s existing `attach_worktree` handler keeps its non-empty `branchName` validation and passes `Some(&branch_name)` — **the shipped route's contract does not change**.
5. Inline tests in `config_manager.rs`'s `mod tests`:
   - attaching a worktree'd chat to a *different* path performs the rebind (asserts `chats_update` fired with the new path, `start_chat` called) — the regression the old guard caused.
   - attaching to the *same* path is a no-op (no `stop_chat`, no `chats_update`).
   - rebinding away from a worktree calls `stop_launch_processes` with the **old** path.
   - a Claude chat's session-file move source is the old worktree dir, not the project root.
   - `branch_name: None` persists `branch_name: Some(None)` in the `ChatFieldUpdate`.
   - `on_binding_changed` fires once per `apply_worktree_update`, carrying the new path.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat config_manager`

---

## Task 10 — Wire the registry into `ChatManager` and seed the baseline

**Implementer:** core-dev

`Guards` and `join_flight` are **not** touched — the registry owns the switch guard (A6).

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs`
  - `LifecycleManagerDeps` (`:62-…`) — add with a **default `None` body** (precedent `adapter_snapshot_models` at `:79-81`, `stop_launch_processes`'s `Option<BoxFuture>` idiom):
    ```rust
    fn seed_worktree_baseline<'a>(&'a self, _chat_id: &'a str, _project_path: &'a str) -> Option<BoxFuture<'a, ()>> { None }
    ```
  - `do_load_chat` (`:776-848`) — call it immediately after `projects_get_path` resolves (`:790-793`) and **before** the early returns at `:795`, `:798`, `:802`, so a fresh chat and a post-restart re-activation both seed. It is inside the `loading` single-flight, so it runs exactly once per activation. Cost: one `git worktree list` per activation.
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`
  - New in-crate `OfferDeps` struct (model on `RecoveryWrapper`, `:795-915`) holding `{ deps: Arc<dyn ChatManagerDeps>, active_chats: Registry, permissions }`, implementing `WorktreeOfferDeps`: `emit_event` → `enrich_and_emit` (`:705-707` pattern); `chat_binding`/`other_chat_worktrees` from `active_chats` + `deps.chats_list(project_id)`; the two dismissed-set methods forward to new `ChatManagerDeps` methods.
  - `ChatManagerDeps` (`:173-186` region, next to `add_plan_file`) — both with **default bodies**, so no existing fake impl has to change and the tree compiles across the task boundary:
    ```rust
    fn get_dismissed_worktrees(&self, _chat_id: &str) -> Vec<String> { Vec::new() }
    fn add_dismissed_worktree(&self, _chat_id: &str, _worktree_path: &str) -> bool { false }
    ```
  - `ChatManager` struct (`:917-929`) — new field `worktree_offers: Arc<WorktreeOfferRegistry>`.
  - `ChatManager::new` (`:932`, dep construction at `:936-987`) — build in this order: `deps` → `active_chats` → `worktree_offers` → `EhDeps`/`LcDeps`/`CmDeps` (each holding an `Arc` clone), then store it in the struct literal alongside `queued_refs` (`:987`).
  - `forget(chat_id)` is called from the two existing chat-teardown seams, next to their `tracker_remove_chat` + `clear_display_cache` pair: `archive_chat` (`:1205-1209`) and `end_chat` (`:1210-1214`). `dispose` (`:1027-1032`) is untouched.
  - `EhDeps` (`:405-467`) — `fn on_worktree_trigger(&self, chat_id: &str) { self.worktree_offers.on_trigger(chat_id); }`.
  - `CmDeps` (`:672-732`) — `fn on_binding_changed(&self, chat_id: &str, worktree_path: Option<&str>) { self.worktree_offers.on_binding_changed(chat_id, worktree_path); }`.
  - `LcDeps` — `seed_worktree_baseline` returns `Some(Box::pin(async move { registry.seed_baseline(chat_id, project_path).await }))`.
  - Facade methods next to `attach_worktree` (`:1551`):
    ```rust
    pub fn worktree_offers_for_chat(&self, chat_id: &str) -> Vec<WorktreeSwitchOffer>
    pub fn dismiss_worktree_offer(&self, chat_id: &str, worktree_path: &str) -> Result<(), OfferError>
    pub async fn accept_worktree_offer(&self, chat_id: &str, worktree_path: &str) -> Result<(), OfferError>
    ```
    `accept_worktree_offer` (see A5), ≤ 50 lines:
    1. `let offer = self.worktree_offers.claim_accept(chat_id, worktree_path)?;` — `NotPending` → 400, `SwitchInProgress` → 409. This is the only guard (A6).
    2. If `tokio::fs::metadata(worktree_path)` fails → `release_accept`, then `self.worktree_offers.expire(chat_id, worktree_path)`, return `OfferError::Vanished` (400; the offer resolves `expired` and the path stays eligible for a future scan).
    3. `let result = self.config.attach_worktree(chat_id, worktree_path, offer.branch_name.as_deref()).await;`
    4. `self.worktree_offers.release_accept(chat_id);` on **both** arms — no `?` between the claim and the release, so bind `result` first and release before matching on it.
    5. On `Ok`, return `Ok(())` — the `resolved{accepted}` was already emitted by `on_binding_changed` inside `apply_worktree_update`. On `Err`, map to `OfferError::Message` and leave the offer pending.
- `packages/core-rs/crates/mainframe-server/src/chat_deps.rs` — `DaemonChatDeps` impls for the two new `ChatManagerDeps` methods, copying `add_detected_prs` (`:399-404`): `self.db.call_blocking(move |d| d.chats.get_dismissed_worktrees(&id)).unwrap_or_default()` / `…add_dismissed_worktree(&id, &path)).unwrap_or(false)`.

**Verify:**
```
cd packages/core-rs && cargo check --workspace && cargo test -p mainframe-chat && cargo test -p mainframe-server
```

---

## Task 11 — `accept-worktree-offer` / `dismiss-worktree-offer` routes

**Implementer:** core-dev

**Files:**
- `packages/core-rs/crates/mainframe-server/src/routes/worktree_offer.rs` (new, A9)
- `packages/core-rs/crates/mainframe-server/src/routes/mod.rs` — `pub mod worktree_offer;` (alphabetical, after `worktree`)
- `packages/core-rs/crates/mainframe-server/src/http.rs:55` — `.merge(routes::worktree_offer::router())` right after `routes::worktree::router()`

**Handlers** — house style throughout: `parse_body::<T>(&body).unwrap_or(default)`, first-failing-issue message, `ok_empty()`/`fail(status, msg)`:
```
POST /api/chats/{id}/accept-worktree-offer   body { worktreePath }
POST /api/chats/{id}/dismiss-worktree-offer  body { worktreePath }
```
Both: empty/missing `worktreePath` → `fail(BAD_REQUEST, "Worktree path is required")` (matching the existing attach route's wording). Then `let Some(cm) = ctx.chat_manager.as_ref() else { tracing::warn!(...); return fail(StatusCode::INTERNAL_SERVER_ERROR, "Failed to switch worktree") }` — **500, not 400**, matching `fork_worktree`'s treatment of the same unwired-daemon condition (`routes/worktree.rs:129-135`); an unwired ChatManager is a server defect, not bad input. Body validation comes **before** the guard so the 400 paths remain testable under `AppCtx::test_ctx()` (which sets `chat_manager: None`, `ctx.rs:240`), exactly as `delete_worktree` does. Then `cm.accept_worktree_offer(&id, &path).await` / `cm.dismiss_worktree_offer(&id, &path)`, mapping `OfferError::status_code()` through `StatusCode::from_u16(...).unwrap_or(INTERNAL_SERVER_ERROR)` (precedent: `fork_worktree`, `routes/worktree.rs:136-144`). The accept route **never** emits `resolved` itself.

**Inline `mod tests`** (mirror `routes/worktree.rs:355-412`, `AppCtx::test_ctx()` + the local `read` helper):
- accept with an empty body → 400 `"Worktree path is required"`.
- accept with `{"worktreePath":""}` → 400 same message.
- dismiss with an empty body → 400 same message.
- accept/dismiss with a valid body and an unwired ChatManager → **500** with the fallback message (documents the harness path).
- A `PORT STATUS`-style trailing comment is **not** required (this is a new post-cutover route, not a port).

The pending-match / 409 / expired semantics are covered by Task 6's registry tests — do not try to reconstruct them here without a ChatManager.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-server worktree_offer`

---

## Task 12 — Per-subscribe offer snapshot

**Implementer:** core-dev

**Files:** `packages/core-rs/crates/mainframe-server/src/websocket.rs:436-448`

In `ClientEvent::Subscribe`, after the existing `MessageQueuedSnapshot` send and **before** `SubscribeAck` — order is load-bearing, mirroring the queued-snapshot precedent:
```rust
let offers = ctx.chat_manager.as_ref()
    .map(|cm| cm.worktree_offers_for_chat(&chat_id))
    .unwrap_or_default();
send(out_tx, &DaemonEvent::WorktreeOfferSnapshot { chat_id: chat_id.clone(), offers });
send(out_tx, &DaemonEvent::SubscribeAck { chat_id });
```
Uses the per-connection `send`, bypassing the broadcast bus — a snapshot must reach only the subscribing connection. Send it unconditionally (empty vec included) so a reconnecting client that had offers can clear stale ones.

**Do not** add the type to `CONNECTION_GLOBAL_EVENT_TYPES` (A3).

**Verify:** `cd packages/core-rs && cargo check -p mainframe-server && cargo test -p mainframe-server websocket`

---

## Task 13 — Reducer + mapper tests (TDD, fails first)

**Implementer:** test-writer

**Files:**
- `packages/ui/src/features/chat/controller/__tests__/chat-thread-state-worktree-offer.test.ts` (new)
- `packages/ui/src/features/chat/controller/__tests__/handle-daemon-event-worktree-offer.test.ts` (new)

Dash-separated, per the directory's convention (`chat-thread-state-background.test.ts`, `handle-daemon-event-background.test.ts`) — a per-concern sibling file, not an extension of the existing `handle-daemon-event.test.ts`.

Cases (spec acceptance criteria 15, plus the state contract Task 14 implements):
1. `worktree.offer.added` inserts keyed by `worktreePath`; a second add for the same path replaces it.
2. `worktree.offer.removed` deletes; removing an absent path returns the **same state object** (identity-stable).
3. `worktree.offer.snapshot` replaces the whole set; a snapshot listing exactly what state already holds returns the same state object (identity-stable bail, mirroring `background.snapshot`).
4. `worktree.switch.started` sets `{ worktreePath, phase: 'restarting' }`.
5. `chat.config.updated` whose `chat.worktreePath` equals the in-flight target flips phase to `'settled'` **and** adopts the new config — assert the returned state is not the previous object even though only the phase would otherwise change.
6. `chat.config.updated` for an unrelated worktree leaves `switching` untouched.
7. `worktree.switch.failed` and `worktree.switch.cleared` both null out `switching`.
8. Mapper: each of the three daemon events with a **non-matching** `chatId` returns `{ kind: 'noop' }`; with a matching `chatId` returns the corresponding reducer event.
9. `createChatThreadState` seeds `worktreeOffers: {}` and `switching: null`.

Assert concrete expected objects; never recompute the reducer's own transform inside the test.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-state-worktree-offer.test.ts` — red until Task 14.

---

## Task 14 — Chat-thread state, mapper, and router arms

**Implementer:** ui-dev

State rides on `ChatThreadState`, following `backgroundTasks` end to end. **Do not** stamp offer fields onto `Chat` — that path is swallowed by `sameComposerConfig`'s allowlist (`chat-thread-state.ts:181-197`). `sameComposerConfig` already compares `worktreePath`, `branchName`, and `worktreeMissing`, so the settled transition in case 5 always re-runs; no change to that function is needed.

**Files:**
- `packages/ui/src/features/chat/controller/chat-thread-state.ts`
  - Fields after `backgroundTasks` (`:90`):
    ```ts
    /** Pending worktree switch offers keyed by canonical path — fed by
     *  `worktree.offer.*`, re-seeded from the subscribe snapshot. */
    readonly worktreeOffers: Readonly<Record<string, WorktreeSwitchOffer>>;
    /** This client's in-flight accept. Server-authoritative settle: phase flips
     *  when `chatConfig.worktreePath` reaches the target. */
    readonly switching: { readonly worktreePath: string; readonly phase: 'restarting' | 'settled' } | null;
    ```
  - `createChatThreadState` (`:131-149`) — seed `worktreeOffers: {}` and `switching: null`.
  - `ChatStateEvent` (after `:125`) — `worktree.offer.added` / `.removed` / `.snapshot`, `worktree.switch.started` / `.failed` / `.cleared`.
  - Reducer cases next to the `background.*` block (`:382-402`), each with the identity-stable bail; a `sameWorktreeOffers(current, offers)` helper next to `sameBackgroundTasks` (`:199`).
  - `chat.config.updated` case (`:264-283`) — compute the `switching` phase transition **before** the `if (sameConfig && sameUsage) return state;` short-circuit, and include `switching` in the early-return condition so a settle is never swallowed. Keep the case ≤ 50 lines; extract the transition into a small `nextSwitching(state, chat)` helper if it grows.
- `packages/ui/src/features/chat/controller/handle-daemon-event.ts` — three arms in the `background_task.*` neighborhood (`:107-119`), each `if (event.chatId !== chatId) return { kind: 'noop' };` first.
- `packages/ui/src/features/chat/controller/chat-event-router.ts:39-45` — no `chat.updated`-mirrored offer snapshot exists server-side (offers are not on the `Chat` payload), so **do not** add one here. The subscribe snapshot (Task 12) is the only re-seed path; the router's existing `chat.config.updated` dispatch already carries the settle signal.

**Verify:**
```
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-state-worktree-offer.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/handle-daemon-event-worktree-offer.test.ts
pnpm --filter @qlan-ro/mainframe-ui typecheck
```

---

## Task 15 — API functions, controller actions, runtime extras, selector

**Implementer:** ui-dev

**Files:**
- `packages/ui/src/lib/api/git.ts` — after `attachWorktree` (`:206-208`):
  ```ts
  /** Accept a worktree switch offer: rebind this session into `worktreePath` and restart the agent. */
  export const acceptWorktreeOffer = (port: number, chatId: string, worktreePath: string): Promise<void> =>
    requestEmpty('POST', `${apiBase(port)}/api/chats/${encodeURIComponent(chatId)}/accept-worktree-offer`, { worktreePath });
  /** Permanently dismiss a worktree switch offer for this chat. */
  export const dismissWorktreeOffer = (port: number, chatId: string, worktreePath: string): Promise<void> => …
  ```
- `packages/ui/src/features/chat/controller/chat-thread-controller.ts` — three methods next to `cancelQueued`/`editQueued`:
  - `acceptWorktreeOffer(worktreePath)`: dispatch `worktree.switch.started` → `await acceptWorktreeOffer(...)`; on throw dispatch `worktree.switch.failed` and `mfToast.error` (import from `@/lib/toast`, **not** sonner) with the server message. The offer stays pending — do not remove it locally.
  - `dismissWorktreeOffer(worktreePath)`: POST; on throw `mfToast.error`. The `resolved` event removes it (in every connected client) — no optimistic removal.
  - `clearWorktreeSwitch()`: dispatch `worktree.switch.cleared`.
- `packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts`
  - `ChatRuntimeExtras` (`:44-58`) — `acceptWorktreeOffer`, `dismissWorktreeOffer`, `clearWorktreeSwitch`.
  - The `useMemo` (`:118-133`) — three delegations to `controller`.
  - New selector after `useChatQueuedMessages` (`:174`):
    ```ts
    /** Pending offers ordered by detectedAt, plus this client's in-flight switch. */
    export function useWorktreeOffer(): {
      offers: WorktreeSwitchOffer[];
      switching: ChatThreadState['switching'];
      /** The chat's live binding from `state.chatConfig` — the settled banner's
       *  only data source, since the offer is gone by the time it renders. */
      current: { worktreePath: string | null; branchName: string | null };
      accept: (p: string) => Promise<void>;
      dismiss: (p: string) => Promise<void>;
      clear: () => void;
    }
    ```
    `useMemo([extras])` for a stable ref, sorting by `detectedAt` asc. `current` is derived from `state.chatConfig` (`chat-thread-state.ts:75`), which is `null` before load — map that to `{ worktreePath: null, branchName: null }`. The settled banner needs this because `on_binding_changed` removes the offer the instant the rebind persists, and `switching` carries only the target path.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`

---

## Task 16 — `WorktreeSwitchBanner` component tests (TDD, fails first)

**Implementer:** test-writer

**File:** `packages/ui/src/features/chat/composer/__tests__/WorktreeSwitchBanner.test.tsx` (new) — model the harness on `packages/ui/src/features/chat/composer/__tests__/BackgroundActivityBar.test.tsx` (same `useChatExtras` mocking approach).

Copy is **load-bearing and asserted verbatim** (spec acceptance criterion 13). Reference: `git show proto/design-gates:packages/ui/src/prototypes/worktree-switch/stub.tsx` (the `COPY` object).

Cases:
1. **No offers, no switch** → renders nothing (`container.firstChild` is null).
2. **Draft thread** (no remote chat id) → renders nothing.
3. **Pending, one** → `worktree-switch-banner` present; headline text `New worktree: feat/x`; body exactly:
   `Created at /tmp/wt/x. Switch this session into it? The agent restarts in the new folder — a running process can't change directory. History carries over; a response in progress stops.`
   Buttons `worktree-switch-accept` / `worktree-switch-dismiss` both carrying `data-path="/tmp/wt/x"`, labelled `Switch session` / `Stay here`.
4. **Pending, three** → one banner only (assert exactly one `worktree-switch-banner`); title `3 new worktrees — switch this session?`; the shared warning appears **once**:
   `Switching restarts the agent in the chosen folder — a running process can't change directory. History carries over; a response in progress stops.`
   three `worktree-switch-row` elements in `detectedAt` ascending order, each with its own accept/dismiss carrying `data-path`.
5. **Switching, one pending** → the whole banner is `worktree-switch-status` reading `Switching — restarting the agent in feat/x…`; no accept button.
6. **Switching, three pending** → only the accepted row is the status line; the other two rows' accept buttons are `disabled` and their dismiss buttons are **not**.
7. **Settled** → with `switching: { worktreePath: '/tmp/wt/x', phase: 'settled' }`, **no pending offers**, and `current: { worktreePath: '/tmp/wt/x', branchName: 'feat/x' }`, renders `Session is now in /tmp/wt/x on feat/x.` — the copy is built from `current`, not from an offer (which no longer exists by then). With fake timers, after 2000 ms `clear` has been called (assert the mock, not a DOM disappearance — the parent state owns removal).
8. **Detached fallback** → an offer with `branchName: null` at `/tmp/wt/hotfix` renders `New worktree: hotfix` (path basename) in pending and in switching; the settled state with `current: { worktreePath: '/tmp/wt/hotfix', branchName: null }` renders `… on hotfix.`
9. Clicking accept calls `accept` with the row's path; clicking dismiss calls `dismiss` with the row's path.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/__tests__/WorktreeSwitchBanner.test.tsx` — red until Task 17.

---

## Task 17 — `WorktreeSwitchBanner` component + mount

**Implementer:** ui-dev

**Files:**
- `packages/ui/src/features/chat/composer/WorktreeSwitchBanner.tsx` (new, ≤ 300 lines; extract a `WorktreeOfferRow` sub-component if it approaches that). Port the approved prototype's markup and classes verbatim from `git show proto/design-gates:packages/ui/src/prototypes/worktree-switch/{VariantB,offer}.tsx`, replacing the prototype's `useEnv()` with `useWorktreeOffer()`:
  - Container (pending): `rounded-lg border border-primary/40 bg-primary/10 p-3`, `data-testid="worktree-switch-banner"`.
  - Headline: `text-body font-medium flex items-center gap-1.5` with `<GitBranch className="size-3.5 text-primary" />`.
  - Body / shared warning: `text-caption text-muted-foreground`.
  - List rows: `flex items-center justify-between gap-2 rounded-md bg-card/60 px-2 py-1.5`, `data-testid="worktree-switch-row"` + `data-path`; branch `text-caption font-medium`, path `text-caption text-muted-foreground font-mono truncate`.
  - Accept: `rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-caption font-medium hover:bg-primary/90`, `data-testid="worktree-switch-accept"`, `data-path`.
  - Dismiss: `rounded-md border border-border px-2.5 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-accent-foreground`, `data-testid="worktree-switch-dismiss"`, `data-path`.
  - Switching line: `flex items-center gap-1.5 text-caption text-primary` + `<Loader2 className="size-3.5 animate-spin" />`, `data-testid="worktree-switch-status"`.
  - Settled: container `border-mf-success/40 bg-mf-success-tint`, line `text-mf-success` + `<Check className="size-3.5" />`.
  - `{branch}` falls back to `basename(worktreePath)` whenever `branchName` is null — in **every** state. One `branchLabel(worktreePath, branchName)` helper, fed by the offer in the pending/switching states and by the selector's `current` in the settled state.
  - Settled removal: a `useEffect` with a 2000 ms timer calling `clear()`; cleared on unmount.
  - Renders `null` when there are no pending offers and no in-flight switch, and for draft (`__LOCALID_*`) threads — self-gating, exactly like `BackgroundActivityBar`.
  - Only real `mf-*` tokens (`bg-mf-success-tint`, `text-mf-success`, `border-mf-success` all exist). Do not invent tokens — phantom `mf-*` classes render silently unstyled in this app.
- `packages/ui/src/features/chat/thread/ChatThread.tsx:121-123` — render `<WorktreeSwitchBanner />` unconditionally between `<BackgroundActivityBar />` and `<Composer />`, inside the `mx-auto w-full max-w-3xl px-5 pb-4` footer wrapper. The footer's height already registers as scroll inset, so the transcript is never covered.

**Verify:**
```
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/__tests__/WorktreeSwitchBanner.test.tsx
pnpm --filter @qlan-ro/mainframe-ui typecheck
```

---

## Task 18 — The manual door: existing-worktree list for already-isolated chats

**Implementer:** ui-dev

The approved design's transience (permanent dismissal, no undo, no dismissed list) rests on the WorktreePopover being "the manual door into any worktree". Today `WorktreePopover.tsx:210-211` short-circuits to `<ActiveInfo chat={chat} />` for `isIsolated` chats — no Existing tab, no attach. Spec ruling 17 scopes the repair in. Task 9's rebind makes it actually work.

**Files:**
- `packages/ui/src/features/chat/composer/config-toolbar/WorktreePopover.tsx`
  - `:210-211` — for an isolated chat, render `ActiveInfo` **plus** the existing-worktree list (`<WorktreeExistingTab … />`), instead of `ActiveInfo` alone. Keep the New tab hidden for isolated chats (creating a second worktree from an isolated chat is out of scope; `WorktreeTabBar` stays on the non-isolated branch).
  - Filter the chat's own `worktreePath` out of the list it passes down, so the current binding is not offered as a target.
  - `handleAttach` (`:141`) is **unchanged** — including its legacy `'detached'` literal (A8).
  - Preserve every existing testid: `composer-worktree-trigger`, `composer-worktree-popover`, `composer-worktree-active-info`, and whatever `WorktreeExistingTab.tsx` already carries.
- Tests: extend the existing WorktreePopover test file (or add `__tests__/WorktreePopover.isolated.test.tsx`) — an isolated chat's popover shows the existing-worktree list; the chat's own worktree is absent from it; clicking a row calls `attachWorktree` with that row's path; `composer-worktree-active-info` still renders.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <the popover test file>`

---

## Task 19 — Changeset and full verification sweep

**Implementer:** core-dev

**Files:**
- `.changeset/worktree-switch-offer.md` (new) — `'@qlan-ro/mainframe-types': minor`, `'@qlan-ro/mainframe-ui': minor` (mirror `.changeset/background-activity-indicator.md`'s shape; omit `mainframe-core`, which is orphaned). One sentence, no puffery: what it does, not how great it is.

**Sweep** (each must be green; run single files where noted, never `pnpm install`):
```
cd packages/core-rs
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p mainframe-types -p mainframe-db -p mainframe-services -p mainframe-chat -p mainframe-server

cd ../..
pnpm --filter @qlan-ro/mainframe-types build
pnpm --filter @qlan-ro/mainframe-ui typecheck
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-state-worktree-offer.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/handle-daemon-event-worktree-offer.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/__tests__/WorktreeSwitchBanner.test.tsx
```
A large multi-suite vitest run hits cross-file `React.act` failures — a failing file must be re-run alone before being believed.

**Manual smoke** (worth doing before the PR; not automatable per the spec's out-of-scope note): in a dev app pointed at an isolated data dir, ask an agent to run `git worktree add ../probe -b probe/x`, confirm the banner appears above the composer, accept it, and confirm the session bar's branch indicator flips and the transcript survives the restart.

---

## Out of scope (from the spec — do not drift into these)

Worktree creation from the offer, auto-switching, `ExitWorktree`, worktree removal, the MainToolbar BranchPopover / separate-session model, the `DegradedChatCard` recovery flow, mobile UI, and an e2e scenario (the mock adapter's `worktree-pills.0.ndjson` replays the tool stream but no worktree exists on disk, so the rescan diff correctly finds nothing).

## Known risks

1. **Baseline seeding adds one `git worktree list` to every chat activation** (Task 10), inside the `loading` single-flight. Spec ruling 21 requires eager seeding — a lazy baseline would swallow the first offer of every session. Cost is one subprocess per activation; if it ever shows up in activation latency, the fix is to seed from a cached project-level scan, not to make it lazy.
2. **Coarse trigger cost in this repo.** Ordinary `ls`/`grep` commands mention `.worktrees/`, so the substring match fires often. Coalescing bounds each burst to one or two `git worktree list` calls (Task 7); the registry test asserts that bound.
3. **Subagent-created worktrees are detected late** (A2), not never.
4. **Detached-branch inconsistency between the accept route (`null`) and the popover (`'detached'`)** (A8) — deliberate, recorded.
5. **`stop_launch_processes` blast radius** (Task 9) stops the whole `(project, old path)` launch manager, not a per-chat subset — identical to `disable_worktree`'s existing behavior.
6. **Queued messages on a mid-stream accept are dropped, not replayed.** The CLI-exit path clears the mirror and emits `MessageQueuedCleared` (verified above), so daemon and CLI stay consistent — but a user who queued a message and then accepted an offer loses it. That is the existing behavior of every `stop_chat` path, including the manual popover attach; the restart warning in the banner copy is the only mitigation this feature adds. Do not build queue carry-over here.
