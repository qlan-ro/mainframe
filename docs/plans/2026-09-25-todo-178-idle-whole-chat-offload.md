# Plan: idle whole-chat offload with transcript cold-reload (#178)

Spec: `docs/specs/2026-09-25-todo-178-idle-whole-chat-offload.md`. Criteria numbers
(AC1 to AC16) refer to the spec's `## Acceptance criteria`.

## Goal

At the 2-hour idle mark, the daemon releases a Claude chat as one unit. It kills the CLI
process, drops the cached history, removes the chat from the live-chat registry, and
broadcasts `chat.offloaded { chatId }` to every client. The renderer then drops the chat's
controller and thread subtree. It waits while the chat is on screen, and it keeps the
composer draft. Reopening the chat rebuilds its history from the transcript through the
post-restart load path and shows a centered spinner while that runs. The next send resumes
the CLI session.

The change is well over 150 lines (daemon lifecycle, wire event, transcript resolution,
renderer release, and a golden test), so this is the full form.

## Design

**Daemon: "offloaded" means "not in the registry and not in the cache".** No new state is
stored. After an offload, `load_chat` finds no registry cell, so a send goes
`send_message → start_chat → do_start_chat → load_chat`. That path reloads the transcript
into the cache before anything is appended, then spawns with the stored session id.
`get_display_messages` and `get_resume_snapshot` go through `get_messages`, which loads
history without spawning. Both paths already exist, so the work is exclusion and
single-flight.

**Exclusion lives in the lifecycle's single-flight `Guards`.** The same mutex already
tracks `loading`, `starting`, and `interrupting`. Add:
- an `offloading` slot per chat;
- an in-flight send count per chat;
- a `history` slot for `get_messages`' transcript read.

Offload claims its slot in one critical section, and only when the chat has no loading,
starting, interrupting, history, or send activity. `load_chat`, `start_chat`,
`get_messages`, and `send_message` wait for an in-flight offload before they read registry
or cache state. `send_message` registers its send in that same critical section, so either
the send is visible to the offload re-check or the send waits for the offload to finish.
Put the new methods in a new child module of `lifecycle_manager` (a child module can see
the private `Guards`). `lifecycle_manager.rs` is already far over 300 lines, so do not grow
it beyond the `Guards` fields.

**Offload sequence (new `mainframe-chat/src/idle_offload.rs`).** Run these steps in order:
1. Claim the offload slot, or skip.
2. Re-check that the registry cell exists, the session is spawned, `last_activity_at` is
   older than the threshold, there is no pending permission, and no queued message refs
   remain. If any check fails, release the slot and skip.
3. Kill the process with `session.kill().await`.
4. Remove the registry cell, delete the cache entry, and clear the chat's partial overlays
   (`EventHandler::clear_display_state`) and permission bookkeeping.
5. Release the slot.
6. Emit `DaemonEvent::ChatOffloaded`.

Do not notify the chat surface with `ChatEnded`: that would end the facade session of a
chat that is on screen. The offloader is built at construction from the shared `Arc`s
(registry, cache, permissions, lifecycle, event handler, deps). The scanner holds it as a
trait object, so the periodic task needs no `Weak<ChatManager>`.

**Scanner (`idle_scanner.rs`).** Split it into two steps:
- **Candidate selection** is a pure read of the registry: spawned, reports activity, idle
  past the threshold.
- **Offload** runs per candidate and re-checks everything.

Expose both steps to tests with an injected clock and threshold. Race tests (AC4) change
state between the two steps.

**Transcript location.** `SessionOptions` gains an optional stored session file path.
Serde keeps it optional and omits it when absent. The history-load constructions pass
`chat.session_file_path`:
- `build_history_session`;
- `do_load_chat`;
- the chat-deps session factory.

The Claude history load resolves the primary file with `locate_claude_transcript` (stored
path first, then the derived path). It then discovers sidechain and subagent files next to
the file it resolved, not next to the derived directory.

