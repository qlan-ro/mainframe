# Plan: side chats (always temporary) (#344)

Spec: `docs/specs/2026-09-27-todo-344-side-chats.md`. Spec acceptance criteria are cited as "AC n".
This is the full-form plan. The change spans a migration, the chat manager, a new route, and two UI
areas, well past the short-form threshold. Base: `origin/main` at `1a33c008`, which includes #346 (#718),
#343 (#717) and #178 (#720).

## Goal

A side chat is a chat row with `temporary = 1` and a non-null `parent_chat_id`. It gets no new column and
no new concept. One REST command opens the side chat or reveals the existing one. The existing discard
removes it. Archiving the parent, discarding a temporary parent, and removing the project also remove it.
No listing ever returns it. The UI renders it as a panel docked at the bottom of the parent's chat column,
in the single view or inside the parent's split zone. The panel shows a compact form of #346's notice.

## Wire contract (decided here; both sides implement exactly this)

- **Rust `Chat`** (`mainframe-types/src/chat.rs`) gains two fields. Neither is stored.
  - `side_chat_id: Option<String>`, with `#[serde(default, skip_serializing_if = "Option::is_none")]`. It is
    derived on every DB read by a correlated subquery added to `CHAT_SELECT_FIELDS`:
    `(SELECT s.id FROM chats s WHERE s.parent_chat_id = chats.id AND s.temporary = 1) AS sideChatId`.
    Every `CHAT_SELECT_FIELDS` query selects `FROM chats` with no alias, so the correlation holds.
  - `side_chat_waiting: Option<bool>`, with the same serde attributes. Enrichment sets it only when
    `side_chat_id` is `Some`: it is true when the side chat has a pending permission or question.
- **TS `Chat`** (`packages/types/src/chat.ts`) gains `sideChatId?: string | null` and
  `sideChatWaiting?: boolean`.
- **Open route**: `POST /api/chats/{id}/side-chat`. The path id must be non-empty and match
  `^[a-zA-Z0-9_-]+$`; otherwise the route returns 400. The body is optional. When present it must be an
  empty JSON object, deserialized into a struct with `#[serde(deny_unknown_fields)]`; an unknown field
  returns 400. Every response uses the `ok`/`fail` envelope:
  - `ok(Chat)`, with the enriched side chat, for both a new side chat and an existing one;
  - `fail` 404 when the parent is unknown;
  - `fail` 409 when the parent is archived, is itself a side chat, or has a missing directory.
- **Discard**: the existing `POST /api/chats/{id}/discard` (`routes/chat_discard.rs`), unchanged.
- **Events**: opening never emits `ChatCreated` for the side chat. It emits `ChatUpdated` for the parent,
  which carries `sideChatId`. Discarding a side chat emits its existing `ChatEnded` and a `ChatUpdated` for
  the parent. The reason is in `## Established facts`: mobile adds every `chat.created` chat to its list.

## Core behavior rules (group `daemon-side-chats` follows these exactly)

1. **One side chat per parent, atomic.** Migration **30** adds
   `CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_one_side_chat ON chats(parent_chat_id) WHERE temporary = 1`
   and bumps `LATEST_VERSION` to 30. A new repository method, `find_or_create_side_chat`, does a SELECT and
   then an INSERT inside one `Db::call` closure. The DB worker runs closures one at a time, so two concurrent
   opens cannot both insert, and the index enforces the invariant. The method returns `(Chat, created: bool)`.
   It lives in a new file, `mainframe-db/src/side_chats.rs` (`impl ChatsRepository`), so the 996-line
   `chats.rs` grows only by the subquery, the row mapping, and the list clause.
2. **Seeding (AC 1, AC 9).** The inserted row copies these parent fields: `project_id`, `adapter_id`, `model`,
   `permission_mode`, `plan_mode`, `worktree_path`, `branch_name`, and **`scratch_path`**. It sets
   `temporary = 1` and `parent_chat_id = parent.id`. It has no title, no pending fork, no tags, no pin, and
   zero counters. Copying `scratch_path` makes `chat_cwd` resolve a non-project side chat to the parent's
   scratch directory, and the lazy first-spawn `create_dir_all` makes that directory if needed. Plain
   `ChatsRepository::create` would mint `<scratch_root>/<side id>` instead.
