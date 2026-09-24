# Plan: temporary and non-project sessions (#346)

Spec: `docs/specs/2026-09-24-todo-346-temporary-non-project-sessions.md`. Spec AC numbers are cited
as "AC n". This is the full-form plan. The change spans a migration, adapters, the chat lifecycle,
routes and three UI areas, well beyond the short-form threshold.

## Goal

Two flags are fixed when a chat is created. **Temporary** chats are left out of default listings,
refuse pin, tag, archive and unarchive, and are removed only by an explicit discard or by removing
their project. When the adapter reports the capability, a temporary chat's CLI also runs with vendor
persistence off. **Non-project** chats use a per-chat scratch directory under the data dir, and the
daemon represents them with a hidden scratch project row. The UI gets:
- a "No project" choice on the welcome picker and the first-run hero;
- a trailing "No project" sidebar section;
- a dismissible "earlier context was not preserved" notice;
- disabled git, worktree, branch, launch and diff surfaces for non-project chats.

## Prerequisite spike (AC 1): done while planning, both mechanisms pass

The spike ran on 2026-09-24 against Claude Code 2.1.280 and codex-cli 0.155.1, using Mainframe's
exact interactive argv and params. The receipts are in `## Established facts`. Both adapters report
`noPersistence: true`. The rows in the consumed-surface docs are written by group G1, together with
the code sites they cite.

## Data model (decided here; the spec left the names to the planner)

Migration **28** is additive. It uses `add_column_if_missing` on `chats` and bumps `LATEST_VERSION`
to 28:

| Column | Type | Meaning |
|---|---|---|
| `temporary` | `INTEGER NOT NULL DEFAULT 0` | The temporary flag, fixed at creation |
| `vendor_session_ephemeral` | `INTEGER NOT NULL DEFAULT 0` | The stored provider session was started with no persistence. It is never a resume target |
| `context_lost_at` | `TEXT` | ISO time of the chat's latest vendor-context loss, which drives the notice |
| `scratch_path` | `TEXT` | Non-project cwd `<data_dir>/scratch/<chatId>`, stored at create so every cwd consumer can read it off the `Chat` |

The same migration runs `INSERT OR IGNORE` for the scratch project row. Its id is `NO_PROJECT_ID =
"mainframe-no-project"`, a new const in `mainframe_types::chat`. Its name is `No project`, and its
path is the non-filesystem sentinel `mainframe:no-project`. `project_id` stays NOT NULL (AC 25).

Wire shape: Rust `Chat` and TS `Chat` both gain the following camelCase fields.
- `temporary: bool`: always serialized, `serde(default)`.
- `noProject: bool`: derived in row mapping as `project_id == NO_PROJECT_ID`, always serialized.
- `contextLostAt?: string | null`.

Two fields stay internal (`#[serde(skip)]`) and are not added to TS: `vendor_session_ephemeral` and
`scratch_path`. Rust `AdapterCapabilities` and its TS twin gain `noPersistence: bool`, with
`serde(default)`. `SessionSpawnOptions` gains `no_persistence: Option<bool>`.

## Core behavior rules (implementers follow these exactly)

1. **Hidden row.** `ProjectsRepository::{list, get, get_by_path}` exclude `NO_PROJECT_ID`. The
   exclusion has these effects:
   - `GET /api/projects` never lists the row, and `GET /api/projects/{id}` returns 404 for it.
   - `effective_path` and `projects_get_path` return `None` for it. Git, file and launch routes
     therefore 404 instead of running against the sentinel path.
   - `enrich_chat` never flags `directoryMissing`, because it receives `project_path = None`.
   - `fork_to_worktree` and `enable_worktree` fail with "Project not found".

   `ProjectsRepository::remove`, `ChatManager::remove_project` and `DELETE /api/projects/{id}` each
   refuse `NO_PROJECT_ID`. Without that refusal, removal would hard-delete every non-project chat.
