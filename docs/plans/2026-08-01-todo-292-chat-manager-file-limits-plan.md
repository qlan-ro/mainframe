# Todo #292 — Split `chat_manager.rs` into submodules and shrink its two oversized functions

**Branch:** `todo/292-chat-manager-file-limits` · **Worktree:** `.worktrees/todo-292-chat-manager-file-limits`
**Route:** no-spec (works from the approved Agent Brief on todo #292)
**Base:** `c06fc02a`

## Goal

`packages/core-rs/crates/mainframe-chat/src/chat_manager.rs` is 2288 lines against the repo's 300-line file limit, and
two of its functions — `ChatManager::send_message` (99 lines) and `ChatManager::new` (96 lines) — break the 50-line
function limit. The file is already cleanly stratified into six bands: shared update/error types, the `ChatManagerDeps`
trait, the `ExternalSessionFacade` trait plus its blanket impl, six sub-manager deps adapters, the `ChatManager`
inherent impl, and a set of free helpers. This plan moves each band into a flat submodule under `chat_manager/`
alongside the existing `chat_manager/send.rs`, splits the ~1000-line inherent impl across six files by the section
comments already in the source, and decomposes the two oversized functions by extracting their guard clauses and their
sub-manager wiring into named helpers. Nothing outside `mainframe-chat` changes: the module path
`mainframe_chat::chat_manager` and every public item re-exported from it stay exactly where they are. This is a pure
move-and-extract refactor with no behavior change.

## Findings that shape the plan (verified in this worktree at `c06fc02a`)

1. **`chat_manager.rs` is 2288 lines, not the brief's 2157.** `#289` (`2ae8e55c`) and `#290` (`05486603`) both landed
   after the brief was written and both edited this file. The brief's sequencing note ("land after #289/#290") is
   therefore already satisfied — `git log --grep=289 --grep=290` shows both on the base commit. No rebase risk remains.
2. **`chat_manager.rs` + `chat_manager/` already coexist.** `mod send;` is declared at `chat_manager.rs:59` and
   `chat_manager/send.rs` (292 lines) is the compliant sibling the brief names as the pattern. The module root stays a
   `.rs` file next to its directory; it does **not** become `chat_manager/mod.rs`, so no external path changes.
3. **`chat_manager/send.rs` starts with `use super::*;` and nothing else.** It reaches `ImageInput`,
   `visible_message_text` and `derive_title_from_message` purely through that glob — `grep -c` proves
   `visible_message_text` and `derive_title_from_message` each appear exactly once in `chat_manager.rs`, on their
   `use` line, and are used only inside `send.rs`. A private `use` in the module root therefore counts as *used* when
   a child consumes it through `use super::*`, and CI runs `cargo clippy --all-targets -- -D warnings`
   (`.github/workflows/rust-port.yml:31`) green today. **This is the load-bearing mechanism for the whole split:** the
   root keeps its existing 47-line `use` block untouched and every new submodule opens with `use super::*;`.
4. **Cross-module private methods need `pub(super)`, and the precedent exists.** An inherent method with no visibility
   modifier is private to the module holding its `impl` block. `send.rs` already declares
   `pub(super) async fn dispatch_command` and `pub(super) async fn send_plain_text` (`send.rs:207,247`) precisely
   because `send_message` in the root calls them. Every private item this plan moves away from its callers takes the
   same modifier.
5. **The adapter structs are constructed only in `ChatManager::new`.** `grep -rn 'EhDeps|LcDeps|PhDeps|CmDeps|
   OfferDeps|RecoveryWrapper|PlanHostImpl'` over the crate returns struct-literal sites only in `chat_manager.rs`
   (`:1127,1133,1146,1164,1179,1190,1744`). No test file builds one. `plan_mode_actions.rs:4` documents that it
   deliberately never names them.
6. **The current section boundaries in `chat_manager.rs`** (line numbers at `c06fc02a`):

   | Lines | Contents |
   |---|---|
   | 1–9 | module doc comment |
   | 11–57 | `use` block |
   | 59 | `mod send;` |
   | 61–71 | `ProcessedAttachments` |
   | 73–128 | `ChatUpdate` + `From<&EventChatUpdate>` + `From<&LifecycleChatUpdate>` |
   | 130–313 | `pub trait ChatManagerDeps` |
   | 315–382 | `pub trait ExternalSessionFacade` + blanket impl for `ExternalSessionService<D>` |
   | 384–385 | `type Registry` / `type QueuedRefs` |
   | 387–425 | `is_working`, `enrich_chat` |
   | 427–446 | `enrich_and_emit` |
   | 448–533 | `EhDeps` + `impl EventHandlerDeps` |
   | 534–666 | `LcDeps` + `impl LifecycleManagerDeps` |
   | 667–712 | `PlanHostImpl` + `impl PlanHost` |
   | 713–799 | `PhDeps` + `impl PermissionHandlerDeps` |
   | 800–875 | `CmDeps` + `impl ConfigManagerDeps` |
   | 876–896 | `apply_tuning_impl` |
   | 898–930 | `queued_for_chat`, `handle_queued_processed`, `clear_all_queued_for_chat` |
   | 934–1058 | `RecoveryWrapper` + inherent impl + `impl TranscriptPresenceDeps` + `impl DegradedRecoveryDeps` |
   | 1059–1103 | `OfferDeps` + `impl WorktreeOfferDeps` |
   | 1104–1118 | `pub struct ChatManager` |
   | 1120–2124 | `impl ChatManager` (the facade) |
   | 2126–2186 | `CommandMeta`, `SendError` + `From<AdapterError>`, `TrustWorkspaceError`, `ChatFieldsPartial`, `ForkError` + `status_code` |
   | 2188–2223 | `build_history_session`, `remap_history`, `now_ms` |
   | 2225–2226 | `#[cfg(test)] pub(crate) mod tests;` |
   | 2228–2288 | PORT STATUS footer |

7. **The facade impl's own section comments give the split.** Inside `impl ChatManager`:
   `1121–1278` construction + plumbing (`new`, `with_external_sessions`, `attach_self`, `external_session_service`,
   `emit`, `get_active`, `is_chat_working`, `recover_stale_working_state`, `dispose`, `scan_idle_sessions`);
   `1279–1361` registry + queue reads; `1362–1522` `// ── lifecycle delegations`; `1523–1570`
   `// ── registry reads (enriched)`; `1571–1637` `// ── in-memory cache sync + out-of-band broadcast`;
   `1638–1767` `// ── history + context reads`; `1768–1915` `// ── config + worktree delegations`;
   `1916–2124` `// ── the message send path + CLI-owned queue`.
8. **Only two crates name `chat_manager`.** `mainframe-chat` itself (`attachment_processor.rs`, `plan_mode_actions.rs`,
   and their tests) and `mainframe-server` (`chat_deps.rs`, `ctx.rs`, `automations_deps/*`, `routes/chats.rs`,
   `websocket.rs`, and three integration tests). Every one of them imports through `mainframe_chat::chat_manager::…`,
   so the re-export set in the module root is the compatibility contract. `plan_mode_actions/tests.rs` additionally
   reaches `crate::chat_manager::tests::StoreDeps`, so the `#[cfg(test)] pub(crate) mod tests;` declaration must stay
   in the root.
9. **`chat_manager/tests.rs` calls one private free function by path:** `super::enrich_chat(...)` at ten sites
   (`tests.rs:1570,1583,1607,1624,1633,1647,1662,1676,1688,1699`, inside `mod background_activity`), and `now_ms()`
   through the glob at `tests.rs:708,710`. `enrich_chat` has no non-test caller outside its own band, so a re-import in
   the root would be dead in a plain `cargo build`; the test module gets an explicit path instead (Task 6).
10. **`send_message` computes "is the session spawned?" twice** with an identical 10-line expression
    (`:1960-1969` and `:1978-1987`), and `ChatManager::new` is 96 lines of straight-line collaborator wiring
    (`:1121-1216`). These are the only two functions over the limit, per the brief.
11. **`RecoveryWrapper` is built by `ChatManager::recovery_wrapper` (`:1743-1751`) with a struct literal.** Moving the
    wrapper without moving that method would force `pub(super)` on all five of its fields; moving the method into the
    same file keeps them private.
12. **The Rust daemon has no JS package of its own.** The precedent for a Rust-only change with no user-visible
    behavior is `.changeset/agent-qa-scripts-rust-daemon.md`, an empty changeset. See D5.

## Design decisions

- **D1 — Flat submodules under `chat_manager/`, never nested.** `use super::*;` only reaches the module root when the
  submodule is one level down. A `chat_manager/adapters/event.rs` would need `use crate::chat_manager::*;` and would
  break the pattern `send.rs` already sets (finding 3). Every new file therefore sits directly in `chat_manager/`.
- **D2 — Each adapter file owns its own construction.** Instead of exporting the deps structs and all ~31 of their
  fields to the constructor's module, each adapter file gains a `pub(super) fn build(...)` that returns the *assembled
  sub-manager* (`Arc<EventHandler<EhDeps>>`, `ChatPermissionHandler<PhDeps>`, …). Only the struct's **type name** needs
  `pub(super)` (the `ChatManager` fields are typed with it); every field stays private to its file. This is the single
  deviation from "pure move" in the adapter tasks and it is what makes the constructor fit in 50 lines. The structs and
  their trait impls are moved byte-identically — the deps-injection design is untouched, per the brief's out-of-scope
  list.
- **D3 — The constructor returns a `Collaborators` bundle, not a builder.** `ChatManager::new` keeps ownership of the
  four shared cells and the `self_ref` `OnceLock`, then calls one `Collaborators::build(...)` that makes the five
  `build` calls from D2 in dependency order. `Collaborators` is a plain private struct of already-built values with no
  setters and no partial state; the brief's "do not introduce a builder type" is respected.
- **D4 — `send_message` gets four helpers, not the brief's two.** The brief names the worktree-missing bail and the
  transcript-missing reset. Two more are needed to clear 50 lines with headroom: `session_is_spawned` (the expression
  duplicated at `:1960` and `:1978`, finding 10) and `require_live_session` (the 10-line post-spawn cell+session
  resolution at `:1992-2001`). Both are mechanical extractions of contiguous blocks. The helpers stay on `ChatManager`
  in the new `send_entry.rs`, not in `send.rs` — they are entry guards, not dispatch, exactly as the brief directs.
- **D5 — Empty changeset.** No package's behavior changes and the Rust daemon has no changelog-bearing package of its
  own; `pnpm changeset --empty` with a one-line note matches `.changeset/agent-qa-scripts-rust-daemon.md`
  (finding 12). If the reviewer wants a visible entry instead, a `patch` on `@qlan-ro/mainframe-core` is the
  substitute — that is the package whose version the release pipeline reads for the daemon.
- **D6 — Test files are out of scope, as the brief decides.** `chat_manager/tests.rs` (2105 lines) is not split. It is
  edited only where a moved item changed its path (Task 6). The exclusion goes in the PR description.
- **D7 — One PR, one commit per extraction.** Per the brief. Every task below ends with the crate compiling, so each
  commit is independently reviewable and bisectable.

## Target layout

All paths under `packages/core-rs/crates/mainframe-chat/src/`.

| File | Holds | From lines | ~Size |
|---|---|---|---|
| `chat_manager.rs` (root) | doc comment, `use` block, `mod`/`use` wiring, `Registry`/`QueuedRefs`, `pub struct ChatManager`, public re-exports, `mod tests;`, PORT STATUS | 1–59, 384–385, 1104–1118, 2225–2288 | ~180 |
| `chat_manager/update.rs` | `ProcessedAttachments`, `ChatUpdate`, both `From` impls | 61–128 | ~70 |
| `chat_manager/errors.rs` | `CommandMeta`, `SendError`, `TrustWorkspaceError`, `ChatFieldsPartial`, `ForkError` | 2126–2186 | ~65 |
| `chat_manager/deps.rs` | `pub trait ChatManagerDeps` | 130–313 | ~185 |
| `chat_manager/external_facade.rs` | `ExternalSessionFacade` + blanket impl | 315–382 | ~70 |
| `chat_manager/shared.rs` | `is_working`, `enrich_chat`, `enrich_and_emit`, `apply_tuning_impl`, three queued-ref helpers, `build_history_session`, `remap_history`, `now_ms` | 387–446, 876–930, 2188–2223 | ~155 |
| `chat_manager/deps_event.rs` | `EhDeps` + impl + `build` | 448–533 | ~100 |
| `chat_manager/deps_lifecycle.rs` | `LcDeps` + impl + `build` | 534–666 | ~145 |
| `chat_manager/deps_permission.rs` | `PlanHostImpl` + `PhDeps` + impls + `build` | 667–799 | ~165 |
| `chat_manager/deps_config.rs` | `CmDeps` + impl + `build` | 800–875 | ~90 |
| `chat_manager/deps_recovery.rs` | `RecoveryWrapper` + three impls + `ChatManager::recovery_wrapper` | 934–1058, 1743–1751 | ~140 |
| `chat_manager/deps_offer.rs` | `OfferDeps` + impl + `build` | 1059–1103 | ~60 |
| `chat_manager/construct.rs` | `ChatManager::new`, `Collaborators`, plumbing accessors | 1121–1278 | ~170 |
| `chat_manager/reads.rs` | registry/queue reads, enriched reads, cache sync + broadcasts | 1279–1361, 1523–1637 | ~205 |
| `chat_manager/lifecycle_api.rs` | lifecycle + permission delegations | 1362–1522 | ~165 |
| `chat_manager/history.rs` | history, context, degraded-recovery delegations | 1638–1742, 1752–1767 | ~125 |
| `chat_manager/config_api.rs` | config + worktree delegations, `remove_project` | 1768–1915 | ~150 |
| `chat_manager/send_entry.rs` | `send_message` + four guards, `set_working`, queue edit/cancel, `find_ref` | 1916–2124 | ~230 |
| `chat_manager/send.rs` | unchanged | — | 292 |
| `chat_manager/tests.rs` | unchanged except two import paths | — | 2105 |

## The mechanical rules every move task follows

Read these once; they are not repeated per task.

1. **Move, do not rewrite.** Cut the lines named in the task, paste them into the new file, keep doc comments and
   section comments with the code they annotate. Do not reformat, reorder, rename, or "improve" anything moved.
2. **Every new file opens with:** a one-line `//!` module doc saying what band it holds, then `use super::*;`. No other
   `use` unless the compiler demands it.
3. **Visibility:** a moved item that is called from outside its new file gains `pub(super)`. Items already `pub` stay
   `pub`. Struct *fields* never gain visibility — if a field needs to be read from another file, the construction
   belongs in the field's own file instead (D2).
4. **Re-exports:** in the module root, add `pub use <submodule>::{…};` for every item that was `pub` before the move,
   and a plain `use <submodule>::{…};` for private items that other submodules reach through the `use super::*` glob.
5. **If rustc reports an unused import in the root** for something you just re-imported there, the item has no non-test
   consumer: delete the root line and import it by full path where it is used. `enrich_chat` is the one known case
   (finding 9, handled in Task 6).
6. **If rustc reports E0624 (private method), E0603 (private item), `error: type X is private`, or a
   `private_interfaces` warning,** add `pub(super)` to the definition it names — including a *type* named in the
   signature of an item that is itself already `pub(super)`. Do not widen to `pub(crate)` or `pub`. Rule 3 covers
   fields only; it never justifies leaving a type name private.
7. **Every task ends green.** `cd packages/core-rs && cargo check -p mainframe-chat` must exit 0 before the task's
   commit. Tasks that touch behavior-bearing code additionally run the crate's tests.

---

## Tasks

### Task 1 — Land this plan (done by the planning stage)

**Files:** `docs/plans/2026-08-01-todo-292-chat-manager-file-limits-plan.md` (new)

**Verify:** `git log --oneline origin/main..HEAD` shows the plan commit and `git show --stat HEAD` lists the plan file.

---

### Task 2 — Extract `chat_manager/update.rs` and `chat_manager/errors.rs`

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/update.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/errors.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Move `:61-128` into `update.rs`: `ProcessedAttachments`, `ChatUpdate`, `impl From<&EventChatUpdate> for ChatUpdate`,
   `impl From<&LifecycleChatUpdate> for ChatUpdate`.
2. Move `:2126-2186` into `errors.rs`: `CommandMeta`, `SendError` + `impl From<AdapterError>`, `TrustWorkspaceError`,
   `ChatFieldsPartial`, `ForkError` + `impl ForkError { status_code }`.
3. In the root, next to `mod send;`, add `mod errors;` and `mod update;`, then
   `pub use errors::{ChatFieldsPartial, CommandMeta, ForkError, SendError, TrustWorkspaceError};` and
   `pub use update::{ChatUpdate, ProcessedAttachments};`.

`ProcessedAttachments` is imported by `attachment_processor.rs` and `ChatUpdate` by `plan_mode_actions.rs`, both as
`crate::chat_manager::…` — the re-exports keep those paths valid with no edit to either file.

**Verify:**
- `cd packages/core-rs && cargo check -p mainframe-chat`
- `git diff --stat` on the three files shows a near-equal add/remove count.

---

### Task 3 — Extract `chat_manager/deps.rs` (the `ChatManagerDeps` trait)

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/deps.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move `:130-313` — the whole `pub trait ChatManagerDeps` block including its 5-line leading doc comment and every
per-method doc comment. Add `mod deps;` + `pub use deps::ChatManagerDeps;` to the root.

This trait is the crate's dependency-injection surface: `mainframe-server`'s `chat_deps.rs` implements it and
`plan_mode_actions.rs` names it. Both import `mainframe_chat::chat_manager::ChatManagerDeps`; the re-export keeps that
path. Do not touch a single method signature, default body, or doc comment — several doc comments carry
`Required, not defaulted:` rationales tied to #273/#289/#290.

**Verify:**
- `cd packages/core-rs && cargo check -p mainframe-chat && cargo check -p mainframe-server`
- `git diff origin/main -- packages/core-rs/crates/mainframe-server/` is empty.

---

### Task 4 — Extract `chat_manager/external_facade.rs`

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/external_facade.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move `:315-382`: `pub trait ExternalSessionFacade` and
`impl<D: ExternalSessionDeps + 'static> ExternalSessionFacade for ExternalSessionService<D>`. Add
`mod external_facade;` + `pub use external_facade::ExternalSessionFacade;`.

`mainframe-server/src/chat_deps.rs` imports this name; the re-export covers it.

**Verify:** `cd packages/core-rs && cargo check -p mainframe-chat && cargo check -p mainframe-server`.

---

### Task 5 — Extract `chat_manager/shared.rs` (free helpers)

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/shared.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move, in this order, keeping the two `// ──` section comments with their functions:

1. `:387-425` — `is_working`, `enrich_chat`
2. `:427-446` — `enrich_and_emit`
3. `:876-896` — `apply_tuning_impl` (with its 3-line doc comment)
4. `:898-930` — the queued-ref section comment plus `queued_for_chat`, `handle_queued_processed`,
   `clear_all_queued_for_chat`
5. `:2188-2223` — `build_history_session`, `remap_history`, `now_ms`

Mark `pub(super)`: `enrich_chat` (called from `chat_manager::tests`), `enrich_and_emit`, `apply_tuning_impl`,
`queued_for_chat`, `handle_queued_processed`, `clear_all_queued_for_chat`, `build_history_session`, `remap_history`,
`now_ms`. Leave `is_working` private unless the compiler says otherwise.

`type Registry` and `type QueuedRefs` (`:384-385`) **stay in the root** — the `ChatManager` struct and several adapters
are typed with them, and `use super::*` carries them into every submodule.

In the root add `mod shared;` and
`use shared::{apply_tuning_impl, build_history_session, clear_all_queued_for_chat, enrich_and_emit,
handle_queued_processed, now_ms, queued_for_chat, remap_history};`. Per rule 5, drop from that list anything rustc
flags as unused — `enrich_chat` is deliberately absent (Task 6 handles it).

**Verify:**
- `cd packages/core-rs && cargo check -p mainframe-chat` (lib only — this is the gate for this task).
- `cargo test -p mainframe-chat` is expected to **fail to compile** here on `super::enrich_chat` in the test module.
  That is Task 6's job; do not fix it by widening visibility in the root.

---

### Task 6 — Repoint the two test paths that Task 5 moved

**Files:** `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`

Import-path adjustments only. No assertion changes.

1. In `mod background_activity` (`tests.rs:1526`), add `use crate::chat_manager::shared::enrich_chat;` to its
   `use` list and rewrite the eight `super::enrich_chat(` call sites (`:1570, 1583, 1607, 1624, 1633, 1647, 1662,
   1676, 1688, 1699` — confirm the exact set with `grep -n 'super::enrich_chat' tests.rs`) to bare `enrich_chat(`.
2. `now_ms()` at `:708,710` resolves through `use super::*` only if the root's `use shared::…now_ms…` survived Task 5.
   If rustc cannot find it, add `use crate::chat_manager::shared::now_ms;` at the top of `tests.rs` and drop `now_ms`
   from the root's re-import list.

**Verify:**
- `cd packages/core-rs && cargo test -p mainframe-chat`
- `git diff -- packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` contains no changed `assert*` line.

---

### Task 7 — Extract `chat_manager/deps_offer.rs` and rewire its construction

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/deps_offer.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Move `:1059-1103` — `OfferDeps` (keep its doc comment) and `impl WorktreeOfferDeps for OfferDeps`. Declare it
   `pub(super) struct OfferDeps`; fields stay private.
2. Add to the same file:

```rust
pub(super) fn build(
    deps: &Arc<dyn ChatManagerDeps>,
    active_chats: &Registry,
    permissions: &Arc<Mutex<PermissionManager>>,
) -> Arc<WorktreeOfferRegistry> {
    Arc::new(WorktreeOfferRegistry::new(Arc::new(OfferDeps {
        deps: deps.clone(),
        active_chats: active_chats.clone(),
        permissions: permissions.clone(),
    })))
}
```

3. In `ChatManager::new`, replace `:1127-1131` with
   `let worktree_offers = deps_offer::build(&deps, &active_chats, &permissions);`.
4. Root: `mod deps_offer;`. No re-export — `OfferDeps` is private implementation detail and no other file names it.

**Verify:** `cd packages/core-rs && cargo check -p mainframe-chat`.

---

### Task 8 — Extract `chat_manager/deps_event.rs` and rewire its construction

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/deps_event.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Move `:448-533` — the `// ── sub-manager Deps wrappers ──` section comment, `EhDeps`, and
   `impl EventHandlerDeps for EhDeps`. Declare `pub(super) struct EhDeps` (the `ChatManager` field, `LcDeps`,
   `PlanHostImpl`, `PhDeps` and `RecoveryWrapper` are all typed `Arc<EventHandler<EhDeps>>`); fields stay private.
2. Add `pub(super) fn build(deps, active_chats, messages, permissions, queued_refs, worktree_offers) ->
   Arc<EventHandler<EhDeps>>` holding the body of `:1133-1144` (the `EhDeps` literal plus `EventHandler::new`), taking
   each argument by reference and cloning inside.
3. In `ChatManager::new`, replace `:1133-1144` with the single `deps_event::build(...)` call.
4. Root: `mod deps_event;` and `use deps_event::EhDeps;` (the `ChatManager` struct field needs the name in scope).

**Verify:** `cd packages/core-rs && cargo check -p mainframe-chat`.

---

### Task 9 — Extract `chat_manager/deps_lifecycle.rs` and rewire its construction

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/deps_lifecycle.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Move `:534-666` — `LcDeps` and `impl LifecycleManagerDeps for LcDeps`. Declare `pub(super) struct LcDeps`.
2. Add `pub(super) fn build(deps, active_chats, messages, permissions, event_handler, worktree_offers) ->
   Arc<ChatLifecycleManager<LcDeps>>` holding `:1146-1157` (the `LcDeps` literal plus `ChatLifecycleManager::new`).
3. Replace `:1146-1157` in `ChatManager::new` with the call.
4. Root: `mod deps_lifecycle;` and `use deps_lifecycle::LcDeps;`.

**Verify:** `cd packages/core-rs && cargo check -p mainframe-chat`.

---

### Task 10 — Extract `chat_manager/deps_permission.rs` and rewire its construction

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/deps_permission.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

`PlanHostImpl` ships with `PhDeps` because it exists only to be wrapped in the `PlanModeHandler` that `PhDeps` holds.

1. Move `:667-712` — `PlanHostImpl` (keep its 6-line doc comment; it explains the weak-self upgrade) and
   `impl PlanHost for PlanHostImpl`. Keep `PlanHostImpl` fully private.
2. Move `:713-799` — `PhDeps` and `impl PermissionHandlerDeps for PhDeps`. Declare `pub(super) struct PhDeps` (the
   `ChatManager` field is `ChatPermissionHandler<PhDeps>`).
3. Add one `pub(super) fn build(deps, active_chats, messages, permissions, event_handler, lifecycle, self_ref) ->
   ChatPermissionHandler<PhDeps>` holding `:1164-1188` — the `PlanHostImpl` literal, the `PlanModeHandler::new(
   ChatPlanModeCtx { … })`, the `PhDeps` literal, and `ChatPermissionHandler::new`. Keep the `plan_host`/`plan_mode`
   locals and their types (`Arc<dyn PlanHost>`) as written.
4. Replace `:1164-1188` in `ChatManager::new` with the call. The `self_ref` `OnceLock` and its 3-line comment at
   `:1159-1163` stay in `new` — `new` returns the `self_ref` field.
5. Root: `mod deps_permission;` and `use deps_permission::PhDeps;`.

**Verify:**
- `cd packages/core-rs && cargo check -p mainframe-chat`
- `cargo test -p mainframe-chat --lib plan_mode` — `chat_manager/tests/plan_mode.rs` pins the three
  `PhDeps::plan_mode_*` forwarding branches and the `PlanHostImpl` wiring.

---

### Task 11 — Extract `chat_manager/deps_config.rs` and rewire its construction

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/deps_config.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Move `:800-875` — `CmDeps` and `impl ConfigManagerDeps for CmDeps`. Declare `pub(super) struct CmDeps`.
2. Add `pub(super) fn build(deps, active_chats, permissions, lifecycle, worktree_offers) ->
   ChatConfigManager<CmDeps>` holding `:1190-1196`.
3. Replace `:1190-1196` in `ChatManager::new` with the call.
4. Root: `mod deps_config;` and `use deps_config::CmDeps;`.

**Verify:** `cd packages/core-rs && cargo check -p mainframe-chat`.

---

### Task 12 — Extract `chat_manager/deps_recovery.rs`, including its accessor

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/deps_recovery.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Move `:934-1058` — the `// ── ChatManager facade ──` section comment stays in the root with the struct; take the
   `RecoveryWrapper` doc comment, the struct, `impl RecoveryWrapper` (`active_chat_mut`, `current_chat`),
   `impl TranscriptPresenceDeps for RecoveryWrapper`, and `impl DegradedRecoveryDeps for RecoveryWrapper`. Declare it
   `pub(super) struct RecoveryWrapper`; all five fields stay private.
2. Also move `ChatManager::recovery_wrapper` (`:1743-1751`) into this file as its own
   `impl ChatManager { pub(super) fn recovery_wrapper(&self) -> RecoveryWrapper { … } }` (finding 11). Keeping the only
   constructor in this file is what keeps the five *fields* private (rule 3); it does not keep the *type name* private.
   The four callers (`:1718, 1724, 1733, 1739`) move to `history.rs` in Task 16, so they bind a `RecoveryWrapper` local
   and pass `&wrapper` to a generic — a `pub(super) fn` returning a private type is `error: type RecoveryWrapper is
   private` at every call site, plus a `private_interfaces` warning that `-D warnings` turns into a failure. Hence
   `pub(super)` on the struct in step 1.
3. Root: `mod deps_recovery;`. No `use`, no re-export.

**Verify:**
- `cd packages/core-rs && cargo test -p mainframe-chat` (the degraded-recovery and transcript-presence cases run here)
- `cargo check -p mainframe-server`

---

### Task 13 — Extract `chat_manager/construct.rs` and get `ChatManager::new` under 50 lines

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/construct.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move `:1120-1278` (the opening of `impl ChatManager` through `scan_idle_sessions`) into an `impl ChatManager` block in
`construct.rs`: `new`, `with_external_sessions`, `attach_self`, `external_session_service`, `emit`, `get_active`,
`is_chat_working`, `recover_stale_working_state`, `dispose`, `scan_idle_sessions`.

Mark `pub(super)`: `emit`, `get_active`, `is_chat_working` (called from `reads.rs`, `send_entry.rs`, `history.rs`,
`config_api.rs`, `send.rs`). The rest are already `pub`.

Then decompose `new`. After Tasks 7–11 its body is already five `deps_*::build(...)` calls; fold them into a bundle:

```rust
struct Collaborators {
    event_handler: Arc<EventHandler<EhDeps>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    permission_handler: ChatPermissionHandler<PhDeps>,
    config: ChatConfigManager<CmDeps>,
    worktree_offers: Arc<WorktreeOfferRegistry>,
}

impl Collaborators {
    fn build(
        deps: &Arc<dyn ChatManagerDeps>,
        active_chats: &Registry,
        messages: &Arc<Mutex<MessageCache>>,
        permissions: &Arc<Mutex<PermissionManager>>,
        queued_refs: &QueuedRefs,
        self_ref: &Arc<std::sync::OnceLock<std::sync::Weak<ChatManager>>>,
    ) -> Self { /* the five build calls, in the order Tasks 7-11 established */ }
}
```

`new` then reads: create the four shared cells, create `self_ref` (keep its 3-line comment verbatim — it explains the
fail-closed plan-mode behavior), call `Collaborators::build`, start the idle scanner, and return `Self { … }`. Target
~32 lines; the hard cap is 50. `Collaborators::build` is ~12 lines of body.

Construction order is load-bearing and must not change: offers → event handler → lifecycle → permission handler →
config. `LcDeps` holds the event handler, `PhDeps` holds both, `CmDeps` holds the lifecycle.

**Verify:**
- `cd packages/core-rs && cargo test -p mainframe-chat`
- Count the body of `new` — it must be under 50 lines.
- `cargo check -p mainframe-server` (this crate calls `ChatManager::new`, `with_external_sessions` and `attach_self`).

---

### Task 14 — Extract `chat_manager/reads.rs`

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/reads.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move into one `impl ChatManager` block, keeping the three `// ──` section comments:

- `:1279-1361` — `get_chat`, `list_chats`, `list_all_chats`, `is_chat_running`, `get_session_for_chat`,
  `get_queued_for_chat`, `handle_queued_processed`, `clear_all_queued_for_chat`
- `:1523-1570` — `// ── registry reads (enriched)`, `list_filtered`, `get_effective_path`, `get_project_path`,
  `get_chat_project_id`
- `:1571-1637` — `// ── in-memory cache sync + out-of-band broadcast`, `sync_chat_tags`, `sync_chat_fields`,
  `emit_chat_updated`, `notify_worktree_deleted`, `apply_tuning`, `add_mention`

All are `pub`. Note that `ChatManager::handle_queued_processed` / `clear_all_queued_for_chat` are the public facade
methods that delegate to the same-named free functions now in `shared.rs`; the glob keeps both names resolvable
because the free functions are reached unqualified and the methods through `self.`.

**Verify:**
- `cd packages/core-rs && cargo test -p mainframe-chat`
- `wc -l packages/core-rs/crates/mainframe-chat/src/chat_manager/reads.rs` < 300.

---

### Task 15 — Extract `chat_manager/lifecycle_api.rs`

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/lifecycle_api.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move `:1362-1522` — the `// ── lifecycle delegations` section comment, `create_chat`, `create_chat_with_defaults`,
`resume_chat`, `trust_workspace`, `load_chat`, `start_chat`, `interrupt_chat`, `archive_chat`, `end_chat`,
`unarchive_chat`, `rename_chat`, `respond_to_permission`, `get_pending_permission`, `has_pending_permission`,
`clear_pending_permission`. All `pub`.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat`.

---

### Task 16 — Extract `chat_manager/history.rs`

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/history.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move `:1638-1742` and `:1752-1767` — the `// ── history + context reads` section comment, `get_messages`,
`get_messages_from_disk`, `get_display_messages`, `reconcile_transcript`, `continue_here`,
`continue_in_project_root`, `recreate_worktree`, `history_session`, `get_session_context`. `recovery_wrapper`
(`:1743-1751`) is **not** here — Task 12 moved it to `deps_recovery.rs`.

`history_session` is private and is called only from `get_messages` / `get_messages_from_disk` in this same file, so
it stays private.

**Verify:**
- `cd packages/core-rs && cargo test -p mainframe-chat`
- `cargo check -p mainframe-server` (`routes/` calls `get_display_messages`, `continue_here`, `recreate_worktree`).

---

### Task 17 — Extract `chat_manager/config_api.rs`

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/config_api.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Move `:1768-1915` — the `// ── config + worktree delegations` section comment, `update_chat_config`,
`enable_worktree`, `attach_worktree`, `worktree_offers_for_chat`, `dismiss_worktree_offer`, `accept_worktree_offer`,
`disable_worktree`, `fork_to_worktree`, `remove_project`. All `pub`. Keep the "Every worktree rebind below stops and
restarts the CLI" doc comment attached to `enable_worktree`.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat && cargo check -p mainframe-server`.

---

### Task 18 — Extract `chat_manager/send_entry.rs` and get `send_message` under 50 lines

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/send_entry.rs` (new)
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

**Step 1 — move.** Move `:1916-2124` — the `// ── the message send path + CLI-owned queue` section comment,
`send_message`, `set_working`, `edit_queued_message`, `cancel_queued_message`, `find_ref`. Mark `set_working`
`pub(super)` (`send.rs:239,279` calls it). `find_ref` stays private (used only by the two queue methods in this file).
Commit this move on its own and confirm `cargo test -p mainframe-chat` is green — the move and the decomposition must
be separable in review.

**Step 2 — decompose `send_message`** into four helpers on the same `impl` block, each a contiguous block lifted from
the current body (D4):

| Helper | Body from | Notes |
|---|---|---|
| `fn emit_worktree_missing_error(&self, chat_id: &str, chat: &Chat)` | `:1929-1950` | builds the transient error message, appends it to the cache, emits `MessageAdded`, calls `event_handler.emit_display`. The caller keeps `return Ok(())`. |
| `fn session_is_spawned(&self, chat_id: &str) -> bool` | `:1960-1969` | the `get_active(...).map(...).unwrap_or(false)` expression, verbatim. Replaces both `:1960-1969` and `:1978-1987`. |
| `async fn reset_transcript_if_orphaned(&self, chat_id: &str, chat: Option<&Chat>) -> Result<(), SendError>` | `:1954-1974` | reads `transcript_missing` off `chat`, calls `self.session_is_spawned(chat_id)`, and on `missing && !spawned` awaits `continue_here` mapping the error to `SendError`. Keep the 2-line "Transcript gone + no live CLI" comment on this helper. |
| `fn require_live_session(&self, chat_id: &str) -> Result<(Arc<Mutex<ActiveChat>>, Arc<dyn AdapterSession>), SendError>` | `:1992-2001` | the `ok_or_else` on `get_active` plus the `match guard.session.clone()` spawned check; both error arms keep the exact string `format!("Chat {chat_id} not running")`. |

`send_message` then reads: `get_chat` → worktree-missing guard → `reset_transcript_if_orphaned(...).await?` →
`lifecycle.wait_for_interrupt` → `if !self.session_is_spawned(chat_id) { self.lifecycle.start_chat(chat_id).await; }`
→ `let (post, session) = self.require_live_session(chat_id)?;` → `info!` → stamp `turn_started_at` → dispatch to
`dispatch_command` or `send_plain_text`. Roughly 36 lines.

**Ordering is behavior.** The spawned-ness check inside `reset_transcript_if_orphaned` must run **before**
`wait_for_interrupt`, exactly as it does today, and the second `session_is_spawned` call must run **after** it. Do not
hoist a single shared `spawned` local across the `await` — the two reads deliberately observe different moments.

**Verify:**
- `cd packages/core-rs && cargo test -p mainframe-chat` — the cli-queue, turn-timing and command-routing cases in
  `chat_manager/tests.rs` cover this path.
- Count `send_message`'s body: under 50 lines.
- `git diff` for step 2 shows only re-indentation plus the four `fn` signatures and their call sites.

---

### Task 19 — Root cleanup and PORT STATUS refresh

**Files:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

What should remain, in this order: the module doc comment, the `use` block (`:11-57`, unchanged), the `mod` and
`use`/`pub use` wiring, `type Registry` / `type QueuedRefs`, the `// ── ChatManager facade ──` section comment,
`pub struct ChatManager`, `#[cfg(test)] pub(crate) mod tests;`, and the PORT STATUS footer. Nothing else.

1. Sort the `mod` declarations alphabetically and group the `pub use` re-exports below them.
2. Update the module doc comment (`:1-9`): keep its explanation of the closure-bag → deps-wrapper port decision, and
   add two or three lines naming the layout — `deps.rs` (injection surface), `deps_*.rs` (one sub-manager adapter
   each, each owning its own construction), `construct.rs`/`reads.rs`/`lifecycle_api.rs`/`history.rs`/
   `config_api.rs`/`send_entry.rs`/`send.rs` (the facade, by band). **This is a genuinely new paragraph, not a move —
   list it in the PR description under "not a move".**
3. In the PORT STATUS footer, leave every existing `// notes:` line alone (they are the port ledger and several cite
   #273/#289/#290) and append one line recording that the module was split into submodules under `chat_manager/` with
   no API change, with the todo number.
4. Delete nothing else. If a `use` line in the root now trips `unused_imports`, apply rule 5 rather than removing an
   import a submodule still needs through the glob.

**Verify:**
- `cd packages/core-rs && cargo clippy -p mainframe-chat --all-targets -- -D warnings`
- `wc -l packages/core-rs/crates/mainframe-chat/src/chat_manager.rs` < 300.

---

### Task 20 — Changeset

**Files:** `.changeset/<name>.md` (new)

Run `pnpm changeset --empty` and set the body to one sentence, following
`.changeset/agent-qa-scripts-rust-daemon.md`:

> Internal refactor of the Rust daemon's chat-manager module — no behavior change.

D5 explains why this is empty rather than a `@qlan-ro/mainframe-core` patch.

**Verify:** the file exists under `.changeset/` and `git status --short` shows it.

---

### Task 21 — Full verification and PR notes

**Files:** none (verification only)

Run from `packages/core-rs`:

- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test -p mainframe-chat`
- `cargo test -p mainframe-server`

Then walk the acceptance criteria:

1. **Every production file under 300 lines.**
   `find crates/mainframe-chat/src/chat_manager* -name '*.rs' -not -name 'tests.rs' -not -path '*/tests/*' | xargs wc -l`
   — every entry must be under 300. `chat_manager/tests.rs` and `chat_manager/tests/` are excluded by decision D6.
2. **Every function under 50 lines.** Only eight function bodies in this tree are not byte-identical moves: `new`,
   `Collaborators::build`, the five `deps_*::build` functions, and `send_message` plus its four helpers. Read each and
   confirm it is under 50. Everything else was already compliant (brief) and was moved unchanged.
3. **No crate outside `mainframe-chat` changed.**
   `git diff --stat origin/main -- packages/core-rs/crates/ ':!packages/core-rs/crates/mainframe-chat'` must be empty.
   `git diff origin/main -- packages/ui packages/types packages/app-tauri` must be empty.
4. **Tests unchanged except paths.**
   `git diff origin/main -- packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` touches only the
   `enrich_chat` / `now_ms` import lines and their call sites (Task 6). No `assert*` line changes.
5. **The diff is dominated by moves.** `git diff --stat origin/main` — expect adds and removes within a few percent of
   each other for the `chat_manager` tree.

In the PR description, list every line that is **not** a move or a mechanical extraction, which should be exactly:

- the five `deps_*::build` functions and the `Collaborators` bundle (D2/D3),
- the four `send_message` helpers (D4),
- the `//!` header on each new file,
- `pub(super)` modifiers added under rule 3/6,
- the module-layout paragraph in the root doc comment and the PORT STATUS line (Task 19),
- the `use`/`pub use` wiring in the root.

Also state the two decisions the brief asked to be made explicit: `#[cfg(test)]` modules and test files are **out of
scope** (D6), and the other oversized files in the crate — `event_handler.rs` (2095), `lifecycle_manager.rs` (1543),
`config_manager.rs` (1100), `worktree_offer/tests.rs` (732), `external_session_service.rs` (708),
`context_tracker.rs` (654), `degraded_recovery.rs` (398), `permission_handler.rs` (370),
`worktree_offer_scan.rs` (332) — are untouched and remain a separate job.

**Verify:** every command above exits 0 and every check above holds.

---

## Task-to-group map

| Group | Kind | Tasks | Files |
|---|---|---|---|
| `chat-manager-extract-shared` | core | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 | `chat_manager.rs`, `chat_manager/{update,errors,deps,external_facade,shared,deps_offer,deps_event,deps_lifecycle,deps_permission,deps_config,deps_recovery}.rs`, `chat_manager/tests.rs` |
| `chat-manager-split-facade` | core | 13, 14, 15, 16, 17, 18, 19, 20, 21 | `chat_manager.rs`, `chat_manager/{construct,reads,lifecycle_api,history,config_api,send_entry}.rs`, `.changeset/*` |

Both groups edit `chat_manager.rs`, so neither is parallel-safe. `chat-manager-split-facade` depends on
`chat-manager-extract-shared`: Task 13's constructor decomposition consumes the five `deps_*::build` functions that
Tasks 7–11 create, and every task in the second group compiles against the re-exports the first group installs.

There is no test group. This refactor adds no test and changes no assertion — the existing
`cargo test -p mainframe-chat` and `cargo test -p mainframe-server` suites are the regression gate, and every task
above runs them.