3. **Open refusals (AC 2).** `ChatManager::open_side_chat(parent_id)` goes in a new file,
   `chat_manager/side_chat.rs`. It reads the parent through the enriched `get_chat`, then checks in order:
   - unknown parent → `NotFound`;
   - `status == Archived` → `Archived`;
   - `temporary && parent_chat_id` is set → `ParentIsSideChat`;
   - `directory_missing == Some(true)` → `DirectoryMissing`.
   Each refusal writes no row. A temporary parent and a non-project parent are both allowed. The new
   `ChatManagerDeps::chats_find_or_create_side_chat` is implemented on both impls: `DaemonChatDeps` and the
   test `StoreDeps`.
4. **After open.** When the parent has an active cell, set `cell.chat.side_chat_id`, as `rename_chat` does
   for the title. Then emit an enriched `ChatUpdated` for the parent. Repeat this on every discard of a side
   chat, with the field cleared.
5. **Discard adjustments** (`chat_manager/discard.rs`). For a side chat (`temporary && parent_chat_id` set):
   - skip `remove_scratch_dir`, because the directory belongs to the parent (AC 8);
   - call `teardown_live_chat` with **no worktree sweep path** (see `## Established facts`);
   - after deleting the row, run rule 4 for the parent.
   For any other temporary chat that has a side chat, discard the side chat first (AC 7).
6. **Archive cascade (AC 7).** `ChatManager::archive_chat` discards the parent's side chat **before** it
   calls `lifecycle.archive_chat`. That call is where the requested worktree removal happens. Project
   removal needs no new code: side chats share the parent's `project_id`, so the loop in `remove_project`
   tears them down and `projects.remove`'s `DELETE FROM chats WHERE project_id = ?` deletes their rows. With
   rule 5's sweep exemption, the side chat never sweeps the parent's worktree. Tests prove the cascade.
7. **Listing exclusion (AC 5).** `list_filtered` always adds
   `NOT (temporary = 1 AND parent_chat_id IS NOT NULL)`, including when `include_temporary` is set.
   `routes/chats.rs::filter_temporary` always drops side chats; its unfiltered source read must stay
   unfiltered for `remove_project`. `GET /api/chats/{id}` still returns a side chat.
8. **Refusals already in place (AC 6).** `refuse_if_temporary` refuses pin, tags, archive and unarchive, and
   `ForkChatError::Temporary` refuses fork. Both already cover side chats, so add tests only.
9. **Waiting enrichment (AC 21).** Wherever `enrich_chat` runs (`chat_manager/shared.rs` and the four
   enriched reads in `reads.rs`), set `side_chat_waiting` from `permissions.has_pending(side_id)`.
   `display_status` and `is_running` stay the parent's own. The UI's fork gating reads `hasPending`, so
   changing them would wrongly block forking the parent.
10. **No adapter code (AC 10).** #346's `no_persistence_for_spawn(temporary, capable)` already gives a side
    chat the no-persistence spawn option. The diff touches no `mainframe-adapter-*` crate.

## UI rules (groups `ui-side-chat-state` and `ui-side-chat-panel`)

1. **Side-chat identity.** A helper `isSideChat(chat)` returns `chat.temporary && chat.parentChatId != null`.
   The UI learns which side chat a parent has from `SessionCustom.sideChatId`, projected by
   `chatToThreadCustom` from the REST list. The desktop reloads that list on every `chat.created`,
   `chat.ended` and `chat.updated` event. The open response fills the gap before the next reload.
2. **Never a session (AC 18).** The server exclusion keeps side chats out of the aui thread list. The
   sidebar, tabs, palette and zones all project from that list. Add these defenses:
   - `chats-remote-adapter.fetch` rejects a chat for which `isSideChat` is true, so aui never adopts one
     through `switchToThread`;
   - a `side-chat-ids` registry: the tab store's `ensureTab`/`pinTab` and the zones store's
     `openSplit`/`replaceZone` refuse its ids, and `canOpenInSplit` returns false for them;
   - one navigation helper replaces the raw `switchToThread` in `AppShell`'s session navigator (the toast
     deep link). When the target is a side chat, found in the registry or by `getChat`, it activates the
     parent and expands the panel.
   Persisted tab ids are already restored only against list entries (`restoreTabIds`).