2. **Create validation** (`POST /api/chats`, AC 5). The body adds `noProject?: bool` and
   `temporary?: bool`. It must carry exactly one of a non-empty `projectId` or `noProject: true`, and
   `adapterId` stays required. These cases return `fail` and write no row:
   - `noProject` together with `worktreePath` or `branchName`;
   - a `projectId` that `projects.get` does not find, which covers unknown ids and the scratch id.

   The route checks the project exists before calling the manager. A non-project create stores
   `project_id = NO_PROJECT_ID` and `scratch_path = <ctx.data_dir>/scratch/<id>`. The repository
   builds the path after it mints the id, so it receives the scratch root, not the full path.
   Nothing is created on disk at this point (AC 16).
3. **Listing** (AC 7). `ChatListFilters.include_temporary` defaults to false and is applied in
   `list_filtered`, like the automation filter. `GET /api/chats` and `GET /api/projects/{id}/chats`
   accept `includeTemporary=true`. The per-project route filters its result. It does not filter
   `ChatsRepository::list`, which `remove_project` uses internally and which must keep returning
   temporary chats (AC 10). `GET /api/chats/{id}` is unchanged.
4. **Refusals** (AC 9, 18). Pin, `PUT /api/chats/{id}/tags`, archive and unarchive return `fail`
   (409) for a temporary chat, and the chat is unchanged. `PATCH /api/chats/{id}/config` returns
   `fail` (400) when the body contains `projectId`. Detect it with an explicit field. Do not use
   `deny_unknown_fields`, because other clients may send extra keys today.
5. **Discard** (AC 8). The route is `POST /api/chats/{id}/discard`. It returns 404 for an unknown
   chat and `fail` for a non-temporary one. For a temporary chat, `ChatManager::discard_chat` runs
   these steps in order:
   1. The per-chat teardown that `remove_project` runs today, extracted into one shared helper:
      kill tasks, kill the session, drop the active entry, drop the message cache, forget
      permissions (which drops a pending gate), remove it from the tracker, clear display state, and
      notify `ChatEnded`.
   2. Attachment delete.
   3. `remove_dir_all(scratch_path)`, where NotFound counts as success. Any other error returns
      `Err` before the row is deleted, so a retry is still possible.
   4. `ChatsRepository::delete(id)`. `chat_tags` cascade because `foreign_keys = ON`.
   5. Emit `ChatEnded`.
6. **Cwd.** A pure resolver, `chat_cwd(chat, project_path) = worktree_path ?? scratch_path ??
   project_path`, is the only way any consumer derives a chat's working directory. Consumers:
   - lifecycle `do_load_chat` and `do_start_chat`;
   - `SessionSinkImpl::on_init`, for the session-file path;
   - `reconcile_transcript_presence`;
   - `archive_chat`, for the launch-scope path. A non-project chat has no launch scope, so skip it.

   `do_start_chat` runs `create_dir_all(scratch_path)` asynchronously before spawning, every time.
   That is the first time the directory is created, and it recreates a deleted one at the same path.
   A non-project chat skips the "project directory does not exist" check.
7. **No persistence** (AC 11, 12, 13). This is decided per spawn in `do_start_chat`:
   `no_persistence = chat.temporary && deps.adapter_supports_no_persistence(adapter_id)`. The new
   dep reads the registry's `capabilities().no_persistence`, never an adapter id (AC 2).
   - **Context loss.** Before resolving the resume target, if `chat.vendor_session_ephemeral` and a
     `claude_session_id` is stored while no live process holds it, call `mark_context_lost`. It sets
     `context_lost_at = now`, clears `claude_session_id`, `session_file_path` and
     `vendor_session_ephemeral`, syncs the active chat and emits `ChatUpdated`. The spawn then has no
     resume target.
   - **Load path.** `do_load_chat` applies the same rule before it creates a session with a resume
     id. After a restart this marks the loss when the chat is opened, so the notice shows before the
     next send. It also never calls `load_history` against a session that was never written.
   - **Flag write.** Each spawn writes `vendor_session_ephemeral = no_persistence` to the DB and the
     in-memory chat before it spawns. `on_init` then stores the new provider id as it does today, so
     the stored id changes (AC 11).
   - **Respawn paths.** The config respawn (`respawn_with_config` → `start_chat`), the
     degraded-recovery rebinds (kill → next `start_chat`) and the next send after a CLI exit all
     reach `do_start_chat`, so the single rule covers them. None of those paths needs its own branch.
   - **No capability.** With the capability off, `no_persistence` is false, the flag stays false,
     and resume behaves exactly as today.
   - **Reconciliation.** `reconcile_transcript_presence` returns early without flagging when
     `chat.vendor_session_ephemeral` is set. This covers both history load and the sweep.
