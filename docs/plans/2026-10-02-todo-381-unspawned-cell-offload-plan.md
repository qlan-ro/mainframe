# Idle offload for unspawned registry cells

Todo #381, bug, no-spec route. Short-form plan: the expected source diff is about 100 lines plus tests.

## Goal

Registry cells with no running adapter process should become eligible for the existing idle offload. This covers chats that were created but never sent, chats whose spawn failed, cells created by REST `/resume` that never started, and sessions whose process has exited. Offload releases the cell, the cache entry, its pin and transient bookkeeping. The chat row and transcript stay as they are. A later load or send then rebuilds through the existing cold-load and `--resume` paths.

Spawned sessions keep their current policy: the same threshold, `session.last_activity_at()`, the Working guard and kill-on-offload. The two-hour threshold (`IDLE_THRESHOLD_MS`) and five-minute scan interval stay unchanged.

## Design

- **Clock.** Add `last_used_at: i64` (epoch ms) to `ActiveChat`. Add `ActiveChat::new(chat, session)`, which stamps the current time and leaves `turn_started_at` empty. All three production insertions use it: `ChatLifecycleManager::create_chat`, `do_load_chat` and `fork_api`'s fork insert. The clock lives in memory only, so a newly created or loaded cell never inherits the persisted chat's age.
- **Touch.** Add a `ChatLifecycleManager` helper that sets `last_used_at` to the current time on the chat's cell, if the cell exists. Call it on every path that counts as use:
  - `load_chat`, including the branch that skips because the cell already exists;
  - `start_chat`;
  - `begin_send` registration and `SendGuard` drop (`end_send`);
  - `release_history`;
  - `ChatManager`'s `get_active_chat` in `chat_manager/deps_config.rs`. Config edits on an unsent chat do not take a lifecycle claim, so this covers them.

  `ChatOffload::recheck` runs after `try_claim_offload` has refused any busy chat. Because each use either holds a claim during selection or touches the clock when it ends, a race resolves through the existing claim and recheck.
- **One eligibility rule.** Add a free function in `idle_scanner.rs`, `idle_since(session: Option<&Arc<dyn AdapterSession>>, last_used_at: i64) -> Option<i64>`:
  - for a spawned session, it returns `session.last_activity_at()`, which is unchanged and gives `None` (never idle) when the session has no tracking;
  - otherwise, it returns `Some(max(last_used_at, session.last_activity_at() if any))`.

  `select_idle_candidates` and `ChatOffload::recheck` both use this function and drop their separate `session?`, `is_spawned` and `last_activity_at` checks. Clone the session and `last_used_at` out of the cell lock before calling session methods, as the current code does.
- **Offload.** `recheck` returns the optional session handle. The session-less case is valid, so it should no longer mean "skip". Keep the Working, pending-permission and queued-ref checks for every cell. Step 3 calls `kill()` only when a handle exists. That call is harmless on an unspawned handle (see Established facts) and reaps an exited process. Steps 4–6 stay the same: remove the cell, call `MessageCache::release`, `clear_display_state`, `permissions.forget`, release the claim and emit `ChatOffloaded`. They must not archive, delete or emit `ChatEnded`.
- Update the doc comments that say an unspawned cell is never a candidate. These are in the module docs for `idle_scanner.rs` and `idle_offload.rs`, the `select_idle_candidates` doc and the `recheck` doc.

## Files

- `packages/core-rs/crates/mainframe-chat/src/types.rs`: field, constructor
- `packages/core-rs/crates/mainframe-chat/src/idle_scanner.rs`: `idle_since`, selection, unit tests
- `packages/core-rs/crates/mainframe-chat/src/idle_offload.rs`: recheck and optional kill
- `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs` and `lifecycle_manager/flight_claims.rs`: touch helper and calls, constructor at insertions
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/fork_api.rs` and `chat_manager/deps_config.rs`
- `packages/core-rs/crates/mainframe-chat/src/message_cache.rs`: test-only `is_pinned` accessor, so tests can observe pin release
- Every `ActiveChat { .. }` literal in the crate's tests (about 15 files): move each to the constructor, or add the field
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests/offload.rs`: integration tests
- `.changeset/<name>.md`: patch changeset

## Implementation (single group, TDD inline)