3. **Collapse state.** A small store keeps collapsed or expanded per parent chat id, persisted in
   localStorage under `mf:side-chat-collapsed:<parentChatId>`. A panel is expanded by default. The panel
   height is session-only state; its default is 40% of the column.
4. **Waiting on the parent (AC 21).** `SessionCustom` gains `sideChatWaiting`. `deriveSessionBadge` returns
   `waiting` when it is true. This check goes **ahead of** `working`, because a pending gate beats working
   in the daemon's own `enrich_chat`. `toTabEntry` ORs it into `hasPending`. `hasPending` itself stays the
   parent's own value, so `fork-availability` is unaffected. The session-list router skips `markUnread` for
   side-chat events.
5. **Panel scope binding (the main risk).** The panel mounts a nested `AuiProvider` whose `thread` is an
   `ExternalThread` built from the side chat's controller, following the `ChatZone` pattern. The side chat is
   not in the thread list, so a `threadListItem` bound to it by id has **no state** (see
   `## Established facts`). Inheriting the parent's item instead would make item-keyed state collide with the
   parent: draft config, bottom pin, and composer identity. Settle the binding first, in a failing test. The
   recommended approach is to leave `threadListItem` unbound to the side chat and pass the side chat's
   identity explicitly through a `SideChatScope` context. The parts that read the item id in the panel are
   `ChatThread`'s `threadId`, `ThreadFooterInput`, and the composer identity; they read the side chat id from
   that context. Record the outcome in the group's commit message.
6. **Panel content.** `ChatThread` accepts `variant="side"`. In that variant it:
   - skips the full-size `ContextNotPreservedNotice` (AC 15);
   - renders the compact notice under the panel header instead;
   - hides the adapter switch, the worktree controls and the Temporary toggle in the composer;
   - keeps the model and permission controls.
   The panel header shows "Side chat", a status dot, collapse, and close. `ChatCardHeader` is not reused, so
   no forked-from link renders (AC 22).
7. **Compact notice (AC 14, AC 15).** `ContextNotPreservedNotice` gains `compact` and
   `kind: 'not-preserved' | 'provider-transcript'` props and accepts an explicit test-id key.
   - The compact not-preserved line is keyed by the parent id and uses #346's dismissal store, keyed by the
     **side chat id** and `contextLostAt`.
   - The provider-transcript line shows when `AdapterInfo.capabilities.noPersistence` is false for the side
     chat's adapter. It cannot be dismissed, and it is never shown together with the not-preserved line.
   - Copy is exactly as in the spec. The capability is read from adapter info, never from an adapter id.
8. **Liveness and auto-expand (AC 20).** While the parent is on screen and has a side chat, the panel host
   keeps the side chat's controller loaded and live-subscribed, whether the panel is collapsed or expanded.
   The header toggle reads that controller's state: a running turn shows running, and a pending gate shows
   waiting. A gate that appears while the parent is on screen sets the panel to expanded.

## Tasks

### Group `daemon-side-chats` (core)

**Task 1: contract, migration, repository (AC 1, 3, 5).**
Files:
- `mainframe-types/src/chat.rs`
- `mainframe-db/src/migrations.rs`
- `mainframe-db/src/side_chats.rs` (new)
- `mainframe-db/src/lib.rs`
- `mainframe-db/src/chats.rs` (subquery, row mapping, list clause)
- `mainframe-db/tests/side_chats.rs` (new)
- `mainframe-db/tests/migrations.rs`
Red first: write repository tests for these cases, then implement until they pass:
- `find_or_create` returns the same id on the second call, with `created = false`;
- the seed copies the rule-2 fields;
- `sideChatId` appears on the parent through `get`, `list` and `list_filtered`;
- `list_filtered` excludes side chats with and without `include_temporary`;
- a second insert under the unique index fails.
Also run the existing tests that construct a `Chat` literal; each needs the new fields. The TS twin is in
Task 5, so the two groups can run in parallel against the contract above.