8. **Adapters.**
   - Claude: `build_args` pushes `--no-session-persistence` and never pushes `--resume` when
     `options.no_persistence == Some(true)`.
   - Codex: a no-persistence thread always uses `thread/start` with `ephemeral: true`, even if a
     resume id was supplied, and never calls `thread/resume`. It keeps `persistExtendedHistory` and
     `persistFullHistory` (the spike found no conflict).
   - Extract the `thread/start` params into a pure builder so that AC 3 can unit-test it.

## Groups

File lists are ownership. A group that needs a file owned by another group must wait for that group
and edit on top of its work. Tests are written red-first inside each group.

### G1 `adapter-no-persistence` (core)

The capability flag and the two vendor mechanisms (AC 2, 3; AC 1 doc rows).

- `packages/core-rs/crates/mainframe-types/src/adapter.rs`: `AdapterCapabilities.no_persistence`,
  `SessionSpawnOptions.no_persistence`, and a serde round-trip test.
- `packages/types/src/adapter.ts`: `AdapterCapabilities.noPersistence`.
- `mainframe-adapter-claude/src/session.rs::build_args` plus its tests, and
  `mainframe-adapter-claude/src/adapter.rs::capabilities` returns true.
- `mainframe-adapter-codex/src/session.rs` (`thread_params_base`, `ensure_thread`, and the session
  config that carries the spawn flag) plus a pure `thread/start` params builder and tests.
  `mainframe-adapter-codex/src/adapter.rs::capabilities` returns true.
- `mainframe-adapter-mock/src/adapter.rs`: a `no_persistence` field with a builder, so tests can set
  either value. It defaults to false.
- Every other `AdapterCapabilities { .. }` literal gets the new field. The compiler finds them. They
  include `mainframe-server/tests/{support/barrier_adapter.rs, transcript_presence_support/mod.rs,
  chat_default_model_catalog.rs}`, `mainframe-server/src/{chat_deps.rs, routes/session_transcripts.rs}`
  test modules, `mainframe-chat/src/context_tracker.rs` and `mainframe-adapter-api/tests/registry.rs`.
- `docs/research/adapters/claude/CONSUMED-SURFACE.md`: a new row for interactive
  `--no-session-persistence`. Update CLAUDE-FLAG-02 so it no longer calls the flag undocumented
  (the CLI documents it, restricted to `--print`, but it works on the no-`--print` stream-json
  spawn). `docs/research/adapters/codex/CONSUMED-SURFACE.md`: a new row for
  `thread/start ephemeral`, and update CODEX-RPC-02, whose persist params are absent from the
  0.155.1 generated `ThreadStartParams`. Both rows carry the spike findings below.

Verify:
- Claude and Codex builder tests show three things: the mechanism is present for no-persistence, it
  is absent for a normal spawn, and a no-persistence spawn has no `--resume` or `thread/resume` even
  when a resume id is supplied.
- `GET /api/adapters` includes `noPersistence` for every adapter (an adapters route test).
- A grep finds no chat-layer or UI code that branches on an adapter id to decide persistence.

### G2a `chat-model-and-routes` (core)

The migration, the flags, the hidden project, the create, list, refuse and discard routes, and the
TS `Chat` (AC 5–10, 17, 18, 25; the route-test parts of AC 26). It also owns the changeset.

- `mainframe-types/src/chat.rs`: `NO_PROJECT_ID`, plus the four `Chat` fields above. Update every
  `Chat { .. }` literal, which the compiler finds, including `mainframe-chat/src/test_support.rs`.
