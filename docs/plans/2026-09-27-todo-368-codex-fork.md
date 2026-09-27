# Todo #368: Codex fork through app-server `thread/fork`

Route: no-spec. Source: the approved brief for todo #368. This builds on #343's fork contract (`af468078`, "Add support for fork thread").

## Goal

Codex chats fork through the same Fork menu item, REST route and `parentChatId` lineage that #343 built for Claude:

- The Codex adapter implements `Adapter::pin_fork_point`.
- A fork's first message calls app-server `thread/fork` with the parent's thread id, and the new thread id becomes the fork's stored provider session id.
- `capabilities().fork` is true only on a Codex CLI that has the needed RPC surface.
- On an older CLI, fork stays disabled, and both the UI and the REST 422 give a version-specific reason.

Out of scope, as in the brief: rewind-and-fork from an earlier message, a from-scratch context-replay fallback, forking temporary chats (`ephemeral`), and any change to #343's route, UI or lineage beyond what is described here.

## Design (how #343's lazy contract maps onto Codex)

#343 is lazy. When the user clicks Fork, `fork_chat` calls `pin_fork_point` and stores the returned `ForkSource` in `chats.pending_fork`. The fork chat has no provider session id yet. Its first spawn receives `SessionOptions.fork_source`, and `on_result` retires the pending state after the first turn. Codex fits this model as follows.

1. **Pin (at click time).** `CodexAdapter::pin_fork_point`:
   - Spawns a temporary app-server (`spawn_temp_app_server`, the same helper `load_history` uses, with `cwd = request.cwd`).
   - Calls `thread/read { threadId: source, includeTurns: true }`.
   - Returns `ForkSource { source_session_id, resume_path: None, last_turn_id: <id of the last turn> }`.
   - Maps errors: a "no rollout found" error becomes `ForkPinError::TranscriptMissing`, and any other error becomes `Failed`.
   - Writes nothing to `dest_dir`. Retirement and the startup sweep already tolerate a missing directory.
   - Pinning the last turn id keeps the fork point fixed at the click, like Claude's snapshot copy. Turns the parent adds before the fork's first message are not inherited.