**Task 2: chat manager (AC 2, 4, 7, 8).**
Files:
- `chat_manager/side_chat.rs` (new)
- `chat_manager/deps.rs`
- `chat_manager/discard.rs`
- `chat_manager/lifecycle_api.rs` (archive cascade)
- `chat_manager/shared.rs` and `reads.rs` (waiting enrichment)
- `chat_manager.rs` (module line)
- `mainframe-server/src/chat_deps.rs` (deps impl)
- `chat_manager/tests.rs` (`StoreDeps` impl only)
- `chat_manager/tests/side_chat.rs` (new)
Red first, cover:
- each refusal;
- open then reveal;
- the `ChatUpdated` emissions and the absence of `ChatCreated`;
- discard deletes the row and leaves the parent's scratch directory;
- the side chat's teardown passes no worktree sweep path;
- archive with worktree deletion discards the side chat before the lifecycle archive runs;
- discarding a temporary parent removes its side chat;
- `side_chat_waiting` follows a pending gate.

**Task 3: route and route-level tests (AC 1, 2, 3, 5, 6, 7).**
Files:
- `routes/chat_side_chat.rs` (new, with in-file tests like `chat_discard.rs`)
- `routes/mod.rs`
- `http.rs`
- `routes/chats.rs` (`filter_temporary` only)
Cover:
- 400 on a bad id or an unknown body field;
- 404 and 409 envelopes;
- two concurrent opens via `tokio::join!` leave one row;
- both list endpoints exclude side chats, with and without `includeTemporary`, while `get_one` returns one;
- pin, tags, archive, unarchive and fork each return `fail` for a side chat;
- project removal deletes the side chat's row and stops its session.

**Task 4: lifecycle tests with the test adapter (AC 9, 10, 12, 13).**
Files:
- `mainframe-server/tests/side_chat_lifecycle.rs` (new)
- `tests/temporary_chat_lifecycle_support/{mod.rs,session.rs}`: add a `create_side_chat` helper that opens
  through `ChatManager`, and make `TestSession::spawn` record `SessionSpawnOptions::no_persistence`.
These are test-support changes, not adapter code. Cover:
- the first spawn's cwd is the parent's worktree, else the project path, else the parent's scratch
  directory;
- the spawn carries no-persistence exactly when the capability is on;
- the side chat has none of the parent's history;
- restart with the capability on: same row, `context_lost_at` stamped, a new provider id, no resume, not
  transcript-missing;
- restart with the capability off: the same provider id resumes;
- a restart before any spawn stamps no loss.
Group exit: the touched crates' tests pass, `cargo clippy` is clean for them, no `mainframe-adapter-*` file
changed, and a changeset naming `@qlan-ro/mainframe-app-tauri` is added.

### Group `ui-side-chat-state` (ui)