- `mainframe-db/src/migrations.rs` (migration 28) and `tests/migrations.rs`. Test that a pre-28 row
  reads `temporary = false` with its project unchanged, and that the scratch row exists.
- `mainframe-db/src/chats.rs`: select fields and row mapping (including derived `no_project`), a
  `create` that takes a `NewChat` struct (temporary, scratch root), `delete`,
  `ChatListFilters.include_temporary`, and `ChatUpdate` fields for `vendor_session_ephemeral`,
  `context_lost_at`, and clearing `claude_session_id` and `session_file_path`. Plus
  `tests/chats.rs`.
- `mainframe-db/src/projects.rs`: exclusions and the refusal to remove the row, plus
  `tests/projects.rs`.
- `mainframe-chat`: extend `lifecycle_manager.rs::{create_chat, create_chat_with_defaults}`,
  `LifecycleManagerDeps::chats_create`, `chat_manager/lifecycle_api.rs` and callers (fork,
  automations `chat_port.rs`, plugins `chat_service.rs`/`context.rs`, external sessions) with the
  new-chat struct. Existing callers pass temporary=false and a project. Also:
  - `chat_manager/config_api.rs::remove_project` refuses the scratch id and uses the extracted
    teardown helper;
  - a new `chat_manager/discard.rs` holds `discard_chat` and the teardown helper;
  - `ChatManagerDeps` gains `chats_delete` and an async scratch-dir remover.
- `mainframe-server`:
  - move chat create out of `routes/chat_commands.rs` into a new `routes/chat_create.rs` with the
    rule-2 validator;
  - add a new `routes/chat_discard.rs` for discard and the temporary-refusal helper;
  - `routes/chats.rs` gets the list query param, the per-project filter and the
    pin/archive/unarchive guards;
  - `routes/tags.rs` gets the tag guard;
  - `routes/projects.rs` gets the get/delete refusal;
  - `routes/chat_commands.rs` gets the config `projectId` refusal;
  - `routes/mod.rs` mounts the new modules;
  - `chat_deps.rs` gets the impls for the new deps, passing `ctx.data_dir` for the scratch root.
- `packages/types/src/chat.ts`: `temporary`, `noProject` and `contextLostAt`.
- `.changeset/<name>.md`: minor for the daemon and UI packages.

Verify: the Rust route tests cover create with and without a project, create temporary, each AC 5
rejection writing no row, both list endpoints with and without `includeTemporary`, discard of a
temporary and a non-temporary chat, the pin/tag/archive/unarchive refusals, project removal deleting
temporary chats, scratch-project listing, get and delete, and the config `projectId` refusal. A
discard whose directory removal fails leaves the chat discardable. The mainframe-db tests pass. The
types package typechecks.

### G2b `chat-lifecycle-scratch-and-ephemeral` (core), depends on G1 and G2a

The scratch cwd, the no-persistence spawn decision, context loss and reconciliation (AC 11–13, 15,
16; the restart and respawn parts of AC 26; AC 4).

- A new `mainframe-chat/src/chat_cwd.rs` for the rule-6 resolver, and a new
  `mainframe-chat/src/no_persistence.rs` for the rule-7 decision and `mark_context_lost`. Both have
  unit tests. They are new modules, so `lifecycle_manager.rs` only calls them.
- `lifecycle_manager.rs`:
  - `do_load_chat` and `do_start_chat` hooks, the scratch mkdir, and `archive_chat` scope skipping;
  - `LifecycleManagerDeps` gains `adapter_supports_no_persistence` and an async `ensure_dir`;
  - the test doubles are updated.
- `event_handler.rs::SessionSinkImpl::on_init` uses the resolver.
- `transcript_presence.rs` gets the early return and the resolver, plus tests.
- `chat_manager/deps_lifecycle.rs` and `mainframe-server/src/chat_deps.rs` get the dep impls, reading
  `AdapterRegistry` capabilities.
