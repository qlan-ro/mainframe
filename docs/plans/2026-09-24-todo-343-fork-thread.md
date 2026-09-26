# Todo #343 — Fork a chat into a new chat that inherits its conversation

Spec: `docs/specs/2026-09-24-todo-343-fork-thread.md` (behavior, test ids, copy,
status codes and acceptance criteria live there and are not repeated here).
Full-form plan: the change spans the Rust contract, the DB, the Claude adapter,
the chat layer, one REST route and five UI surfaces.

## Fork-point mechanism (the spec left this to the planner)

**Snapshot and fork from the snapshot.** At the Fork action the daemon copies
the parent's transcript byte-for-byte into a Mainframe-owned snapshot directory
and records it on the fork. The fork's first spawn runs
`--resume <snapshot>.jsonl --fork-session`. The CLI then mints the fork's own
session id, reports it through `system/init` (`SessionSink::on_init`, already
persisted) and writes the fork's own transcript in the cwd's project dir.

Why this and not the two options the spec named:
- *Spawn the fork now*: the CLI writes no fork file until a turn completes, so
  there is nothing to pin without sending a model turn.
- *`--resume <parent> --fork-session --resume-session-at <uuid>`*: `--resume`
  walks the parent's current leaf chain. If the parent compacts or rewinds
  between the fork and the fork's first message, the pinned uuid leaves the
  chain and the CLI fails hard (`No message found with message.uuid`). A
  snapshot cannot drift, survives restarts, and never needs `--resume-session-at`.
- The copy is verbatim, not the hand-rolled re-stamping copier the #246 research
  rejected: the CLI does the re-stamping itself on the fork path.

Invariants, enforced in the Claude adapter:
- Fork arguments always carry `--fork-session`. The snapshot path is never
  passed to `--resume` without it.
- The parent's session id is never a resume target for a fork: a fork's own id
  only ever comes from `on_init`.
- Resume target resolution (pure, unit-tested): if the fork has its own session
  id **and** that transcript exists, resume it plainly. Otherwise, if a pending
  fork source exists, use the fork arguments. Otherwise, use existing behavior.
  This covers a first turn that crashed after `init` but before the CLI wrote
  the transcript.

Pending-fork lifecycle (daemon-internal; never on the `Chat` wire type):
- Column `chats.pending_fork` (JSON). It holds the adapter's `ForkSource`, the
  snapshot directory and the provisional title.
- Retired when the fork's first turn produces a result (`on_result`): the column
  is cleared and the snapshot directory is removed (best-effort, and a failure
  is logged).
- At daemon startup, snapshot directories that no chat row references are
  swept. This covers a crash between pin and insert, and project removal, which
  deletes chat rows directly.

## Established facts

