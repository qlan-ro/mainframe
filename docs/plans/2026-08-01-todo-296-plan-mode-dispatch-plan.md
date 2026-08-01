# Todo #296 — Plan-mode dispatch wiring + single approved-plan record

**Branch:** `todo/296-plan-mode-issues` · **Route:** no-spec (built from the approved Agent Brief + the 2026-07-29 design direction)

## Goal

The Rust daemon carries a fully ported plan-mode chain — `PlanModeHandler` (dispatcher) and
`ClaudePlanModeHandler` (both approval paths, 5 green unit tests) — but nothing calls it: the three
`PhDeps::plan_mode_*` methods in `chat_manager.rs` are `TODO(port)` no-ops, the `Adapter` trait has no
`create_plan_mode_handler` seam, and no production `PlanActionContext` exists. So approving a plan today
persists nothing (`planMode` stays true, the chosen execution mode is dropped) and "clear context and
implement" does nothing at all. This plan wires that chain end to end — adapter seam → `ChatManagerDeps`
resolution → a production `PlanActionContext`/`PlanModeContext` pair → the three `PhDeps` forwards — so
approval patches the chat and broadcasts `chat.updated`, and the clear-context path denies, shifts the
pending, kills and detaches the session, clears the session id, clears messages + display cache, restarts,
and sends exactly one `Implement the following plan:` message. On the UI side it stops the transcript
showing the approved plan twice: the gate unmounts on approval and the durable record (`PlanBubble`) is
rebuilt on the shared gate shell with the execution mode as a caption.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file, 50/function; tests required for new core logic; `data-testid` on
  every interactive element; changeset required; no leftovers; never commit to `main`.
- `packages/ui/CLAUDE.md`: load the `mainframe-design-system` skill before writing any markup/class names.
- `chat_manager.rs` is already 2195 lines (pre-existing violation carried by the port). Keep the additions
  there to the wiring minimum; all new logic lands in `plan_mode_actions.rs`. Do **not** open a refactor.