- Integration tests in `mainframe-server/tests/`, a new `temporary_chat_lifecycle.rs` built on the
  facade or transcript-presence harness with the mock adapter's capability both on and off. They
  cover:
  - restart survival, meaning a new manager over the same DB;
  - after restart, fresh spawn with no resume, a changed provider id, no degraded flag, and
    `contextLostAt` set;
  - a config respawn, a degraded-recovery rebind and the send after a CLI exit, each fresh with the
    capability on and resumed with it off;
  - reconciliation skipping;
  - the non-project spawn cwd under `data_dir/scratch/<chatId>` staying stable across a restart and
    recreated when deleted;
  - no directory existing before the first send.

Verify: the integration tests above pass. Also, a recorded live-QA check (AC 4) on a dev daemon:
create a temporary chat through the API on Claude and on Codex, run two turns including an
interrupt, then confirm there is no `~/.claude/projects/**/<sessionId>.jsonl`, no Codex rollout and
no `threads` row for the thread id. Put the result in the PR.

### G3a `ui-new-session-no-project` (ui), depends on G2a

The draft's project-or-none choice, the picker, first run, and the draft worktree controls (AC 16,
19, 20, 21; the draft parts of AC 23; the picker, switching and first-run parts of AC 27).

- `packages/ui/src/features/sessions/runtime/draft-config.ts`: `DraftCfg.projectId: string | null`,
  where null means No project. Update every consumer for null: `initialize-draft.ts`,
  `resolve-draft-defaults.ts`, `use-select-draft-project.ts`, `use-new-thread-auto-config.ts`,
  `use-start-new-session.ts`, `view-model/draft-identity.ts`, `sidebar/use-draft-row.ts`,
  `use-active-draft-config.ts`, `chat/composer/config-toolbar/{synthesize-draft-chat.ts,
  use-composer-tuning.ts}`, `chat/composer/triggers/{resolve-draft-chat-context.ts,
  ComposerTriggers.tsx}`, `features/skills/use-chat-skills.tsx` and
  `chat/thread/ChatCardHeader.tsx`.
- `runtime/new-thread-coordinator.ts` and `lib/api/chats.ts` (the `createChat` body): send
  `noProject: true` in place of `projectId`, and never send worktree fields for it.
- `new-thread/WelcomeState.tsx`: extract the picker into a new `new-thread/WelcomeProjectPicker.tsx`
  with these parts:
  - a single `welcome-project` trigger showing the dot and name, "No project", or "Choose a
    project";
  - the "Start in…" list, with "Resolved default" on the resolved project;
  - a trailing `welcome-project-picker-no-project` below a separator.

  Choosing "No project" hides the branch chip and repo suggestions and clears the project pill.
- A new `features/sessions/NoProjectLabel.tsx`: the `SquareDashedBottom` glyph and a muted italic
  "No project". G3b reuses it.
- `new-thread/FirstRunState.tsx`: the `sessions-firstrun-no-project` outline button.
  `new-thread/ChatSurface.tsx`: do not show the hero when the draft is set to no project.
- `chat/composer/config-toolbar/{WorktreePopover.tsx, WorktreeDraftPanel.tsx}`: disabled with an
  explanation for a no-project draft or a `noProject` chat, and no worktree request.

Verify: component tests cover:
- the trigger label and the picker entries, including the no-project entry;
- switching from no project to a project and back before the first send, with the create body using
  the last choice;
- the create body carrying `noProject: true`;
- the first-run button leading to the welcome screen with a live composer;
- the pill clearing;
- the disabled worktree controls sending no request.

The UI typechecks.

### G3b `ui-session-lists` (ui), depends on G2a and G3a

The sidebar, the archived dialog and the palette (AC 22 and 24; the list parts of AC 7; the
group-header, row and glyph parts of AC 27).

- `features/sessions/view-model/chat-to-thread-custom.ts`: `noProject` and `temporary` in
  `SessionCustom`.
- `view-model/group-sessions.ts`: a trailing "No project" section in recency mode and in project
  mode. It comes after the ghost sections, and a pinned chat stays in Pinned. A non-project chat
  must never land in a ghost section.