**Renderer.** Add a DI'd `OffloadRelease` class plus a hook mounted beside
`useSessionListRouter`. It handles `chat.offloaded` like this:
1. It resolves **every** thread item whose `id` or `remoteId` equals `chatId`. A chat
   created in this app session has two live items: the orphaned `__LOCALID_*` draft
   (`remoteId` = chatId) and the canonical remote item (`id` = chatId). Both map to one
   controller and both subtrees stay mounted (see Established facts).
2. If **any** resolved item is on screen, it defers the release for the whole chat. On
   screen means the item's id is the main thread or is in the zones pair.
3. Otherwise it releases now, in this order:
   - mark every resolved thread so its runtime hook stashes the composer draft on unmount;
   - `detach()` **every** resolved item, which stops each runtime and unmounts each
     subtree. No subtree may survive, because a surviving subtree's next render calls
     `getOrCreate` under its own key and puts a controller back;
   - only after all detaches, `chatControllerRegistry.dispose(chatId)` once, which drops
     both keys (the chat id and the adopted draft alias).
   An unknown `chatId` (no resolved items) still calls `dispose(chatId)`, which is a no-op
   when the registry has no entry.

Checking only one item is wrong in both directions. If the check sees only the draft while
the canonical item is main, it releases and disposes the on-screen controller, and the
screen reloads blank with the spinner. If it detaches only the canonical item, the draft
subtree re-creates a controller under the `__LOCALID_*` key and leaks.

Deferred chats are released when `mainThreadId` or the zones pair stops including all of
their resolved items. The
thread's runtime hook restores a stashed draft (text and attachments) when it mounts again.
`ChatThread` gets a centered `chat-thread-loading` spinner when all of these hold:
- `loadState` is `loading`;
- the thread has no messages;
- the thread is not a `__LOCALID_*` draft.

## Established facts

- Today the scanner kills an idle process without re-checking anything and never touches
  the cache — `mainframe-chat/src/idle_scanner.rs` `scan_registry`.
- `load_chat` is single-flight and skips a chat that is already in the registry.
  `do_load_chat` inserts a cell, creates an unspawned session, loads history into the cache,
  and restores the pending permission — `lifecycle_manager.rs` `load_chat`, `do_load_chat`.
- The send path calls `start_chat` only when not spawned. `do_start_chat` begins with
  `load_chat` — `chat_manager/send_entry.rs` `send_message`; `lifecycle_manager.rs`
  `do_start_chat`.
- `get_messages` has no single-flight for its `history_session` read: two concurrent
  misses both call `load_history` — `chat_manager/history.rs` `get_messages`.
- Facade resume never spawns. The chain is `session/resume` → `get_resume_snapshot` →
  `get_display_messages` → `get_messages` — `mainframe-server/src/acp_ws/ports.rs`,
  `chat_manager/history.rs`.
- The history load uses only the derived path. The chain is `ClaudeSession::load_history`
  → `history::load_history(session_id, project_path)` → `discover_session_jsonl_files`.
  Presence already checks the stored path first — `mainframe-adapter-claude/src/session.rs`,
  `src/history.rs`, `src/transcript.rs` `locate_claude_transcript`.
- `SessionOptions` has no stored-path field, and it has about 13 non-test construction
  sites — `mainframe-types/src/adapter.rs` `SessionOptions`.
- The stored path is written at session init from the spawn cwd —
  `event_handler.rs` `compute_session_file_path` (caller in the init handler).
- Fan-out delivers chatId-scoped events only to subscribers, except the types listed in
  `CONNECTION_GLOBAL_EVENT_TYPES`. Today those are `chat.notification` and
  `automation.notification`. There is a unit-test pattern for no-subscription delivery —
  `mainframe-server/src/websocket.rs` `fanout`,
  `delivers_provider_quota_updated_to_a_client_subscribed_to_no_chat`.
- A late `on_exit` finds no registry cell after removal and skips its chat bookkeeping.
  `mutate_messages` is a no-op when the cache entry is absent — `event_handler.rs`
  `on_exit`, `mutate_messages`.
- `ClaudeSession::kill` sends SIGTERM and waits for the child to close —
  `mainframe-adapter-claude/src/session.rs` `kill`.
- Every `event.*.json` in `mainframe-types/tests/fixtures/` is round-tripped through
  `DaemonEvent` — `mainframe-types/tests/golden_fixtures.rs`.