- No `async-trait` in the workspace — async trait methods return the hand-rolled `BoxFuture`.
- Out of scope (per the brief): the Codex plan-mode handler behavior, the permission-answer envelope (#283),
  plan-mode entry, gate width (#297), long-line overflow (#298).

## Decisions taken while planning (flagged for review)

1. **`Adapter::create_plan_mode_handler` gets a `None` default** rather than being required on all 7 `Adapter`
   impls. This mirrors the TS optional `createPlanModeHandler?` and the existing defaulted optional methods
   (`generate_title`, `is_transcript_present`). It is *not* the #290/#273 defaults trap: `None` means "this
   adapter has no handler", which routes to the dispatcher's existing warn + no-op — the documented behavior
   for an unresolved handler.
2. **`ChatManagerDeps::create_plan_mode_handler` is required, not defaulted** (only 2 impls: `DaemonChatDeps`,
   `StoreDeps`), per the #273 rule that every deps impl states its answer.
3. **`PlanModeContext::action_context` gains a `request_id` parameter.** `PlanActionContext::permissions_shift()`
   takes no arguments, but `PermissionManager::shift(chat_id, request_id)` only pops on a front match (#284).
   The id must be threaded from the response into the context. Signature becomes
   `action_context(&self, chat_id: &str, request_id: &str)`.
4. **`clear_claude_session_id: true` maps to `ChatManagerDeps::chats_clear_session`**, not to a `ChatUpdate`
   field (`ChatUpdate::claude_session_id` is `Option<String>` and cannot express a NULL write). Deviation:
   `clear_session` also NULLs `session_file_path` and resets `transcript_missing` — correct here, since the
   clear-context path deliberately abandons the old transcript.
5. **`PlanActionContext::send_message` reaches `ChatManager::send_message` via a weak self-reference**
   (`OnceLock<Weak<ChatManager>>` + `attach_self()` called from `build_chat_manager`), not `Arc::new_cyclic`
   — `new_cyclic` would churn every `ChatManager::new` call site in the crate's tests. Missing/dead weak =
   `warn!` + `Err(AdapterError)`, never a silent no-op.
6. **The escalation double-send is preserved and pinned by a test** (per the brief), with a live-verification
   contingency in T12.
7. **The execution-mode caption is threaded into `PlanBubble` as an `executionMode` prop; `PlanBubble`
   itself calls no hooks.** The value still originates from `extras.state.chatConfig.permissionMode` — the
   durable, server-authoritative value this very approval writes; nothing per-message records it — but the
   `useChatExtras()` read happens in the two call sites (`UserMessage`, `PlanCard`), which always render
   inside the runtime tree. `useChatExtras` wraps `useAuiState` and **throws**
   (`Error: You are using a component or hook that requires an AuiProvider.`) outside one, and three
   existing suites render `PlanBubble` with no provider — reading it inside `PlanBubble` would break them
   (T10 step 4 lists the fallout the two new call-site readers *do* cause). Known limitation: the caption
   reflects the chat's *current* mode, so it goes stale if the user later changes the mode. The
   "· context cleared" half is exact, derived from the call site (only the clear-context path produces an
   `Implement the following plan:` user message).

## Sequencing risk (from the design direction, non-negotiable)

Land T1–T6 (the daemon shifts the pending on the clear-context path) **before** T10 removes
`ChatGateMount`'s retention rule. Reversed, `PermissionReplyTracker.verifyDelivered` re-reads
`GET /pending-permission` 3s after every approval, finds the still-pending request, and re-dispatches it —
the gate flickers back. Verify by hand between the two: approve a plan, then
`curl :PORT/api/chats/<id>/pending-permission` must return nothing.

---

## Phase 1 — Rust core (group `core-plan-dispatch`)

### T1 — Adapter seam for the plan-mode handler

**Files:** `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`,
`packages/core-rs/crates/mainframe-adapter-claude/src/adapter.rs`

- Add to the `Adapter` trait: `fn create_plan_mode_handler(&self) -> Option<Arc<dyn PlanModeActionHandler>> { None }`
  with a one-line doc: `None` = no plan-mode strategy → the dispatcher warns and no-ops.
- Amend the `TODO(port)` block at `adapter.rs:274-278` — it currently defers `createPlanModeHandler`; drop that
  clause, keep the CRUD deferrals, and update the `todos:` count in the PORT STATUS footer.
- Implement it on `ClaudeAdapter`, returning `Arc::new(ClaudePlanModeHandler)`. Replace the inherent
  `create_plan_mode_handler` at `adapter.rs:107` (returning `Box<dyn PlanModeActionHandler>`) — do not leave both.
- Do **not** override on `CodexAdapter`: its handler is a behavior-free unit struct that does not implement
  `PlanModeActionHandler`, and the behavioral port is out of scope. Leave the inherent method alone.

**Verify:** `cargo check -p mainframe-adapter-api -p mainframe-adapter-claude -p mainframe-adapter-codex`;
`cargo test -p mainframe-adapter-claude plan_mode` (the 5 existing handler tests stay green).

### T2 — Handler resolution on `ChatManagerDeps`

**Files:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`,
`packages/core-rs/crates/mainframe-server/src/chat_deps.rs`,
`packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`

- Add to `ChatManagerDeps` (no default body):
  `fn create_plan_mode_handler(&self, adapter_id: &str) -> Option<Arc<dyn PlanModeActionHandler>>;`
  Doc it as `adapters.get(adapterId)?.createPlanModeHandler()`. This keeps `mainframe-chat` free of any
  adapter-crate dependency (the trait already lives in `mainframe-adapter-api`, which `mainframe-chat` uses).
- `DaemonChatDeps`: `self.adapters.get(adapter_id).and_then(|a| a.create_plan_mode_handler())`.
- `StoreDeps` (tests): add a `plan_handler: Option<Arc<dyn PlanModeActionHandler>>` field (defaulted `None` in
  the existing constructor/`Default`) and return a clone of it, so T3 can inject a recorder.

**Verify:** `cargo check -p mainframe-chat -p mainframe-server`; `cargo test -p mainframe-chat` compiles
(existing tests still green).

### T3 — RED: dispatcher wiring tests

**Files (new):** `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests/plan_mode.rs`
**Files (edit):** `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` (add `mod plan_mode;` at the
top; widen `StoreDeps`, `RecSession`, and `seed_active` to `pub(super)` only if the child module needs it — a
child module already sees the parent's private items, so prefer no visibility change at all).

Add a `RecordingHandler` implementing `PlanModeActionHandler` that pushes `("on_approve" | "on_approve_and_clear_context", …)`
into a `Mutex<Vec<String>>` and captures the `ControlResponse` it received. Then, driving through
`ChatManager::respond_to_permission` (the real WS entry point) with a seeded active chat:

1. `forwards an ExitPlanMode approval to the adapter handler` — plan-mode escalation reaches `on_approve` once,
   with the response's `executionMode` intact.
2. `forwards a clear-context approval to the adapter handler` — `clearContext: true` reaches
   `on_approve_and_clear_context`, and `on_approve` is never called.
3. `persists permissionMode + planMode:false with no live session` — the no-process path calls
   `chats_update` with `permission_mode = response.executionMode` and `plan_mode = false`, emits `chat.updated`,
   and does **not** invoke the handler.
4. `defaults a missing executionMode to interactive` — `execution_mode: None` → `ExecutionMode::Default`.
5. `warns and no-ops when the adapter has no handler` — `plan_handler: None` leaves the chat untouched and the
   call returns `Ok`.
6. `answers the escalation on the wire exactly once via the permission handler and once via the handler`
   — pins decision 6: `RecSession` records `respond_to_permission` twice and `set_permission_mode` once, and
   `set_permission_mode` is recorded only when the session is spawned. Comment the assertion with the
   "preserved deliberately, see T12" reason so a future reader does not silently 'fix' it.

**Verify:** `cargo test -p mainframe-chat plan_mode` — all 6 FAIL (the `PhDeps` stubs are still no-ops). Record
the failure output in the task hand-off; do not proceed until they are observed red.

### T4 — Production `PlanActionContext` + `PlanModeContext`

**Files:** `packages/core-rs/crates/mainframe-chat/src/plan_mode_actions.rs` (replace the 2-line skeleton),
`packages/core-rs/crates/mainframe-chat/src/plan_mode_handler.rs`,
`packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

In `plan_mode_actions.rs`:

- `pub(crate) trait PlanHost: Send + Sync` — the narrow seam back into `ChatManager`'s privately-typed pieces,
  so this module never names `EhDeps`/`LcDeps`:
  `emit_event(DaemonEvent)` (enriched), `emit_display(&str)`, `clear_display_cache(&str)`,
  `start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>`,
  `send_message<'a>(&'a self, chat_id: &'a str, content: &'a str) -> BoxFuture<'a, Result<(), AdapterError>>`.
- `pub(crate) struct ChatPlanModeCtx { deps: Arc<dyn ChatManagerDeps>, active_chats: Registry, messages: Arc<Mutex<MessageCache>>, permissions: Arc<Mutex<PermissionManager>>, host: Arc<dyn PlanHost> }`
  implementing `PlanModeContext`:
  - `chats_update` → `deps.chats_update(chat_id, &ChatUpdate { permission_mode: Some(mode), plan_mode: Some(plan_mode), ..Default::default() })`.
  - `emit_event` → `host.emit_event`.
  - `resolve_plan_mode_handler` → `deps.create_plan_mode_handler(adapter_id)`.
  - `action_context(chat_id, request_id)` → an `Arc<ChatPlanActionCtx>`.
- `struct ChatPlanActionCtx { chat_id: String, request_id: String, … same fields … }` implementing every
  `PlanActionContext` method:
  - `update_chat(patch)` — mutate the in-memory `ActiveChat.chat` (`plan_mode`, `permission_mode`, and
    `claude_session_id = None` when `clear_claude_session_id`) under a short lock, drop it, then persist:
    `deps.chats_update(...)` for the two fields and `deps.chats_clear_session(chat_id)` when
    `clear_claude_session_id` (decision 4). Never hold the lock across the persist.
  - `emit_chat_updated` — clone the chat under the lock, emit `DaemonEvent::ChatUpdated { chat, reason: None }`
    via `host.emit_event` after the drop.
  - `session_*` — read `active.session` (clone the `Arc`) under a short lock, then await outside it
    (CONCURRENCY rules 1-4). `session_is_spawned` = `session.map(|s| s.is_spawned()).unwrap_or(false)`;
    a `None` session makes the async ones `Ok(())`.
  - `clear_active_session` — `active.lock().session = None`.
  - `permissions_shift` — `permissions.lock().shift(&self.chat_id, &self.request_id)` (decision 3), result
    discarded.
  - `recover_latest_plan_file` — `crate::context_tracker::extract_latest_plan_file_from_messages(messages.get(chat_id))`.
  - `add_plan_file(path)` → `deps.add_plan_file(&self.chat_id, &path)`.
  - `clear_messages` → `messages.lock().set(chat_id, Vec::new())`; `clear_display_cache` → `host.clear_display_cache`.
  - `start_chat` → `host.start_chat(chat_id)` mapped to `Ok(())`; `send_message` → `host.send_message`.

In `plan_mode_handler.rs`: change `PlanModeContext::action_context` to take `request_id: &str` and pass
`&response.request_id` at both call sites (`handle_clear_context`, `handle_escalation`). Update the trait doc
and the PORT STATUS `notes:` line that describes `action_context`.

In `chat_manager.rs` (wiring only, keep it ≤ ~60 added lines):

- `struct PlanHostImpl { event_handler: Arc<EventHandler<EhDeps>>, lifecycle: Arc<ChatLifecycleManager<LcDeps>>, deps: Arc<dyn ChatManagerDeps>, permissions: Arc<Mutex<PermissionManager>>, self_ref: Arc<OnceLock<Weak<ChatManager>>> }`
  implementing `PlanHost` (`emit_event` → `enrich_and_emit`; `send_message` → T5).
- Give `PhDeps` a `plan_mode: Arc<PlanModeHandler<ChatPlanModeCtx>>` field, built in `ChatManager::new` from the
  same `deps`/`active_chats`/`messages`/`permissions` clones already in scope.
- Replace the three stubs with forwards: `handle_no_process(chat_id, active, response)`,
  `Box::pin(self.plan_mode.handle_clear_context(chat_id, active, response))`, and the escalation twin. Delete
  the three `TODO(port)` comments.

**Verify:** `cargo test -p mainframe-chat plan_mode` — tests 1-5 from T3 GREEN (6 may need the T5 send seam);
`cargo test -p mainframe-chat` fully green; `cargo clippy -p mainframe-chat -- -D warnings`.

### T5 — Weak self-reference for the follow-up send

**Files:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`,
`packages/core-rs/crates/mainframe-server/src/chat_deps.rs`

- Add `self_ref: Arc<OnceLock<Weak<ChatManager>>>` to `ChatManager` (created in `new`, cloned into `PlanHostImpl`).
- `pub fn attach_self(self: &Arc<Self>)` — `let _ = self.self_ref.set(Arc::downgrade(self));` (idempotent; a
  second call is ignored, no panic).
- `PlanHostImpl::send_message` — upgrade the weak; on success call
  `manager.send_message(chat_id, content, None, None).await` and map `SendError` into
  `AdapterError`. On a missing/dead weak: `warn!(chat_id, "plan-mode follow-up send has no ChatManager — attach_self was never called")`
  and return `Err`. Never silently succeed.
- `build_chat_manager`: bind the `Arc`, call `manager.attach_self()`, return it.

**Verify:** `cargo test -p mainframe-chat plan_mode` (test 6 green); `cargo check -p mainframe-server`;
`rg -n "attach_self" packages/core-rs/crates/mainframe-server/src/chat_deps.rs` shows the boot call.

### T6 — Unit tests for the production context

**Files:** `packages/core-rs/crates/mainframe-chat/src/plan_mode_actions.rs` (inline `#[cfg(test)] mod tests`)

Against a fake `PlanHost` + a real `PermissionManager`/`MessageCache`/recording `ChatManagerDeps`:

1. `permissions_shift pops only the matching front request` (front id match → popped; mismatch → queue intact).
2. `update_chat with clear_claude_session_id calls chats_clear_session and nulls the in-memory id`.
3. `update_chat without it never calls chats_clear_session`.
4. `recover_latest_plan_file reads the cached messages` (returns the newest plan path; `None` when absent).
5. `send_message errors and warns when no ChatManager is attached` (drive `PlanHostImpl` with an unset `OnceLock`).
6. `clear_messages empties the cache for that chat only`.

**Verify:** `cargo test -p mainframe-chat plan_mode_actions` green; `cargo clippy -p mainframe-chat -- -D warnings`;
file stays under 300 lines (split the test module into `plan_mode_actions/tests.rs` if it would not).

### T7 — Stale port-note cleanup

**Files:** `packages/core-rs/crates/mainframe-adapter-codex/src/plan_mode_handler.rs`,
`packages/core-rs/crates/mainframe-chat/src/lib.rs`

- The Codex module header claims the `PlanModeActionHandler`/`PlanActionContext` traits and the `Adapter` seam do
  not exist. Both now do. Rewrite the blocker to state the accurate remaining gap: the four action methods are an
  unported behavioral TODO, and `CodexAdapter` deliberately returns no trait handler until then.
- `lib.rs`: `plan_mode_actions` is no longer "an empty skeleton pending its per-file port" — fix that clause in the
  module doc.

**Verify:** `cargo check -p mainframe-adapter-codex -p mainframe-chat`; `rg -n "skeleton" packages/core-rs/crates/mainframe-chat/src/lib.rs` returns nothing about `plan_mode_actions`.

### T8 — Changeset

**Files (new):** `.changeset/<generated>.md`

`pnpm changeset` → patch on `@qlan-ro/mainframe-ui` and `@qlan-ro/mainframe-core` (the release pipeline reads
core's version for the daemon). One user-facing sentence: approving a plan now applies the chosen execution mode
and "clear context and implement" restarts the session with the plan.

**Verify:** the file exists and names both packages.

---

## Phase 2 — UI

### T9 — RED: the approved-plan record spec (group `ui-record-tests`)

**Files:** `packages/ui/src/features/chat/messages/__tests__/PlanBubble.test.tsx`

Rewrite against the target contract
`PlanBubble({ plan: string; executionMode?: ExecutionMode; clearedContext?: boolean })`:

1. `renders the plan markdown inside the resolved gate shell` — `chat-plan-bubble` present, contains
   `gate-head-tile`, and the shell carries the resolved border (`border-border`, no accent shadow style).
2. `shows the Plan eyebrow, the Implementing plan title and the Approved pill`.
3. `omits the execution-mode caption when no execution mode is passed` — `<PlanBubble plan="…" />`,
   `chat-plan-exec-mode` absent.
4. `renders the execution-mode caption from the executionMode prop` — `executionMode="acceptEdits"` →
   `chat-plan-exec-mode` reads `Auto-edits`.
5. `appends the cleared-context suffix only for the clear-context path` — `executionMode="acceptEdits"`
   `clearedContext` → `Auto-edits · context cleared`; with `clearedContext` but no `executionMode`,
   `chat-plan-exec-mode` stays absent.
6. `drops the user-message card treatment` — no `max-w-[530px]`, no `border-mf-um-edge`, no inline
   `--mf-um-card`/`--mf-shadow-user-card` style.

No `vi.mock` and no providers: every case renders `PlanBubble` bare with props only. Keep the suite header's
"Pure props component; no assistant-ui hooks or context needed" claim — it stays true, and T10 must not
break it (decision 7).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/PlanBubble.test.tsx`
— all 6 FAIL. Observe and record the failure before Phase 2's implementation task starts.

### T10 — Gate unmounts; the record becomes the single durable card (group `ui-plan-record`)

**Files:** `packages/ui/src/features/chat/gates/shared/GateShell.tsx`,
`packages/ui/src/features/chat/messages/PlanBubble.tsx`,
`packages/ui/src/features/chat/messages/UserMessage.tsx`,
`packages/ui/src/features/chat/tools/cards/PlanCard.tsx`,
`packages/ui/src/features/chat/gates/PlanGate.tsx`,
`packages/ui/src/features/chat/gates/PlanExecModeControl.tsx`,
`packages/ui/src/features/chat/gates/ChatGateMount.tsx`,
`packages/ui/src/features/chat/gates/__tests__/PlanGate.test.tsx`,
`packages/ui/src/features/chat/gates/__tests__/ChatGateMount.test.tsx`,
`packages/ui/src/features/chat/messages/__tests__/UserMessage.test.tsx`,
`packages/ui/src/features/chat/tools/cards/__tests__/PlanCard.test.tsx`

Load the `mainframe-design-system` skill first. Then:

1. `GateShell.tsx` — add an optional `subtitle?: ReactNode` to `GateHead`, rendered under the title inside the
   existing `flex-col` as `text-caption text-muted-foreground`. Additive; the other two gates pass nothing.
2. `PlanBubble.tsx` — rebuild on `<GateCardShell resolved>` + `<GateHead>`: tile `bg-mf-success-tint`, icon
   `<SquareCheck className="size-[12px] text-mf-success" />`, eyebrow `Plan`, title `Implementing plan`,
   `right` = the existing Approved pill, `subtitle` = the exec-mode caption. Body = the current hairline-divided
   markdown block on the shared `markdownComponents`. Delete `CARD_STYLE`, `max-w-[530px]`, `border-mf-um-edge`,
   `text-mf-um-ink`. Keep `data-testid="chat-plan-bubble"`. New props `executionMode?: ExecutionMode` (type-only
   import from `@qlan-ro/mainframe-types`) and `clearedContext?: boolean`. The component stays **hook-free**
   (decision 7). Caption: `executionMode` mapped through a module-level
   `{ default: 'Interactive', acceptEdits: 'Auto-edits', yolo: 'Unattended' }`, plus `' · context cleared'` when
   `clearedContext`; render nothing when `executionMode` is undefined. Testid `chat-plan-exec-mode`.
3. Both call sites thread the mode down from their own runtime read:
   - `UserMessage.tsx:240` —
     `<PlanBubble plan={planBody} clearedContext executionMode={chatExtras?.state.chatConfig?.permissionMode} />`
     (this call site *is* the clear-context path). `chatExtras` is the existing `useChatExtras()` at
     `UserMessage.tsx:120`; the read sits inside the `planBody` branch, so no non-plan render evaluates it.
   - `PlanCard.tsx` — add `const chatExtras = useChatExtras();` (from `../../runtime/use-chat-thread-runtime`)
     at the top of the component, **above** the approved-plan early return so hook order is stable, and render
     `<PlanBubble plan={approvedPlan} executionMode={chatExtras?.state.chatConfig?.permissionMode} />` — no
     `clearedContext`, this is the escalation path.
4. Fallout of the two new `useChatExtras()` readers. `useChatExtras` wraps `useAuiState`
   (`runtime/use-chat-thread-runtime.ts:218-221`) and throws `requires an AuiProvider` outside a runtime tree, so
   every provider-less suite reaching a new reader must mock the module:
   - `messages/__tests__/UserMessage.test.tsx:37-40` — the mock returns `{ retryMessage: retryMessageSpy }`, so
     `?.state.chatConfig` TypeErrors (optional chaining on `chatExtras` does not protect the `.state` hop).
     Change it to `{ retryMessage: retryMessageSpy, state: { chatConfig: null } }`, make `state` swappable from a
     `vi.hoisted` fixture reset in `beforeEach`, and extend the PB case (line ~517) with one assertion: with
     `chatConfig: { permissionMode: 'yolo' }`, `chat-plan-exec-mode` reads `Unattended · context cleared`.
   - `tools/cards/__tests__/PlanCard.test.tsx` — add
     `vi.mock('../../../runtime/use-chat-thread-runtime', () => ({ useChatExtras: () => ({ state: { chatConfig: { permissionMode: 'acceptEdits' } } }) }))`,
     assert `chat-plan-exec-mode` reads `Auto-edits` (no ` · context cleared`) in the approved-plan case at
     line ~232, and correct the header's "No external hook mocks needed" bullet to name this one mock and why.
   - No edit needed, and none is allowed, in `smart-actions/__tests__/instruction-chip.test.tsx:53,243`
     (renders `PlanBubble` bare under `TooltipProvider` — safe because `PlanBubble` stays hook-free) or in
     `messages/__tests__/UserMessage-send-failure.test.tsx` / `UserMessage.session-chip.test.tsx` (their mocks also
     omit `state`, but neither renders a plan-body message, so the guarded branch never runs). Say so in the T10
     hand-off so a later reader does not "fix" them.
5. `PlanGate.tsx` — delete the `approved` state, the `onApprove` prop and its doc comment, `EXEC_MODE_LABELS`, and
   the whole `chat-plan-running-footer` block; `ControlsPanel` and the action/revise rows render unconditionally.
   `handleApprove` becomes `void reply(buildPlanResponse(...))`.
6. `PlanExecModeControl.tsx` — add `aria-pressed={selected}` to the segmented-control button. The selected state
   is currently class-only, and T11's rewritten E2E test needs a non-class assertion for it (it also makes the
   toggle group announce correctly).
7. `ChatGateMount.tsx` — delete `approvedPlan`, `hasSeenRunningRef`, the `useEffect`, the `useAuiState`/`isRunning`
   read, the trailing `if (approvedPlan != null)` branch, and the retention paragraphs of the doc comment (leave a
   two-line comment: one gate at a time, dispatched by `toolName`; answered gates unmount because the daemon
   shifts the pending). Drop the now-unused `useState`/`useEffect`/`useRef`/`ChatPermissionEntry` imports.
8. `PlanGate.test.tsx` — remove the `chat-plan-running-footer` assertions (~230/243/255) and any `onApprove` prop
   usage; replace with `keeps the controls visible after approving (the gate is unmounted by the queue, not itself)`.
9. `ChatGateMount.test.tsx` — replace the retention block (~155-266) with `unmounts the plan gate once the queue
   front clears` and `still routes AskUserQuestion and permission gates by toolName`.

**Verify:** run each of the six touched specs individually via
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` — `PlanBubble.test.tsx` (T9's six now GREEN),
`PlanGate.test.tsx`, `ChatGateMount.test.tsx`, `UserMessage.test.tsx`, `PlanCard.test.tsx`, and
`smart-actions/__tests__/instruction-chip.test.tsx` (the one PlanBubble suite that must stay green *without* an
edit) — then `pnpm --filter @qlan-ro/mainframe-ui typecheck`.
`rg -n "chat-plan-running-footer|onApprove|approvedPlan" packages/ui/src` returns nothing; the repo-wide sweep for
the deleted testid is T11's (`packages/e2e` still references it until then).

---

## Phase 3 — E2E spec (group `e2e-plan-gate`)

### T11 — Retire the running-footer E2E assertions

**Files:** `packages/e2e/tests-tauri/gates.spec.ts`, `packages/e2e/tests-tauri/stress-matrix.spec.ts`

T10 deletes `chat-plan-running-footer`, and the design direction says its assertions go away rather than get
re-pointed. The live (non-skipped, its `test.skip` fires only at the end of the body) test
`selecting Unattended + clear-context and approving shows a matching running footer` (`gates.spec.ts:254`)
asserts that testid at line 267 and would fail.

1. `gates.spec.ts` — in the `§plan gate exec-mode` describe, rewrite that test as
   `selecting Unattended + clear-context marks both controls selected`: click
   `chat-plan-execmode-yolo`, expect `aria-pressed="true"` on it (T10 step 6) and `aria-pressed="false"` on
   `chat-plan-execmode-default`; click `chat-plan-clear-context`, expect `data-state="checked"` on it (Radix
   `Checkbox`). Delete the approve click, the three `footer` assertions (~267-270), the two stale history
   comment blocks (~242-266), and the trailing `test.skip(true, 'TODO(bug): …')`. Replace them with one line
   stating why the post-approve half is gone: under `E2E_MODE=mock` the chat runs on `mock-cli`, which exposes
   no plan-mode handler (T1), so an approval with `clearContext` never reaches `ClaudePlanModeHandler` — the
   post-approve surface is covered by `tool-cards.spec.ts:363-372` (escalation path) and T12's live run.
2. `gates.spec.ts:8` — the header sentence ends "…reflected in the post-approve running footer"; end it at the
   controls instead. `gates.spec.ts:23` — delete the `chat-plan-running-footer` testid-reference line.
3. `stress-matrix.spec.ts:13` — drop the `chat-plan-running-footer (known bug, gates.spec.ts:242)` clause from
   the "Deliberately NOT asserted" note, keeping the daemon-restart clause.

**Verify:** `rg -n "chat-plan-running-footer" .` returns nothing repo-wide (the check T10 could not make — its
grep was scoped to `packages/ui/src`). Then run the spec against an already-built bundle:
`E2E_MODE=mock MF_E2E_SKIP_BUILD=1 pnpm --filter @qlan-ro/mainframe-e2e exec playwright test tests-tauri/gates.spec.ts`
— the `§plan gate exec-mode` test passes and no test in the file is skipped for the plan gate. If no built
bundle is available, build first with `pnpm --filter @qlan-ro/mainframe-e2e build:app:tauri`; do not report the
task done on the grep alone.

---

## Phase 4 — live verification (group `live-verify`)

### T12 — Live Claude CLI run of both approval paths

**Files:** none expected (contingency below).

Run the desktop app against an isolated daemon (`MAINFRAME_DATA_DIR=~/.mainframe_dev DAEMON_PORT=31500`, per the
launch-isolation rule — never hijack `:31415`/`~/.mainframe`). With a real Claude CLI session:

1. Plan → **Approve & run** (no clear context): the composer's permission-mode control flips to the chosen mode
   from the `chat.updated` broadcast; the run continues; exactly one approved-plan record in the transcript; the
   gate is gone; `GET /api/chats/<id>/pending-permission` returns nothing.
2. Plan → **Approve & run** with clear context: the transcript clears, a new session starts, exactly one
   `Implement the following plan:` user turn appears rendered as the record, and the plan file shows in the
   Context tab. `pending-permission` returns nothing; no gate flicker at ~3s (the verify re-read).
3. **Reject** and **Keep planning** still behave as before.
4. Grep the daemon log and the CLI stderr for a duplicate-answer error on path 1 (the deliberate double
   `respond_to_permission`). **Contingency:** if the CLI errors or warns on the second answer, drop
   `ctx.session_respond_to_permission(response)` from `ClaudePlanModeHandler::on_approve`
   (`packages/core-rs/crates/mainframe-adapter-claude/src/plan_mode_handler.rs:33`) — the permission handler has
   already answered — and update T3's test 6 plus the handler's own test to expect a single answer. Record which
   branch was taken in the PR description.

**Verify:** all four checks pass, screenshots or log excerpts attached to the PR.

## Definition of done

`cargo test -p mainframe-chat -p mainframe-adapter-claude -p mainframe-server` green ·
`cargo clippy -p mainframe-chat -- -D warnings` clean · UI specs + `typecheck` green ·
`gates.spec.ts` green under `E2E_MODE=mock` and `rg -n "chat-plan-running-footer" .` empty repo-wide ·
no `TODO(port)` left on the plan-mode path · changeset present · T12's live checks recorded.