- `--resume <abs path to a copied .jsonl outside ~/.claude/projects> --fork-session` works with Mainframe's exact stream-json argv (`build_args`) on CLI 2.1.280. `system/init` carries a new session id. The answer reflected only the snapshot's content, not a message sent to the parent after the copy. The new transcript appeared in the cwd's project dir. The parent's and the snapshot's md5 were unchanged. A later plain `--resume <new id>` kept the fork's context. — Live run during planning, 2026-09-24, `/tmp/forkexp.2ZDo` (parent `beff9884…`, fork `ac2930a5…`).
- The fork transcript keeps the inherited entries' original `uuid`s, rewrites `sessionId`, and opens with a `mode` record. — Same live run; `docs/research/2026-07-25-todo-246-claude-fork.md` § "Verified end to end".
- The CLI itself forks with `--session-id <new> --fork-session --resume <transcriptPath|id>`, so `--resume` accepts a transcript path. — `docs/research/2026-07-25-todo-246-claude-fork.md` § "The CLI uses this recipe itself".
- A headless fork writes no file until its first turn, and writes no `forkedFrom` markers. — same doc § "How the copy actually happens".
- `--resume-session-at` without `--fork-session` branches inside the source file. — same doc § "The dangerous combination" (this plan never emits the flag).
- Claude spawn argv is built by `build_args`, which emits `--resume` from `ClaudeSession.resume_session_id` (= `SessionOptions.chat_id`). — `mainframe-adapter-claude/src/session.rs` `build_args`, `ClaudeSession::new`.
- History resolves `<project_dir>/<id>.jsonl`, scans sibling files whose first `sessionId` matches, and reads `<project_dir>/<id>/subagents/*.jsonl`. — `mainframe-adapter-claude/src/history.rs` `discover_session_jsonl_files`, `load_history`.
- `locate_claude_transcript` tries the stored `session_file_path`, then the derived canonical path. — `mainframe-adapter-claude/src/transcript.rs` `locate_claude_transcript`.
- `do_load_chat` returns before creating a session when `claude_session_id` is `None`. `do_start_chat` passes `claude_session_id` as `SessionOptions.chat_id`. — `mainframe-chat/src/lifecycle_manager.rs` `do_load_chat`, `do_start_chat`.
- `on_init` persists `claude_session_id` and `session_file_path`. — `mainframe-chat/src/event_handler.rs` `on_init`.
- Title generation starts only when the title is empty. — `mainframe-chat/src/chat_manager/send.rs` `assign_initial_title`.
- `ChatManager::get_chat` derives `display_status` (Waiting when a permission is pending) and `directory_missing`. — `mainframe-chat/src/chat_manager/reads.rs` `get_chat`, `chat_manager/shared.rs` `enrich_chat`.
- `enrich_chat` sets `display_status = Working` when the main turn runs **or** any live background task exists, but `is_running = Some(working && !has_pending)` tracks the main turn only. So `display_status` is not a "turn in flight" signal; `is_running` plus a pending permission is. — `chat_manager/shared.rs` `enrich_chat`.
- `load_chat` returns `Flight::Skip` for a chat already in `active_chats`, which `create_chat` populates. So `do_load_chat` never runs for a chat created in this daemon run. — `mainframe-chat/src/lifecycle_manager.rs` `load_chat`, `create_chat`.
- Every history read without a live session goes through `build_history_session`, which returns `None` when `claude_session_id` is `None`: `get_messages` / `get_display_messages` on a cache miss (via `history_session`), `get_messages_from_disk`, and the permission-restore loader. The server's `session_for_scan` has the same `claude_session_id?` early return. — `chat_manager/shared.rs` `build_history_session`, `chat_manager/history.rs`, `chat_manager/deps_permission.rs`, `mainframe-server/src/chat_deps.rs` `session_for_scan`.
- `parse_body` treats an empty or whitespace body as `{}`, so a `deny_unknown_fields` empty struct accepts "no body" and rejects unknown fields. — `mainframe-server/src/routes/projects.rs` `parse_body`.
- Migrations form an append-only `add_column_if_missing` chain, with `LATEST_VERSION = 27`. — `mainframe-db/src/migrations.rs`.
- `ChatsRepository::get` has no status filter, so archived rows come back. `GET /api/chats/{id}` returns 404 only for a missing row. — `mainframe-db/src/chats.rs` `get`; `mainframe-server/src/routes/chats.rs` `get_one`.
- Project removal deletes chat rows with `DELETE FROM chats WHERE project_id = ?`. — `mainframe-db/src/projects.rs`.
- The sidebar loads every non-archived chat unfiltered and applies project, tag and synthetic filters in memory. So a parent absent from the loaded list is archived or deleted, and one loaded but filtered out is "filtered out". — `ui/src/features/sessions/runtime/chats-remote-adapter.ts` (`listChats(port)`), `ui/src/features/sessions/SessionSidebar.tsx` (`applySessionFilters`).
- Variant D recipe: the nest wrapper is `ml-3.5 border-l-2 border-sidebar-border pl-2`, with a leading `GitFork` `size-3! shrink-0 text-muted-foreground`. The fallback glyph is `GitFork size-3.5!` inside a `Hint`. — `git show d8000bdb:packages/ui/src/prototype/SessionLineageRowD.tsx` (`NestedRowGroup`, `RowD`).
- UI plumbing: `mfToast.error` (`ui/src/lib/toast.ts`), `useAdaptersStore` / `useAdapters` (`ui/src/store/adapters.ts`), `getChat` (`ui/src/lib/api/chats.ts`), thread switch via `aui.threads.switchToThread` (`ui/src/features/sessions/SessionRow.tsx`).