- The existing parity test replays JSONL lines through `events::handle_stdout` and
  compares them with `convert_history_entry`. The facade encoding is
  `mainframe_acp::encoder::encode(&[DisplayMessage]) -> Vec<EncodedItem>` —
  `mainframe-adapter-claude/tests/live_vs_history_id_parity.rs`,
  `mainframe-acp/src/encoder.rs` `encode`.
- `mainframe-chat` does not depend on `mainframe-adapter-claude` or `mainframe-acp`, but
  `mainframe-server` depends on all three — the crates' `Cargo.toml`.
- In aui core@0.3.12, the thread-list-item scope exposes `detach()`. The remote list core's
  `detach` runs `_ensureThreadIsNotMain`, which switches away if the thread is main, and then
  `stopThreadRuntime`, which drops the instance so the subtree unmounts. Never call it for
  an on-screen thread — `@assistant-ui/core` `src/store/scopes/thread-list-item.ts`,
  `src/react/runtimes/RemoteThreadListThreadListRuntimeCore.tsx` `detach`,
  `RemoteThreadListHookInstanceManager.tsx` `stopThreadRuntime`.
- The composer state belongs to the thread runtime, so detaching loses it unless it is
  stashed — `useExternalStoreRuntime` in `features/chat/runtime/use-chat-thread-runtime.ts`
  (`restoreAttachments` shows the re-add path).
- `useChatRuntimeHook` calls `chatControllerRegistry.getOrCreate` on every render. A render
  of the dying subtree after `dispose` would recreate a controller —
  `features/sessions/runtime/use-chat-runtime-hook.ts`.
- `ChatControllerRegistry.dispose` removes every key that maps to the controller, including
  the adopted alias — `features/sessions/runtime/chat-controller-registry.ts`.
- A chat created in this app session has two live thread items. After the first send, the
  `chat.created` reload adds the canonical remote item (`id` = chatId) and the router
  switches to it, leaving the `__LOCALID_*` draft item (`remoteId` = chatId) orphaned but
  mounted. `adopt()` maps both keys to one controller —
  `features/sessions/ws/use-session-list-router.ts` (first-send handoff branch),
  `chat-controller-registry.ts` header and `adopt`.
- Load dispatches `history.loading`, then awaits `session/resume` (active thread), then
  dispatches `history.ready` or `history.failed`. A new controller's first attach does a
  full replay — `features/chat/controller/chat-plane-loader.ts` `load`,
  `acp-session-attachment.ts` `resume`.
- The load-error banner is `chat-thread-load-error` in `features/chat/thread/ChatThread.tsx`
  `LoadErrorBanner`. Side-band routing is `useSessionListRouter`, mounted in
  `app/AppShell.tsx`.

## Task groups

### G1 daemon-offload (core)

Files:
- `mainframe-types/src/events.rs`, plus a new `tests/fixtures/event.chat-offloaded.json`;
- `mainframe-server/src/websocket.rs`, for the global set and its unit test;
- `mainframe-chat/src/idle_scanner.rs` and a new `idle_offload.rs`;
- `lifecycle_manager.rs` (the `Guards` fields only) and a new
  `lifecycle_manager/flight_claims.rs`;
- `chat_manager/{construct,history,send_entry}.rs`;
- `test_support.rs`, for a `load_history` call counter;
- a new `chat_manager/tests/offload.rs`, registered in `chat_manager/tests.rs`.

TDD, red first:
- AC1 to AC5: scanner and offload tests with an injected clock and threshold.
- AC6 and AC7: chat-manager history and send-after-offload tests.
- AC10: the Rust half, meaning the event variant, the fixture, and the global fan-out unit
  test.

Existing idle-scanner tests are updated to the new selection/offload split. Verify that the
listed tests pass under `cargo test -p mainframe-chat`, `-p mainframe-types`, and
`-p mainframe-server`, and that clippy is clean for those crates.

### G2 transcript-location (core), after G1

Files:
- `mainframe-types/src/adapter.rs` (`SessionOptions`);
- `mainframe-adapter-claude/src/{session,history}.rs`;
- every `SessionOptions` construction site: `lifecycle_manager.rs`,
  `chat_manager/shared.rs`, `mainframe-server/src/chat_deps.rs`, adapter-claude/mock
  sites, and tests.