1. **Red.** Write the tests below first and confirm they fail for the expected reason. Compile errors from the missing field or constructor are acceptable as the first red step.
   - Unit tests (`idle_scanner.rs`), using an injected `now` and an explicit `last_used_at`:
     - a session-less cell idle past the threshold is selected;
     - an unspawned session handle with an old `last_used_at` is selected;
     - a fresh `last_used_at` keeps an unspawned cell out, even when the session activity or the chat's persisted timestamps are ancient;
     - the existing spawned-path tests still hold. Rewrite `skips_sessions_that_are_not_spawned` to state the new rule rather than rely on clock coincidence.
   - Integration tests (`tests/offload.rs`), through a real `ChatManager`:
     - (a) A cell from `create_chat` that is backdated past the threshold is offloaded. The cell, the cache and the pin are gone, the chat is still in the store and not archived, and `ChatOffloaded` is emitted once.
     - (b) A REST-resume-style cell has an unspawned `FakeSession` handle and a transcript. After it is backdated and offloaded, a send succeeds and the reloaded history IDs equal the pre-offload IDs, followed by the new message. Follow the AC7 pattern.
     - (c) A just-created or just-loaded cell is not offloaded by a scan.
     - (d) Races between `select_idle_candidates` and `offloader_for(..).offload`:
       - a registered send keeps the cell;
       - a touch keeps the cell;
       - a load in flight keeps the cell, or the existing flight-claims guard test covers it.
     - (e) On an unspawned backdated cell, a pending permission, a queued ref or a Working process state each prevents offload.
     - (f) The AC3 row "no spawned process" changes meaning. Relabel or adjust it so that it asserts a fresh unspawned cell stays live.
2. **Green.** Implement the design above, then update every struct literal.
3. Add a patch changeset. Recent changesets for daemon-only fixes name `@qlan-ro/mainframe-app-tauri`.

## Risks

- **Over-eager offload.** Any user path that reads an unspawned cell without a claim or a touch could see its cell disappear mid-operation. Known claim-free users are config edits (now touched) and permission responses (blocked by the pending check). The reviewer should confirm that no other path holds a cell `Arc` across an await on a chat that has been idle for two hours.
- **Stale Working state.** An unspawned cell whose persisted `process_state` is Working, for example a REST resume held by a pending gate, stays pinned. The acceptance criteria require this behavior. Do not relax it here.
- **Lock order.** `idle_since` calls session methods. Never call it while holding the cell mutex.
- **Fixture churn.** The struct-literal updates are mechanical and must not change behavior in other tests.

## Established facts

- PR #735 is merged into `main` (`gh pr view 735`: MERGED 2026-10-01). This branch already contains pinning: `MessageCache::pin` and `release` in `message_cache.rs`, and `pin` calls in `create_chat` and `do_load_chat` in `lifecycle_manager.rs` and in `fork_api.rs`.
- `select_idle_candidates` (`idle_scanner.rs`) and `ChatOffload::recheck` (`idle_offload.rs`) each require a session, `is_spawned()` and `last_activity_at()`. This is the leak.
- `ChatLifecycleManager::resume_chat` (`lifecycle_manager.rs`) calls `load_chat` and starts only Working chats. `do_load_chat` attaches an unspawned session from `create_session` when a resume or fork anchor exists.
- `try_claim_offload` (`lifecycle_manager/flight_claims.rs`) refuses a claim while loading, starting, interrupting, history or send activity is in flight. `begin_send`, `load_chat`, `start_chat` and `get_messages` (`chat_manager/history.rs`) wait out an in-flight offload.
- `ClaudeSession::kill` (`mainframe-adapter-claude/src/session.rs`) returns `Ok` when no child exists. Codex `kill` (`mainframe-adapter-codex/src/session.rs`, `impl AdapterSession`) clears command state and returns `Ok` when no client exists.
- `AdapterSession::last_activity_at` (`mainframe-adapter-api/src/adapter.rs`) defaults to `None`, which means "always active".
- `chat_manager/tests/offload.rs` provides `offloader_for`, `seed_offloadable_chat_with_transcript`, `long_idle` and the real-clock pattern. `StoreDeps::set_spawn_ok` and `created_sessions` are in `chat_manager/tests.rs`.
- `MessageCache` has no public pin query (`message_cache.rs`, field `pinned`), so pin-release tests need a test-only accessor.

## Exit gates

- The `mainframe-chat` tests pass, including the new unspawned-expiry and race tests and every existing offload, scanner and flight-claims test.
- Workspace clippy with warnings denied and `cargo fmt --check` are clean for the touched crates.
- A search finds no production `ActiveChat { .. }` literal that bypasses the constructor.
- The patch changeset is present.