**Task 5: API, projection, identity guards, waiting badge, menus (AC 18, 19, 21, 22).**
Files:
- `packages/types/src/chat.ts` (the wire contract's TS fields; `tsc --noEmit` for types passes)
- `lib/api/chats.ts` (`openSideChat`)
- `features/sessions/view-model/chat-to-thread-custom.ts` (`sideChatId`, `sideChatWaiting`)
- `session-status.ts`
- `session-tabs/tab-entry.ts`
- `session-tabs/store.ts`
- `chat/zones/zones-store.ts`
- `chat/zones/open-in-split.ts`
- `sessions/runtime/chats-remote-adapter.ts` (fetch guard)
- `sessions/ws/session-list-router.ts` (skip `markUnread`)
- new `features/side-chat/`: `side-chat-ids.ts`, `side-chat-collapse-store.ts`, `use-open-side-chat.ts`,
  `navigate-to-session.ts`
- `app/AppShell.tsx` (navigator)
- `SessionContextMenu.tsx` (`sessions-ctx-side-chat`)
- `SessionTabContextMenu.tsx` (`session-tab-ctx-side-chat`)
Red first:
- store guards refuse registered side-chat ids;
- `fetch` rejects a side chat;
- the badge shows waiting for `sideChatWaiting`, even over working;
- the tab entry reports pending;
- the menu items render for a regular chat and not for a draft or an archived chat;
- the navigation helper routes a side-chat id to its parent and marks the panel expanded;
- `useOpenSideChat` activates the parent when it is off screen, then calls `openSideChat`, then expands.
Existing fork-lineage and fork-availability tests stay green.

### Group `ui-side-chat-panel` (ui)

**Task 6: panel, host placement, header toggle, compact notice (AC 11, 14 to 17, 19, 20, 24).**
Files:
- new `features/side-chat/SideChatPanel.tsx`, `SideChatPanelHeader.tsx`, `SideChatHost.tsx`, and a
  side-chat scope/context file
- `chat/thread/ChatThread.tsx` (`variant`)
- `chat/thread/ContextNotPreservedNotice.tsx` (`compact`/`kind`)
- the composer config-toolbar files that hide the adapter switch, worktree and Temporary controls in the
  side variant
- `chat/thread/ChatCardHeader.tsx` (`side-chat-toggle-<id>`)
- `sessions/new-thread/ChatSurface.tsx` (single-view host)
- `chat/zones/ChatZone.tsx` (zone host)
Start with UI rule 5's binding spike as a failing test. Then cover, red first:
- the panel renders inside `chat-zone-<parentId>` with the other zone's DOM untouched and the zones store
  still holding two ids;
- the panel renders in the single view;
- collapse hides the panel, survives a remount, and keeps the row;
- close calls discard and removes the panel; a failed discard keeps the panel and shows a toast;
- a removed side chat makes the panel disappear with no error;
- the compact not-preserved line renders under the parent-keyed test id and its dismissal survives a
  remount;
- the provider-transcript line renders for a non-capable adapter, with no dismiss control;
- the full-size side-chat-keyed Alert never renders in the panel;
- the toggle shows running and waiting while collapsed, and a gate auto-expands the panel;
- no side-chat surface contains "not saved" or "nothing was saved".
Group exit: `pnpm --filter @qlan-ro/mainframe-ui typecheck` and the touched test files pass. New files stay
under 300 lines, and no function exceeds 50 lines. Add a changeset naming `@qlan-ro/mainframe-ui`.

## Established facts

- The DB worker thread runs one closure at a time, so a SELECT-then-INSERT inside one `call` is atomic
  with respect to other DB calls. Receipt: `mainframe-server/src/db.rs` `Db::spawn` / `Db::call`.
- `create_fork` is the only writer of `parent_chat_id` today, and forks are always `temporary = 0`. No
  existing row can break the partial unique index. Receipt: `mainframe-db/src/chats.rs`
  `ChatsRepository::create_fork`.
- `ChatsRepository::create` mints `scratch_path = <scratch_root>/<new id>` for `NO_PROJECT_ID` chats. A side
  chat therefore needs its own insert to inherit the parent's directory. Receipt: `mainframe-db/src/chats.rs`
  `ChatsRepository::create`.
- The cwd resolves as `worktree_path ?? scratch_path ?? project_path`. Receipt:
  `mainframe-chat/src/chat_cwd.rs` `chat_cwd`.
- `kill_tasks_for_chat` with a `worktree_path` sweeps and SIGTERMs every spool writer under that worktree,
  not just this chat's tasks. A side chat sharing the parent's worktree would kill the parent's background
  work. Receipt: `mainframe-background-tasks/src/kill.rs` `kill_tasks_for_chat` (worktree sweep block), and
  it is called from `chat_manager/discard.rs` `teardown_live_chat`.
- `remove_project` tears down every chat from the unfiltered `chats_list` before `projects_remove`, and the
  repository deletes chat rows by `project_id`. Receipts: `chat_manager/config_api.rs`
  `ChatManager::remove_project`; `mainframe-db/src/projects.rs` (`DELETE FROM chats WHERE project_id = ?`).
- `refuse_if_temporary` backs the pin, tag, archive and unarchive refusals, and `fork_chat` refuses
  temporary parents. Receipts: `routes/chat_discard.rs` `refuse_if_temporary`; `chat_manager/fork_api.rs`
  `ForkChatError::Temporary`.
- A no-persistence spawn needs both `temporary` and the adapter capability. Context loss is stamped only
  when the stored session was ephemeral **and** a provider session id exists, so a side chat that never
  spawned shows no notice. Receipt: `mainframe-chat/src/no_persistence.rs` `no_persistence_for_spawn`,
  `context_was_lost`.
- `enrich_chat` checks `has_pending` before working, and it computes `directory_missing` with
  `project_path = None` for the hidden no-project row, so a non-project parent is never "missing". Receipt:
  `chat_manager/shared.rs` `enrich_chat`.
- Mobile adds every `chat.created` chat to its list, while `chat.updated` only merges into rows it already
  holds. Receipt: `packages/mobile/lib/event-router.ts` `routeEvent`; `packages/mobile/store/chats.ts`
  `addChat` / `updateChat`.
- The desktop reloads the whole thread list on `chat.created`, `chat.ended` and `chat.updated`. Receipt:
  `features/sessions/ws/session-list-router.ts` `SessionListRouter.route`;
  `use-session-list-router.ts` (`onChatUpdated: () => scheduleReload()`).
- The sidebar, the palette and the tab store all project from aui `threads.threadItems`. aui's remote list
  adapter `fetch(threadId)` is how `switchToThread` adopts an unlisted id. Receipts:
  `palette/SpotlightPalette.tsx` (`threadItemsToSessionItems(threadItems)`);
  `sessions/runtime/chats-remote-adapter.ts` `makeChatsRemoteAdapter().fetch`.
- In `@assistant-ui/core` 0.3.12, a thread-list item for an id missing from the list has no state
  (`getThreadListItemState` returns `SKIP_UPDATE`). Receipt:
  `node_modules/.pnpm/@assistant-ui+core@0.3.12…/dist/runtime/api/thread-list-runtime.js`
  `getThreadListItemState`.
- Persisted tabs are restored only for ids present as `regular` list entries. Receipt:
  `session-tabs/tabs-model.ts` `restoreTabIds`.
- `hasPending` feeds the fork-availability gate, so it must stay the parent's own value. Receipt:
  `sessions/view-model/chat-to-thread-custom.ts` (`hasPending: displayStatus === 'waiting'`);
  `sessions/view-model/fork-availability.ts`.
- The lifecycle test harness records each spawn's cwd and provider id, and supplies the capability through
  `TestAdapter::new(no_persistence)`. Receipt: `mainframe-server/tests/temporary_chat_lifecycle_support/session.rs`
  `TestAdapter`.
- `docs/plans/` is gitignored, and plans are committed with `git add -f`. Receipt: `.gitignore` (`docs/plans/`).

## Risks

- **Panel scope binding** (UI rule 5). This is the largest unknown and it is settled first in its group. If
  neither option is clean, the fallback is to render the panel's thread through `ChatZone`'s own
  provider/config builder, extracted into a shared hook, with a synthesized `threadListItem` state.
- **Stale `side_chat_id` on in-memory emissions.** Rule 4 syncs the parent's active cell on open and on
  discard. Every other emission path reads the cell or the DB, so both carry the right value.
- **Files already over 300 lines** (`mainframe-db/src/chats.rs`, `routes/chats.rs`, `chat_deps.rs`,
  `chat_manager/tests.rs`, `mainframe-types/src/chat.rs`). AC 25 cannot hold literally for them. Edits there
  are kept to a few lines each, and new logic goes in new modules.
- **Worktree sweep.** Missing rule 5's sweep exemption would silently kill the parent's background tasks
  when a side chat closes. A test must pin it.

## Exit gates

- Every AC in 1 to 25 maps to a test above or to a stated established fact.
- The Rust groups' crate tests and the UI's touched test files and typecheck pass.
- Both changesets are present.
- The diff adds no file under `packages/core-rs/crates/mainframe-adapter-*`.