- `SessionRowMetaLine.tsx`: `sessions-row-no-project` uses `NoProjectLabel`, never a name or
  `ProjectAvatar`. `sessions-row-temporary-glyph` is a `Timer` with the `Hint` "Temporary — deleted
  when closed".
- `SessionRow.tsx` and `SessionMetaCard.tsx`: pass the fields through.
- `ArchivedSessionsDialog.tsx` and `view-model/archived-sessions.ts`: "No project".
- `features/palette/{SpotlightPalette.tsx, SpotlightRow.tsx}`: "No project".
- Confirm that a project pill hides non-project chats. It should need no code, because their
  `projectId` never matches a pill; add a test.

Verify: the grouping unit tests cover both modes and the pinned case. Row component tests cover the
no-project slot and the temporary glyph. The archived-dialog and palette tests show "No project".

### G3c `ui-context-notice-and-project-surfaces` (ui), depends on G2a and G3a

The notice, and the chat-scoped git, branch, launch and diff surfaces for non-project chats (AC 14;
the chat parts of AC 23; the notice part of AC 27).

- A new `features/chat/thread/ContextNotPreservedNotice.tsx`:
  - a default-variant `Alert` with the `History` icon, testid `chat-context-not-preserved-<chatId>`;
  - a dismiss control, `chat-context-not-preserved-dismiss-<chatId>`, and no action button.
- A new `features/chat/thread/context-notice-dismissals.ts`: localStorage keyed by chat id, storing
  the dismissed `contextLostAt`. The notice shows when `contextLostAt` is set and differs from the
  stored value.
- `chat/thread/ChatThread.tsx`: mount the notice at the top of the thread viewport, not the sticky
  footer. `chat/controller/chat-environment-state.ts`: `contextLostAt` and `noProject` take part in
  the equality check, so updates reach `chatConfig`.
- The disabled explanatory state, with no git, launch or diff request, when the active chat is
  `noProject`:
  - `features/session-panel/{SessionPanel.tsx, LaunchCard.tsx, launch-view.ts}`;
  - `features/review/use-working-changes.ts`;
  - `features/sessions/{use-display-branch.ts, use-active-identity.ts}`.

  Sweep the other chat-scoped git and launch callers in the same pass.

Verify: component tests show the notice renders, is dismissed, stays hidden across a remount (a
reload), and reappears when `contextLostAt` changes. Surface tests show the disabled state and that
the mocked API sees no git, launch or diff request.

## Exit gates (per group, not separate groups)

Each group finishes with these checks:
- the tests it names are green;
- a Rust group passes `cargo check`, `cargo clippy -D warnings` and its crate tests;
- a UI group passes the UI typecheck and its test files, run one file at a time;
- no new file over 300 lines and no new function over 50.

G2a adds the changeset. G2b records the AC 4 live-QA result for the PR.

## Established facts

- Claude 2.1.280: `--no-session-persistence` works on Mainframe's stream-json spawn without
  `--print`. It was tested with streaming, four turns, a `can_use_tool` gate answered allow, and an
  `interrupt` control request. The session id stays stable across turns, and no
  `~/.claude/projects/**/<sid>.jsonl` is written. Receipt: the live spike on 2026-09-24, argv =
  `mainframe-adapter-claude/src/session.rs::build_args` plus the flag. The control run without the
  flag wrote `-private-tmp-spike346-c-control/<sid>.jsonl`.
- Claude: the project dir `~/.claude/projects/<cwd-key>/` is still created, with an empty `memory/`
  subdir, even with no persistence. It contains no transcript file. Receipt: the same spike.
- Claude: `--resume <unpersisted-id>` exits rc=1 with the result `error_during_execution`
  "No conversation found with session ID: <id>". Receipt: the same spike's resume attempt.
- Claude `--help` documents `--no-session-persistence` as "(only works with --print)". In practice
  it takes effect without `--print`. Receipt: `claude --help` on 2.1.280.