## Group 1 — fork-contract (core)

Shared types, storage and trait seams. After this group every crate compiles
with the new fields and no behavior has changed.

Files: `packages/core-rs/crates/mainframe-types/src/{chat.rs,adapter.rs}`,
`mainframe-adapter-api/src/adapter.rs`, `mainframe-db/src/{migrations.rs,chats.rs}`,
`mainframe-adapter-codex/src/adapter.rs`, `mainframe-adapter-mock/src/adapter.rs`,
`packages/types/src/{chat.ts,adapter.ts}`, and every struct-literal site of
`Chat`, `SessionOptions` and `AdapterCapabilities` (listed by grep, including
tests and the Claude crate).

1. `Chat.parent_chat_id: Option<Option<String>>`. It is camelCase and uses
   `double_option`, like the other clearable fields. The TS twin is
   `parentChatId?: string | null`. The name and doc stay generic (side chats
   #344 reuse it).
2. `AdapterCapabilities.fork: bool` with `#[serde(default)]`. TS: `fork?: boolean`
   in both `AdapterInfo` shapes. Claude reports `false` here (Group 2 flips it),
   Codex `false`, and the mock takes a constructor option, default `false`.
3. `ForkSource { source_session_id, resume_path: Option<String> }` (serde,
   camelCase) and `SessionOptions.fork_source: Option<ForkSource>`, with serde
   default and skip-if-none. Add a trait method
   `Adapter::pin_fork_point(ForkPinRequest) -> BoxFuture<Result<ForkSource, ForkPinError>>`.
   Its default returns `Unsupported`. `ForkPinRequest` carries the source
   session id, the effective cwd, the stored `session_file_path` and a
   destination dir. `ForkPinError` has `Unsupported`, `TranscriptMissing` and
   `Failed(String)`. The mock's pin echoes the source when its capability is on.
4. Migration 28 adds `chats.parent_chat_id TEXT`, an index on it, and
   `chats.pending_fork TEXT`. Bump `LATEST_VERSION`. `CHAT_SELECT_FIELDS`
   returns `parentChatId`. `pending_fork` is read and written only through
   repo methods (get / clear), like `dismissed_worktrees`.
5. `ChatsRepository::create_fork(...)` is a single INSERT. It carries project,
   adapter, model, permission mode, plan mode, tuning (effort, fast, ultracode,
   adaptive thinking), worktree path and branch, title, `parent_chat_id` and
   `pending_fork`. Counters start at zero; it is unpinned, has no tags and no
   automation run.

TDD: write red tests first in `mainframe-db` for:
- migration 28 applied to a database stamped at 27 that already has chat rows;
- `create_fork` round-trips every inherited field and `parentChatId`;
- `parentChatId` survives archive and unarchive status updates;
- `list_filtered` and `get` return it;
- pending-fork get and clear.

Add a serde test for `Chat` and `AdapterCapabilities`: absent `fork`
deserializes to `false`, and `parentChatId` is camelCase. Codex reports
`fork: false`, and the mock reports whichever value it was built with (AC 12,
Codex half).

Exit:
- The core-rs workspace builds and its existing tests pass.
- The types package builds.
- The UI typecheck passes.

## Group 2 — claude-fork (core)

Files: `packages/core-rs/crates/mainframe-adapter-claude/src/{adapter.rs,session.rs,history.rs,transcript.rs}`,
plus a new `src/fork.rs` for pin and resolve. `session.rs` is already far over
the size limit, so new logic goes in `fork.rs`.

1. `pin_fork_point`:
   - Locate the parent transcript with `locate_claude_transcript`. `Missing`
     maps to `TranscriptMissing`.
   - Copy it to `<dest>/<source_session_id>.jsonl`, dropping any trailing
     partial line, because an idle live parent CLI may be appending metadata.
   - Copy `<project_dir>/<source_session_id>/subagents/` when present.
   - Return `ForkSource { source_session_id, resume_path: Some(<dest>/<id>.jsonl) }`.
   - Any I/O error maps to `Failed`.
2. `ClaudeSession` stores `SessionOptions.fork_source`. A pure
   `resolve_resume(own_id, own_transcript_present, fork_source)` returns
   `Own(id)`, `Fork(path)` or `Fresh`. `build_args` takes that value.
   - `Fork` emits `--resume <path> --fork-session`.
   - `Own` emits `--resume <id>`.
   - `Fork` without `--fork-session` is unrepresentable.
3. `load_history`, `extract_plan_files` and `extract_skill_files` read the
   snapshot directory when resolution yields `Fork`. Generalize
   `discover_session_jsonl_files` to take an explicit project dir, and keep the
   existing signature as the canonical-path wrapper.
4. The Claude capability `fork: true`.

TDD (red first):
- AC 5 argv tests: a fork with no own id gives
  `--resume <snapshot> --fork-session`. An own id with its transcript present
  gives `--resume <own>` without the flag. An own id whose transcript is
  missing, with a fork source, gives the fork arguments again.
- A property check over the resolver: the parent's id never appears as a
  `--resume` value without `--fork-session`.
- Pin tests in a tempdir, pointing `session_file_path` at a fixture: copy,
  trailing-partial-line trim, subagents copy, missing → `TranscriptMissing`.
- A history test: a snapshot dir loads the same messages as the source.
- The Claude adapter reports `fork: true` (AC 12, Claude half).

Exit:
- The crate's tests pass.
- Clippy is clean for the crate.

## Group 3 — daemon-fork (core)

Files:
- `packages/core-rs/crates/mainframe-chat/src/`: a new `fork.rs` (pure helpers)
  and `chat_manager/fork_api.rs`, plus edits to `lifecycle_manager.rs`
  (`do_load_chat`, `do_start_chat`), `chat_manager/shared.rs`
  (`build_history_session`), `chat_manager/send.rs`, `event_handler.rs`
  (`on_result`) and the deps traits and fakes (a pending-fork read on
  `ChatManagerDeps`).
- `mainframe-server/src/{chat_deps.rs,routes/chat_commands.rs}` (`chat_deps.rs`
  covers both the deps impl and `session_for_scan`).
- The daemon startup wiring for the sweep (`mainframe-daemon`).

1. `ChatManager::fork_chat(id) -> Result<Chat, ForkError>`:
   - Checks, in the spec's order, against `get_chat` (enriched): not found
     (404), no adapter fork capability (422, message names `AdapterInfo.name`),
     no `claude_session_id` (409), `transcript_missing` (409),
     `directory_missing` (409), turn in flight (409).
   - "Turn in flight" means the main turn: `is_running == Some(true)` or a
     pending permission (`display_status == Waiting`). It is **not**
     `display_status == Working`, which live background tasks also set. An
     idle chat with a background shell or agent still running can fork (spec
     edge case).
   - Then pins into `<data_dir>/fork-snapshots/<nanoid>/`. `TranscriptMissing`
     maps to 409, `Failed` to 500, and a failed pin removes the directory.
   - Then `create_fork`. On insert failure it removes the directory.
   - Then inserts the chat into `active_chats` and emits `ChatCreated`.
   - A fork of an unsent fork (no own session yet) is refused with 409
     "Nothing to fork yet".
2. Pure helpers in `fork.rs`:
   - `fork_title(parent_title)`: `Untitled (fork)` for an untitled parent, and
     no stacked ` (fork)` marker.
   - Error-to-status mapping.
3. Every session builder learns the pending fork. When `claude_session_id` is
   `None` and a pending fork exists, build the session with `chat_id: None` and
   `fork_source` set, instead of returning early:
   - `build_history_session` in `chat_manager/shared.rs`. This is the path an
     unsent fork's messages take in the common no-restart case: `fork_chat`
     puts the chat in `active_chats`, so `load_chat` skips it and `do_load_chat`
     never runs. It also covers `get_messages_from_disk` and the
     permission-restore loader, which share it.
   - `session_for_scan` in `mainframe-server/src/chat_deps.rs`.
   - `do_load_chat` and `do_start_chat` (after a restart, and for the first
     send).
   - The fork's cwd is its recorded worktree path or its project path, the same
     as the parent's.
4. First-message title: `assign_initial_title` also runs generation when the
   chat has a pending fork and its title still equals the stored provisional
   title. In that case it keeps the provisional title instead of the derived
   one. A rename, or disabled generation, leaves the title alone.
5. `on_result` for a chat with a pending fork retires it: clear the column and
   remove the snapshot dir (log on failure). The startup sweep removes
   unreferenced snapshot dirs.
6. Add `POST /api/chats/{id}/fork` beside interrupt and resume.
   - The body is an empty `deny_unknown_fields` struct parsed with
     `parse_body`, and a blank id returns 400.
   - It returns the `ok`/`fail` envelope with the new chat.

TDD (red first):
- Route tests with a fake fork-capable adapter:
  - success returns `parentChatId` and the inherited fields;
  - a capability-less adapter returns 422 and the message names the adapter;
  - running (`is_running`), waiting and no-session chats return 409;
  - an idle chat with live background tasks (so `display_status` is Working
    but `is_running` is false) forks successfully;
  - a transcript-missing chat returns 409;
  - an unknown id returns 404;
  - an unknown field returns 400;
  - a pin failure returns 500;
  - every failure leaves the chat count unchanged.
- `fork_title` unit tests.
- History test (AC 1): a freshly forked chat, still in `active_chats`, returns
  the parent's messages from `get_display_messages` before its first send, with
  no `load_chat` in between.
- `session_for_scan` returns a session for an unsent fork.
- Lifecycle tests: after a restart an unsent fork loads history through
  `fork_source`, and start passes `fork_source`.
- Title tests: provisional → generated; renamed → kept; generation disabled
  → provisional kept.
- Retire-on-result and the sweep.

Exit:
- The chat and server crates' tests pass.
- Clippy is clean.
- Live check against a dev daemon with the real Claude CLI, via REST:
  - AC 1–4: history before and after the first fork message; the parent is
    unchanged (session id and transcript md5); a parent message after the fork
    is absent from the fork; a daemon restart between the fork and its first
    message; the fork's own id differs from the parent's.
  - AC 8 and AC 11.
- Depends on Group 2 for the live check.

## Group 4 — ui-lineage (ui)

Files (under `packages/ui/src/features/`):
- `sessions/view-model/{chat-to-thread-custom.ts,group-sessions.ts}`, plus a new
  `sessions/view-model/fork-lineage.ts`;
- `sessions/{SessionList.tsx,SessionListVirtuoso.tsx,SessionRow.tsx,SessionRowMetaLine.tsx,SessionMetaCard.tsx,SessionSidebar.tsx}`;
- a new `sessions/use-parent-chat.ts`;
- `chat/thread/ChatCardHeader.tsx`;
- tests beside each.

Load the `mainframe-design-system` skill before writing markup.

1. `SessionCustom` gains `parentChatId`, `directoryMissing` and `isRunning`
   (from `Chat.isRunning`, default `false`). `isRunning` is consumed by Group 5.
2. `fork-lineage.ts` (pure):
   - `nestForks(groupItems)` reorders one group. Each parent is followed by its
     descendants in contiguous depth-first order, with siblings in the group's
     order. The block stays at the root's position. Each item carries a depth
     capped at 2.
   - Self-references and cycles render flat and must terminate.
   - `arrangeSessions` applies it to every group in every mode, including Pinned.
   - `forkCount(allItems, id)` counts listed, non-archived direct forks and
     excludes self.
   - `classifyParent(...)` returns `nested`, `different-group`, `filtered-out`,
     `archived`, `deleted` or `none`.
3. `use-parent-chat.ts`: when the parent is not in the loaded list, call
   `getChat` once per parent id and cache the result. 404 means deleted, and
   `status: archived` means archived.
4. Rendering:
   - Nested rows get the variant-D wrapper and the leading glyph, with the
     spec's test ids.
   - The fallback glyph goes in the meta-line's trailing cluster, with the
     spec's Hint copy table. A click activates the parent and stops propagation
     so the fork's row is not activated. Archived and deleted parents are not
     interactive.
   - Two hover-card lines.
   - The chat header shows "Forked from <title>" with the same rules.
   - Sidebar context (the all-items map, the filtered set, group membership)
     flows through a small React context from `SessionSidebar`, not per-row
     prop drilling.

TDD (red first):
- `chatToThreadCustom` maps `parentChatId`, `directoryMissing` and `isRunning`
  (absent → `false`).
- `fork-lineage` unit tests (AC 13): each sort mode, contiguity, the two-level
  cap, the other-group fork staying unnested, self-reference and cycles,
  counts.
- Component tests: nested row DOM order and test ids; fallback Hint text for
  all four parent states and click behavior (AC 14); hover-card lines, `2x`
  and absence (AC 15); header link present, clickable, deleted and absent
  (AC 16).

Exit:
- Those tests pass, run file by file.
- The UI typecheck passes.

## Group 5 — ui-fork-action (ui)

Files (under `packages/ui/src/`):
- `lib/api/chats.ts` (`forkChat`);
- `features/sessions/view-model/fork-availability.ts` (new);
- `features/sessions/use-fork-chat.ts` (new);
- `features/sessions/{SessionContextMenu.tsx,SessionRow.tsx}`;
- `features/session-tabs/{SessionTabContextMenu.tsx,SessionTabPill.tsx}` and,
  if the tab needs chat data, `SessionTabs.tsx`;
- tests;
- `.changeset/<name>.md` (minor bump for `@qlan-ro/mainframe-ui`).

1. `forkAvailability({ capabilityFork, adapterName, claudeSessionId, transcriptMissing, directoryMissing, isRunning, hasPending })`
   returns enabled, or the first failing reason, with the spec's exact copy
   and order. A missing capability counts as unable to fork. The turn-in-flight
   check is `isRunning || hasPending`, never `displayStatus`, because live
   background tasks alone make `displayStatus` "working".
2. `useForkChat()`:
   - Call `forkChat`. On `ok`, make sure the thread list holds the new chat
     (reload if needed), then `switchToThread(newId)`.
   - On `fail`, `mfToast.error(<daemon message>)`.
3. Menu items with the spec's test ids and placement. Disabled items wrap in a
   `Hint` with the reason. The tab menu resolves the tab's chat from the thread
   list state.

TDD (red first):
- `fork-availability` unit tests: every reason, in order, including an adapter
  payload with no capability, and enabled for an idle chat whose
  `displayStatus` is "working" only because of background tasks
  (`isRunning: false`, `hasPending: false`).
- Menu tests (AC 17): placement relative to the neighbor ids; disabled with the
  exact Hint for no capability, no session, running and waiting; enabled for
  an idle chat with background tasks; enabled
  activation calls the API and switches to the returned chat; a failure shows
  the toast.

Exit:
- Tests pass file by file.
- The UI typecheck passes.
- A live run in the dev app with the real Claude CLI: Fork from the row and the
  tab opens the fork as active, nests it under the parent, and shows the
  header link. A Codex chat shows the disabled item with its reason.
- The changeset is committed.

## Risks

- **Shared worktree.** A fork inherits the parent's worktree path. Archiving
  either one with "delete worktree" removes the directory the other still
  uses. That behavior already exists for chats that share a worktree, so it is
  out of scope; flag it to the reviewer.
- **Transcript-presence sweep.** It may briefly flag a fork's transcript as
  missing between `on_init` and the first transcript write. It self-heals, and
  resolution falls back to the fork source.
- **Subagent children.** Tool calls inherited from before the fork lose their
  inlined subagent children after the fork's first turn. The CLI writes the
  fork's subagents only under the fork's own id. This is cosmetic, and the
  pre-first-message view keeps them from the snapshot copy.
- **Thread list timing.** A switch to the new chat can race the
  `chat.created` reload. `useForkChat` has to wait for the item, not assume it
  is already there.