2. **First spawn.** A pure resolver in a new module decides which thread request `ensure_thread` sends. It mirrors `mainframe-adapter-claude::fork::resolve_resume`:
   - The chat's own id with no fork source: `thread/resume`.
   - The chat's own id with a fork source, and the own transcript present: `thread/resume`.
   - A fork source, and no own id or its transcript missing: `thread/fork`.
   - Otherwise: `thread/start`.
   - A no-persistence spawn always gets `thread/start` with ephemeral set, as today.
   - Only check own-transcript presence when both the own id and the fork source are set, so regular chats never pay for the probe (the same reason Claude's `resume_target` gives).
3. **Fork params.** Send `{ threadId, lastTurnId?, persistExtendedHistory: true, persistFullHistory: true }`.
   - Omit every override field (`cwd`, `model`, `sandbox`, `approvalPolicy` and the rest) so the fork inherits them. `turn/start` re-supplies policy and model on every turn anyway (CONSUMED-SURFACE CODEX-RPC-03).
   - Send no `ephemeral` and no `excludeTurns`.
   - Read the response like `ThreadStartResult` (`thread.id`, `model`), plus an optional `thread.forkedFromId`. Log a warning if `forkedFromId` does not match the source id.
   - `sink.on_init(new_id)` then stores the new thread id exactly as `thread/start` does.
4. **History of an unsent fork.** If the resolver picks the fork path, `load_history` reads the **source** thread and keeps turns up to and including `last_turn_id`. This needs a new optional turn cap on `load_history_inner`. If the id is not found, keep all turns and log a warning. After the first turn, the fork's own `thread/read` returns the inherited history plus its own turns. Gate 0 checks that nothing is duplicated.
5. **Version gate.**
   - The CLI version is only known after the registry's refresh, and `capabilities()` is synchronous. So the Codex adapter caches the version the registry reports through a new trait hook. `capabilities().fork` is then `version >= FORK_MIN_CODEX_VERSION`, and an unknown version means false.
   - `FORK_MIN_CODEX_VERSION` is **0.143.0**, the first release with `ThreadForkParams.last_turn_id` (see Established facts). If Gate 0 shows that turn ids from `thread/read` are not accepted by `thread/fork` in another process, drop `lastTurnId` (the brief allows this), set the floor to 0.119.0 (`forkedFromId`), and record the drift limitation in CONSUMED-SURFACE.
6. **Getting the capability to the UI.** Today `AdapterRegistry::apply_refresh` copies `prev.capabilities` and never recomputes them. The UI takes capabilities only from the `getAdapters` seed, which boot often serves before the refresh finishes (2 s cap).
   - After the version hook runs, `apply_refresh` recomputes `capabilities` and a new `AdapterInfo.fork_unavailable_reason`.
   - `adapter.models.updated` carries both as optional fields, following the precedent set for `installed`. The event is also emitted when only capabilities or the reason changed. The websocket connect replay includes them too.
   - The UI applies both outside the models-revision guard.
7. **Reason copy.** Codex's `fork_unavailable_reason()` returns `Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: X)` when the version is known and below the floor, and `None` otherwise.
   - The UI's `forkAvailability` shows this reason instead of the generic "isn't available" copy when it is present.
   - `fork_chat` returns a new `ForkChatError` variant carrying the reason, which maps to 422.
   - There is no Codex-specific UI branching. The reason field is adapter-agnostic.

## Established facts

- `thread/fork` params: only `threadId` is required. `lastTurnId` means "fork through, inclusive", and the referenced turn cannot be in progress. `excludeTurns`, `ephemeral` and the override fields are optional. There is no `experimentalRawEvents`, `persistExtendedHistory` or `persistFullHistory`, even in the `--experimental` output. Receipt: `codex app-server generate-json-schema [--experimental]` on codex-cli 0.155.1, `v2/ThreadForkParams.json`.
- `thread/fork` response: `thread`, `model` and `cwd` are among the required fields. `Thread.forkedFromId` is "Source thread id when this thread was created by forking another thread". `Thread.id` is a UUIDv7. Receipt: the same schema, `v2/ThreadForkResponse.json`, `definitions.Thread`.
- The parent is loaded from disk: "By thread_id: load the thread from disk by thread_id and fork it into a new thread… Prefer using thread_id whenever possible." Receipt: `ThreadForkParams.json` top-level `description`.
- `thread/fork` first ships in rust-v0.80.0 and is absent in rust-v0.79.0. Receipt: `codex-rs/app-server-protocol/src/protocol/common.rs` `ThreadFork => "thread/fork"` at tag rust-v0.80.0, commit 41a317321d (#8866).
- `forkedFromId` is exposed by the app server from rust-v0.119.0. Receipt: commit 9bb7f0a694 (#16596), GitHub compare API (rust-v0.118.0 "diverged", rust-v0.119.0 "behind").
- `ThreadForkParams.last_turn_id` first ships in rust-v0.143.0 and is absent in rust-v0.142.0. Receipt: `codex-rs/app-server-protocol/src/protocol/v2/thread.rs` `ThreadForkParams` at both tags.
- Paginated thread history is opt-in through `thread/start { historyMode: "paginated" }`. Paginated threads reject `thread/read` with `includeTurns: true`, and forking them is supported only from rust-v0.146.0. Mainframe never sends `historyMode`, so its threads are legacy. Receipts: commit da61f7d8e1 (#33364) message, commit 05f000263b (#35220), first tag rust-v0.146.0 by compare; `mainframe-adapter-codex/src/thread_request.rs::build_thread_request`.
- The local test CLI is codex-cli 0.155.1 (`codex --version`).
- #343 contract:
  - `Adapter::pin_fork_point` returns `Unsupported` by default. Receipt: `mainframe-adapter-api/src/adapter.rs`.
  - `ForkSource { source_session_id, resume_path }`. Receipt: `mainframe-types/src/adapter.rs`.
  - `fork_chat` checks `adapter_fork_info().fork` before pinning. Receipt: `mainframe-chat/src/chat_manager/fork_api.rs`.
  - The lifecycle passes both the own id and `fork_source` while `pending_fork` exists. Receipt: `mainframe-chat/src/lifecycle_manager.rs` `do_load_chat`/`do_start_chat`.
  - `on_result` retires `pending_fork` and ignores a `NotFound` snapshot directory. Receipt: `mainframe-chat/src/event_handler.rs` `on_result`.
- `CodexSession::ensure_thread` runs on the first message and reports the thread id through `sink.on_init`. `load_history` uses `spawn_temp_app_server("codex", …)` plus `thread/read`. Receipts: `mainframe-adapter-codex/src/session.rs`, `src/history_load.rs::load_history_inner`.
- `ThreadReadTurn` already carries `id`. Receipt: `mainframe-adapter-codex/src/types.rs::ThreadReadTurn`.
- `thread/resume` of a thread with no rollout fails with `-32600` "no rollout found for thread id". Receipt: `docs/research/adapters/codex/CONSUMED-SURFACE.md` CODEX-RPC-06.
- The registry never recomputes capabilities after seeding, and `list()` caps refresh at 2 s. Receipts: `mainframe-adapter-api/src/lib.rs` `AdapterRegistry::{apply_refresh, list}`. `adapter.models.updated` already carries `installed` for this same stale-seed reason. Receipts: `mainframe-types/src/events.rs` `AdapterModelsUpdated`, `ui/src/store/adapters.ts::applyAdapterModels`, `mainframe-server/src/websocket.rs::build_connect_replay_events`.
- The UI's first fork check is `capabilityFork` with the generic copy. It is called from `sessions/sidebar/use-row-actions.ts` and `session-tabs/tab-entry.ts`. Receipt: `ui/src/features/sessions/view-model/fork-availability.ts::forkAvailability`.
- Files are capped at 300 lines. Receipt: repository `CLAUDE.md` Code Rules. `session.rs` is already 993 lines, so fork logic goes in new modules and `session.rs` only gains call sites.

## Gate 0: live protocol verification (first task of group codex-fork)

Use the codex-protocol-debugger skill against the real CLI (0.155.1). Record each result as receipts in a new `CODEX-RPC-07 thread/fork` row in `docs/research/adapters/codex/CONSUMED-SURFACE.md`. The implementation and the version floor follow from these results:

1. `thread/fork { threadId }` succeeds in a fresh app-server that never loaded the parent. It also succeeds while the parent is loaded and idle in another app-server process. The fork's `thread.id` differs from the parent's, and `forkedFromId` equals the parent id.
2. With the overrides omitted, the response's `cwd`, `model`, `sandbox` and `approvalPolicy` match the parent's, so they are inherited rather than reset.
3. The server accepts `persistExtendedHistory` and `persistFullHistory` on `thread/fork`. A turn on the fork streams the notification kinds Mainframe consumes without `experimentalRawEvents`.
4. A `lastTurnId` read by `thread/read` in one process is accepted by `thread/fork` in another, and turns after it are omitted.
5. After the fork's first turn, `thread/read` on the fork returns the inherited turns exactly once, with no mis-nested sub-agents. The fork's rollout has no `agent_path`, so `rollout_fork` does not take part.
6. Record when the fork's rollout reaches disk (at the fork call or at the first turn). This confirms that the resolver's "own transcript missing, so fork again" arm is needed.
7. A turn in the fork leaves the parent's turn count unchanged, and the reverse also holds.

## Task groups

### Group capability-refresh (core)

Adds the generic contract that lets an adapter's capabilities depend on the CLI version the registry observes.

Files:
- `mainframe-adapter-api/src/adapter.rs` (trait)
- `mainframe-adapter-api/src/lib.rs` (registry), plus its `tests/registry.rs`
- `mainframe-types/src/adapter.rs` (`AdapterInfo.fork_unavailable_reason`, with serde default and skipped when `None`)
- `mainframe-types/src/events.rs` (`AdapterModelsUpdated` gains optional `capabilities` and `fork_unavailable_reason`)
- `mainframe-server/src/websocket.rs` (connect replay)
- `mainframe-server/src/chat_deps.rs` (`adapter_fork_info`)
- `mainframe-chat/src/fork.rs` (`AdapterForkInfo.unavailable_reason`, the new `ForkChatError` reason variant mapped to 422)
- `mainframe-chat/src/chat_manager/fork_api.rs` and the matching tests (`chat_manager/tests.rs` fake deps, `tests/fork_chat.rs`)

Tasks, TDD inline:
- New `Adapter` trait methods: `observe_cli_version(&self, Option<&str>)`, a no-op by default, and `fork_unavailable_reason(&self) -> Option<String>`, which returns `None` by default. Also remove the stale "(Codex, for now)" wording from the `pin_fork_point` doc comment.
- `run_refresh` calls the version hook on both the installed and the fallback version path, before `apply_refresh`. `apply_refresh` recomputes `capabilities` and the reason from the adapter. It emits `AdapterModelsUpdated` when the models changed or when the capabilities or reason changed. `seed_static_snapshots` fills the reason from the adapter.
- `fork_chat` returns the reason variant when `fork` is false and a reason exists. Otherwise it keeps the existing `Unsupported(name)`.

Verification intent:
- A registry test with a fake adapter whose capabilities flip after the version hook shows the snapshot and the emitted event carry the new capabilities and reason.
- A `fork_chat` test shows the 422 body is the adapter's reason.
- Serde round-trips show an older payload without the new fields still deserializes.
- The existing registry, websocket-replay and `fork_chat` tests still pass.

### Group codex-fork (core)

Depends on capability-refresh, which adds the trait hooks and the `mainframe-types/src/adapter.rs` edits.

Files:
- `mainframe-types/src/adapter.rs` (`ForkSource.last_turn_id`: optional, serde default, skipped when `None`, round-trip test)
- `mainframe-adapter-codex/src/`: new `fork.rs` (or `thread_fork.rs`) holding the pure resolver, the fork-params builder, pin-response mapping and `fork_supported(version)`; `thread_request.rs` (`Fork` variant, or replace it with the resolver's output); `session.rs` (a stored `fork_source` field, and call sites only in `ensure_thread` and `load_history`); `history_load.rs` (turn cap); `types.rs` (optional `forkedFromId` on the fork response); `adapter.rs` (`pin_fork_point`, `capabilities().fork` through the gate, `observe_cli_version`, `fork_unavailable_reason`)
- A new integration test under `mainframe-adapter-codex/tests/` that uses the fake-app-server pattern from `tests/turn_start_model.rs`
- `docs/research/adapters/codex/CONSUMED-SURFACE.md`
- A changeset in `.changeset/`

Tasks:
1. Gate 0 (above). If a result contradicts the design, apply the fallback stated in the Design section and record it. Stop and report if `thread/fork` is unusable, because the replay fallback is out of scope.
2. Write red unit tests first, then implement:
   - Resolver arms: own id only; own id plus fork source with the transcript present or missing; fork source only; no-persistence overrides everything.
   - Fork params: `threadId`, `lastTurnId` when present, the persist flags, and no override keys.
   - `fork_supported`: below the floor, at the floor, above it, and an unparsable version, which counts as unsupported.
   - Pin mapping: last turn id; zero turns gives `last_turn_id: None`; "no rollout found" maps to `TranscriptMissing`.
   - Turn-cap truncation.
3. Write red integration tests against a fake app-server, then wire the session and adapter:
   - **Successful fork:** a spawn with `fork_source` and no own id sends `thread/fork` with the expected params on the first message, `on_init` receives the fork's id, and the next `turn/start` targets the fork's id.
   - **Parent not loaded:** a fresh fake server that has never seen the parent answers `thread/read` and `thread/fork` by id, so pin and fork both work without a prior resume.
   - **History:** an unsent fork's `load_history` reads the source thread truncated at `last_turn_id`. A sent fork (own id, transcript present) reads its own thread once, with no source read, so nothing is duplicated.
   - **Capability:** `capabilities().fork` is false before any observed version, false on 0.142.x with the version-specific reason, and true on 0.143.0 or newer.
4. Add CONSUMED-SURFACE row CODEX-RPC-07 with the Gate 0 receipts, the test names and the version floor. Update CODEX-PROBE-01's consumers to mention the fork gate.
5. Live acceptance in the running app (packaged or dev daemon, real Codex):
   - Fork a Codex chat. The fork shows the parent's messages up to the fork point.
   - Send a message in the fork, then in the parent. Each chat's stored provider id and turns stay independent.
   - The fork's stored thread id differs from the parent's, and `forkedFromId` matches the parent.
   - The Fork menu item behaves exactly as it does for Claude.
6. Add a changeset covering the daemon and UI packages touched by all three groups.

Exit criteria:
- The Codex crate's unit and integration tests pass.
- Workspace clippy and tests pass for the touched crates.
- No new file is over 300 lines, and `session.rs` grows only by call sites.
- The changeset is present.
- Live acceptance results are recorded in the PR evidence.

### Group ui-fork-reason (ui)

Depends on capability-refresh, because it consumes that group's wire field names (`forkUnavailableReason`, the event's `capabilities`). It shares no files with the other groups.

Files:
- `packages/types/src/adapter.ts` (`AdapterInfo.forkUnavailableReason?`, `ForkSource.lastTurnId?` mirror)
- `packages/types/src/events.ts` (`adapter.models.updated` gains `capabilities?` and `forkUnavailableReason?`)
- `packages/ui/src/store/adapters.ts` (`applyAdapterModels` and the subscriber apply both outside the revision guard; `seedAdapters` takes them from the snapshot)
- `packages/ui/src/features/sessions/view-model/fork-availability.ts` (optional `capabilityReason` input: when fork is false, show it if present, otherwise the existing copy)
- `sessions/sidebar/use-row-actions.ts` and `session-tabs/tab-entry.ts` (pass `adapter?.forkUnavailableReason`)
- Co-located `__tests__`

TDD inline:
- A failing `forkAvailability` test shows the reason overrides the generic copy.
- A failing store test shows an `adapter.models.updated` event with `capabilities.fork: true` enables fork on a seeded adapter even when its models revision is not newer, and that an event without the fields leaves the capabilities alone.

Verification intent: the UI unit tests and typecheck pass for `packages/types` and `packages/ui`.

## Risks

- **Gate 0 outcomes.** Omitted overrides might reset instead of inheriting. Turn ids might not be stable across processes. The fork might not persist before the first turn. Each has a stated fallback: pass `cwd` explicitly, drop `lastTurnId` and lower the floor, or rely on the resolver's fork-again arm. A contradiction in any other area is reported, not patched around.
- **A CLI upgraded while the daemon runs** is not re-probed, because the registry's `succeeded` set skips a second refresh. Fork enablement updates on the next daemon start. This is accepted and noted in CONSUMED-SURFACE.
- **E2E mode** skips the refresh for the real adapters, so Codex fork stays false there. The mock adapter drives E2E, so this is acceptable.
- **The pin spawns a temporary app-server (about 1 s)** on the Fork click. This matches `load_history`'s cost, and the UI already shows fork as an async action.