- Codex 0.155.1: `thread/start` with `ephemeral: true` plus `persistExtendedHistory`,
  `persistFullHistory` and `experimentalRawEvents` (Mainframe's params) returns `thread.ephemeral ==
  true` and `thread.path == null`. It was tested with four turns (context retained across turns),
  one `item/commandExecution/requestApproval` answered accept, and `turn/interrupt` (the turn
  completes with `interrupted`). No rollout file and no `threads` row in `~/.codex/state_5.sqlite`
  exist for the thread id. The control run wrote both. Receipt: the live spike on 2026-09-24.
- Codex: `thread/resume` of an ephemeral thread id in a fresh app-server returns JSON-RPC error
  -32600 "no rollout found for thread id <id>". Receipt: the same spike.
- Codex 0.155.1 generated `ThreadStartParams` has `ephemeral?: boolean | null`. It no longer lists
  `persistExtendedHistory` or `persistFullHistory`, which Mainframe still sends and which the server
  accepts. `Thread.ephemeral` is documented as "should not be materialized on disk". Receipt: `codex
  app-server generate-ts --experimental`, `v2/ThreadStartParams.ts` and `v2/Thread.ts`.
- `thread_params_base` is shared by `thread/start` and `thread/resume`, and the resume branch is
  chosen in `ensure_thread` from `resume_thread_id`. Receipt:
  `mainframe-adapter-codex/src/session.rs::{thread_params_base, ensure_thread}`.
- The resume target reaches adapters as `SessionOptions.chat_id`, set from `chat.claude_session_id`
  in both `do_load_chat` and `do_start_chat`. `do_load_chat` creates the session with the resume id
  and calls `load_history`. Receipt: `mainframe-chat/src/lifecycle_manager.rs::{do_load_chat,
  do_start_chat}`.
- An adapter change is refused once `claude_session_id` is set, and `respawn_with_config` ends in
  `deps.start_chat`. Receipt: `mainframe-chat/src/config_manager.rs::{update_chat_config,
  respawn_with_config}`.
- `on_init` stores the provider id and derives `session_file_path` from `worktree_path.or(project
  path)`. Receipt: `mainframe-chat/src/event_handler.rs::SessionSinkImpl::on_init`.
- Reconciliation reads `claude_session_id` and the cwd from `projects_get_path`. It is called from
  history load and the sweep. Receipt: `mainframe-chat/src/transcript_presence.rs::
  reconcile_transcript_presence` and `chat_manager/history.rs`.
- `enrich_chat` flags `directory_missing` only from a `Some(project_path)` or a worktree. Receipt:
  `mainframe-chat/src/chat_manager/shared.rs::enrich_chat`.
- Project removal iterates `deps.chats_list(project_id)` (unfiltered `ChatsRepository::list`) and
  runs the per-chat live-state teardown, then `projects_remove`. Receipt:
  `mainframe-chat/src/chat_manager/config_api.rs::remove_project` and
  `mainframe-db/src/projects.rs::remove`.
- Today's create route rejects a missing `projectId` or `adapterId` and then calls
  `create_chat_with_defaults`. The deps `chats_create` logs an insert failure and returns an
  unpersisted stub. Receipt: `mainframe-server/src/routes/chat_commands.rs::create` and
  `mainframe-server/src/chat_deps.rs::chats_create`.
- `list_filtered` already hard-filters `automation_run_id IS NULL`. The per-project route uses
  `list_chats` → `ChatsRepository::list` with no filter. Receipt: `mainframe-db/src/chats.rs::
  list_filtered` and `mainframe-server/src/routes/chats.rs::{list, list_for_project}`.
- SQLite runs with `PRAGMA foreign_keys = ON`, and `chat_tags.chat_id` is `ON DELETE CASCADE`.
  Receipt: `mainframe-db/src/lib.rs` (open) and `migrations.rs::BASE_SCHEMA_SQL`.
- Migrations are an append-only `migrations()` vec, and `LATEST_VERSION = 27` today. Receipt:
  `mainframe-db/src/migrations.rs`.
- `AppCtx.data_dir` is the daemon data dir. Receipt: `mainframe-server/src/ctx.rs::AppCtx` and
  `mainframe-daemon/src/main.rs`.
- The UI sidebar, archived dialog and palette all read the one thread list loaded by
  `listChats(port)` (GET `/api/chats`, no params). Every `chat.created`, `chat.updated` or
  `chat.ended` triggers `threads.reload()`, so the default REST exclusion hides temporary chats
  everywhere. Receipt: `ui/src/features/sessions/runtime/chats-remote-adapter.ts`,
  `ws/use-session-list-router.ts` and `features/palette/SpotlightPalette.tsx`.
- `ChatThread` hides the composer only for a `__LOCALID_*` draft with no draft config, so a
  no-project draft with a config keeps a live composer. Receipt:
  `ui/src/features/chat/thread/ChatThread.tsx` (`projectlessDraft`).
- `ChatSurface` shows the first-run hero when `projects.length === 0` for a new local thread.
  Receipt: `ui/src/features/sessions/new-thread/ChatSurface.tsx`.
- `DegradedChatCard` reads flags from `useChatExtras().state.chatConfig`, and
  `chat-environment-state.ts` compares chat fields to decide updates. Receipt:
  `ui/src/features/chat/thread/DegradedChatCard.tsx` and
  `ui/src/features/chat/controller/chat-environment-state.ts`.
- `SessionGroupHeader` renders `data-testid="sessions-group-header-<label>"`, and `group-sessions.ts`
  appends ghost sections for unknown project ids. Receipt:
  `ui/src/features/sessions/SessionGroupHeader.tsx` and `view-model/group-sessions.ts::ghostSections`.
- lucide-react 1.25.0 exports `Timer` and `SquareDashedBottom`. Receipt:
  `node_modules/lucide-react/dist/lucide-react.d.ts`.

## Risks

- **#365 not landed.** The brief sequences this after #359, which has landed, and #365, which has
  not landed on `origin/main` at `962e505b`. G3a edits the draft-open and new-session files that
  #365 reworks, so expect a rebase conflict there. #366's discard race is not widened, because the
  no-project path reuses the same create and abandon flow.
- **Oversized existing files.** `lifecycle_manager.rs` (1630 lines), `chat_deps.rs` (2062),
  `routes/chats.rs` (783) and `config_manager.rs` (1100) already exceed 300 lines. AC 28 is applied
  as: no new file over 300, and new logic goes into new modules. The existing files only gain call
  sites.
- **Files panel.** The file browser for a non-project chat resolves `effective_path` to `None`, so it
  shows empty or unavailable. The spec does not list files as a surface.
- **Spike litter.** The Codex control run left one `threads` row, `01a0d3b6-83f8-...`, in the
  planner's local `~/.codex/state_5.sqlite`. Its rollout file was deleted.

## Decisions

- Four additive columns (`temporary`, `vendor_session_ephemeral`, `context_lost_at`,
  `scratch_path`) instead of only `temporary`. The spec requires resume to be skipped only for a
  session started with no persistence, and it requires a loss marker that persists. Storing the
  scratch path avoids threading `data_dir` into every cwd consumer.
- The scratch-dir consequence of storing the path: a later change to `MAINFRAME_DATA_DIR` keeps old
  chats at their original path. That is the stability the spec asks for.
- The hidden row is excluded inside `ProjectsRepository::{list, get, get_by_path}`. Each internal
  project lookup then safely returns `None` for it, which avoids many call-site checks. Removal is
  refused explicitly at three layers.
- The context loss is detected in `do_load_chat` and `do_start_chat` from the persisted
  `vendor_session_ephemeral` and stored session id. That single rule covers restart, CLI exit, the
  config respawn and the recovery rebinds. No respawn path gets its own branch.
- The temporary refusals live at the route level. The spec's contract is the REST `fail` envelope,
  and the UI has no temporary-chat actions in v1.
- The `PATCH /config` `projectId` refusal uses an explicit field, not `deny_unknown_fields`.
- The consumed-surface doc rows land in G1 with the code sites they cite. The spike receipts are
  recorded in this plan now.
- No separate test group. Each group writes its failing tests first against code it owns.