TDD for AC8 in adapter-claude, with both the stored-path-wins case and the derived fallback.
Sidechain and subagent discovery follow the resolved file. The history load passes the
stored path everywhere a history session is built. Verify that the adapter-claude,
mainframe-chat, and mainframe-server tests pass and that the workspace builds. The change
touches a shared type, so run `cargo check` over the whole `packages/core-rs` workspace.
The Tauri shell constructs no `SessionOptions` (checked while planning).

### G3 golden-parity-and-e2e (core), after G2 and G4

Add a new `mainframe-server/tests/live_vs_cold_reload_golden.rs` (AC9). It takes one
recorded Claude session:
- **Live:** run the session through the live pipeline. That means the user prompt through
  the same send-path message creation, and the stdout lines through `handle_stdout` into the
  real `EventHandler` sink and cache.
- **Cold reload:** run the same session through `load_history` → `remap_history`.
- **Both:** apply `prepare_messages_for_client` → `encode`.

Compare the ordered items with timestamps removed and no exception list. Fix every
divergence at its source, whether that is the history converters, the event handler, or
the display grouping. If a fix grows beyond this change, stop and report it for the spec
gate (spec decision 10). Do not weaken the test.

Also owns:
- AC15, the live QA against the running app (restart-based, as the spec describes);
- AC16 overall, the final `cargo test` for `mainframe-chat` and `mainframe-server`, plus
  the UI typecheck;
- the changeset for the feature.

### G4 renderer-offload (ui), parallel

Files:
- `packages/types/src/events.ts` (the `chat.offloaded` union member, AC10 TS half);
- a new `features/sessions/runtime/offload-release.ts` and `use-offload-release.ts`,
  mounted in `app/AppShell.tsx`;
- a new composer-draft stash module, with capture on unmount and restore on mount, wired
  into `features/chat/runtime/use-chat-thread-runtime.ts` or `use-chat-runtime-hook.ts`;
- `features/chat/thread/ChatThread.tsx` (`chat-thread-loading`);
- tests beside each.

TDD:
- AC11: release off screen; an unknown id is a no-op. The alias case mounts both the
  `__LOCALID_*` draft item and the canonical item for the same chat, and asserts that both
  are detached, that the registry has no entry under either key after the release settles,
  and that detach happens before dispose.
- AC12: an on-screen chat is deferred, then released after a switch. The alias case mounts
  both items with the canonical item as main (and, separately, in the zones pair), and
  asserts that neither item is detached, the controller is not disposed, and the
  transcript stays until the switch away.
- AC13: the spinner shows, hides on ready and on error, and is absent on a draft.
- AC14: the draft survives a release.

Read the `mainframe-design-system` skill before writing the spinner markup. Use a lucide
`Loader2Icon` with `animate-spin motion-reduce:animate-none`, centered in the transcript
column. Verify with single-file vitest runs, the UI typecheck, and the types `tsc --noEmit`.

## Risks

- **Offload/send race on a multi-thread runtime.** Only the shared `Guards` critical section
  makes this airtight. A check-then-act across two locks reintroduces a lost or misrouted
  send.
- **A late `on_exit` after removal no longer emits the post-kill `chat.updated`.** The row
  must not change (spec). The DB `processState` of an idle chat is already cleared.
  Confirm that the sidebar row and `displayStatus` match the pre-offload state.
- **The dying thread subtree re-renders after `dispose`** and recreates a controller.
  Order the release as detach every resolved item (draft and canonical), then dispose once.
  AC11 asserts that the registry is empty under both keys after the release settles.
- **The golden test may expose large live/history divergences.** Spec decision 10 sends
  those back to the spec gate rather than accepting them.
- **The `SessionOptions` field ripples through every adapter and test constructor.**
  Keep the field optional and serde-skipped so the wire shape does not change.

## Exit gates

- AC1 to AC14 are each covered by a named test that failed before the change and passes
  after it.
- AC15 live QA is recorded.
- The AC16 commands pass.
- A changeset is present.
- No new file exceeds 300 lines, and no function exceeds 50.
