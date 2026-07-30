# Plan — Forward Claude's attention requests to Mainframe notifications (#293)

Spec: [`docs/specs/2026-07-30-todo-293-push-notification-tool.md`](../specs/2026-07-30-todo-293-push-notification-tool.md) (commit `c447a171`).
Branch: `todo/293-push-notification-tool`. All paths below are relative to the worktree root
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-293-push-notification-tool`.

## Goal

When a Claude session calls the CLI's `PushNotification` tool, the Rust daemon raises exactly one Mainframe
chat notification carrying the tool's message — marked unread in the sessions list, raised as a native OS
notification on every running desktop client (titled "Claude needs your attention"), and pushed to registered
mobile devices under the existing desktop-active suppression rule. The notification fires on the tool *call*,
ignores the tool result entirely, is suppressed by a new default-on `notifications.chat.attentionRequest`
setting, and is deduped at the source per session + exact message text within a 60-second window. The tool
call also renders as a normal tool card in the transcript. Task Complete and Session Error keep their current
behavior (no OS notification); the only contract change they see is a new optional `kind` discriminator on
the existing `chat.notification` event, which is what lets the client single out attention requests.

## Constraints from CLAUDE.md

- Max 300 lines/file, 50/function. `event_handler.rs` is already 2 021 lines — new logic goes in a new
  module, and only the sink method + trait wiring land in `event_handler.rs`.
- Zod/serde validation on every endpoint; new settings leaf must reject non-booleans with the `fail` envelope.
- Tests required for new core logic and routes. `data-testid` on every interactive element.
- No silent catches; no `console.*` in core; desktop fire-and-forget uses a tagged `console.warn`.
- The daemon event contract is co-owned with the `packages/mobile` submodule — the event change must be
  additive and optional. **Do not touch the submodule or bump its pointer.**
- A changeset is required on the branch.
- `packages/core` (the orphaned TS daemon) is deliberately **not** modified — see Decision P4.

## Touched files

| Area | Files |
| --- | --- |
| Shared TS types | `packages/types/src/settings.ts`, `packages/types/src/events.ts` |
| Rust settings | `packages/core-rs/crates/mainframe-types/src/settings.rs`, `packages/core-rs/crates/mainframe-services/src/notifications/notification_config.rs`, `packages/core-rs/crates/mainframe-server/src/routes/settings.rs`, `packages/core-rs/crates/mainframe-server/tests/routes_settings.rs` |
| Rust event contract | `packages/core-rs/crates/mainframe-types/src/events.rs`, `packages/core-rs/crates/mainframe-server/tests/ws_integration.rs` |
| Rust attention pipeline | `packages/core-rs/crates/mainframe-chat/src/attention_request.rs` (new), `packages/core-rs/crates/mainframe-chat/src/lib.rs`, `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`, `packages/core-rs/crates/mainframe-chat/src/event_handler/attention_tests.rs` (new), `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`, `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`, `packages/core-rs/crates/mainframe-chat/src/event_handler/permission_cancel_tests.rs`, `packages/core-rs/crates/mainframe-chat/src/event_handler/worktree_trigger_tests.rs`, `packages/core-rs/crates/mainframe-server/src/chat_deps.rs` |
| Claude adapter | `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`, `packages/core-rs/crates/mainframe-adapter-claude/src/assistant_event.rs`, `packages/core-rs/crates/mainframe-adapter-claude/src/events.rs` (RecordingSink test impl) |
| UI settings | `packages/ui/src/features/settings/panes/notifications/NotificationsPane.tsx`, `packages/ui/src/features/settings/panes/notifications/__tests__/NotificationsPane.test.tsx` |
| UI tool card | `packages/ui/src/features/chat/tools/cards/PushNotificationCard.tsx` (new), `packages/ui/src/features/chat/tools/register-cards.ts`, `packages/ui/src/features/chat/tools/cards/__tests__/PushNotificationCard.test.tsx` (new) |
| UI OS notification | `packages/ui/src/features/sessions/ws/session-list-router.ts`, `packages/ui/src/features/sessions/ws/use-session-list-router.ts`, `packages/ui/src/features/sessions/ws/__tests__/session-list-router.test.ts`, `packages/ui/src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`, `packages/ui/src/lib/tauri/bridge.ts`, `packages/app-tauri/src-tauri/capabilities/main.json` |
| Release | `.changeset/todo-293-attention-notifications.md` (new) |

## Plan-level decisions

- **P1 — Detection lives in `handle_assistant_event`, before the subagent early-return.** The scan runs on the
  raw `content` array *before* the session state lock is taken, so one code path covers both top-level and
  subagent blocks (spec edge case) and no sink call happens under the `ClaudeSession` mutex. History replay
  does not pass through this function (its only call site is the live stream dispatch at
  `mainframe-adapter-claude/src/events.rs:418`), so a resume cannot re-fire notifications.
- **P2 — Validation splits: the adapter extracts, the sink normalizes.** The adapter forwards
  `input.message` only when it is a string (`Value::as_str`); trimming, the empty check, truncation and
  dedupe all live in `mainframe-chat/src/attention_request.rs` so the rules exist in exactly one place.
- **P3 — Dedupe state lives on `EventHandler`, not on the per-session sink.** `build_sink` runs on every
  session start, so sink-local state would reset on resume. An `Arc<Mutex<AttentionDedupe>>` created in
  `EventHandler::new` and cloned into each sink is keyed by `(chat_id, body)` and survives resume.
- **P4 — `packages/core` (orphaned TS daemon) is not modified.** Its notification route merges stored config
  over `NOTIFICATION_DEFAULTS` by spread, so the new leaf propagates into its responses and its
  `settings-general` test keeps passing without edits. Its zod groups strip the unknown patch key, which is
  harmless in a daemon that no longer runs. Editing it would add churn to dead code.
- **P5 — No new tool-family color token.** The card reuses the existing semantic `--mf-warning` /
  `--mf-warning-tint` pair (the `EditFileCard` precedent) instead of adding a `--mf-tool-*` family across the
  four theme blocks in `globals.css`.
- **P6 — `ParentIdSink` (Codex) does not forward `on_attention_request`.** It is a Codex-only delegating
  wrapper and the spec declines any Codex equivalent; the trait's default no-op covers it.
- **P7 — The Tauri notification permission is requested on first use.** The capability set currently allows
  `notify` and `is-permission-granted` but not `request-permission`, so `sendNotification` would silently do
  nothing on a machine that never granted permission. Task 25 adds the capability and gates the send.

---

# Tasks

## Group A — shared TypeScript contracts

### Task 1 — `attentionRequest` in the shared notification config

- File: `packages/types/src/settings.ts`.
- Add `attentionRequest: boolean;` to `NotificationConfig['chat']` (after `sessionError`).
- Add `attentionRequest: true` to `NOTIFICATION_DEFAULTS.chat`.
- Verify: `pnpm --filter @qlan-ro/mainframe-types build` succeeds.

### Task 2 — optional `kind` discriminator on `chat.notification`

- File: `packages/types/src/events.ts`.
- Add `export type ChatNotificationKind = 'task_complete' | 'session_error' | 'attention_request';`.
- Add `kind?: ChatNotificationKind;` to the `{ type: 'chat.notification'; … }` member. Optional, never
  required — old daemons and the mobile client omit it.
- Confirm `ChatNotificationKind` is re-exported from `packages/types/src/index.ts` (add the export if the
  barrel enumerates names rather than `export *`).
- Verify: `pnpm --filter @qlan-ro/mainframe-types build`, then confirm the emitted declarations carry both
  additions: `grep -n "attentionRequest" packages/types/dist/settings.d.ts` and
  `grep -n "ChatNotificationKind" packages/types/dist/events.d.ts packages/types/dist/index.d.ts`.

### Task 3 — changeset

- File: `.changeset/todo-293-attention-notifications.md`.
- Bump `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-ui`, `@qlan-ro/mainframe-app-tauri` as `minor`.
- Body: one sentence in the spec's voice — "Claude's attention requests now raise a Mainframe notification,
  including a native desktop banner, with a new Chat setting to turn them off."
- Verify: `pnpm changeset status` runs without error.

## Group B — Rust settings leaf

### Task 4 — red: defaults JSON expects `attentionRequest`

- File: `packages/core-rs/crates/mainframe-types/src/settings.rs`.
- Update the inline test that asserts the exact serialized defaults string to expect
  `{"chat":{"taskComplete":true,"sessionError":true,"attentionRequest":true},…}` (keep field order aligned
  with the struct).
- Verify: `cargo test -p mainframe-types settings` fails on the expected string.

### Task 5 — green: `attention_request` on `NotificationChatConfig`

- Same file. Add `pub attention_request: bool` (serde camelCase is already applied at the container level)
  after `session_error`, and `attention_request: true` in `impl Default`.
- Verify: `cargo test -p mainframe-types settings` passes.

### Task 6 — salvage the new leaf when reading stored config

- File: `packages/core-rs/crates/mainframe-services/src/notifications/notification_config.rs`.
- First add tests to the inline `mod tests` (using the existing `FakeDb`): stored `attentionRequest: false`
  reads back `false`; a stored chat group with no `attentionRequest` key reads back `true` (AC13); a stored
  non-boolean `attentionRequest` falls back to the whole-group default, matching how the existing keys behave.
- Then extend `salvage_chat` to match `"attentionRequest"` alongside `"taskComplete"` / `"sessionError"`.
- Verify: `cargo test -p mainframe-services notification_config`.

### Task 7 — settings endpoint accepts the leaf

- Files: `packages/core-rs/crates/mainframe-server/src/routes/settings.rs`,
  `packages/core-rs/crates/mainframe-server/tests/routes_settings.rs`.
- Tests first, in `routes_settings.rs`: (a) `PUT` with body
  `{"notifications":{"chat":{"attentionRequest":false}}}` returns the `ok` envelope, leaves `taskComplete`
  and `sessionError` untouched, and a subsequent `GET` returns `attentionRequest: false` (AC11);
  (b) `PUT` with `{"notifications":{"chat":{"attentionRequest":"nope"}}}` returns the `fail` envelope with
  `400` and the stored config is byte-identical afterwards (AC12); (c) update any existing assertion that
  compares the full defaults object.
- Then add `attention_request: Option<bool>` to `ChatPartial` and merge it in `merge_notifications`
  alongside the existing leaves. `parse_notifications`/`put_general` need no other change — the existing
  body-parse failure path already produces the `fail` envelope.
- Verify: `cargo test -p mainframe-server --test routes_settings`.

## Group C — Rust attention pipeline

### Task 8 — `kind` on the chat-notification event

- Files: `packages/core-rs/crates/mainframe-types/src/events.rs`,
  `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`,
  `packages/core-rs/crates/mainframe-server/tests/ws_integration.rs`.
- Add `#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "snake_case")]
  pub enum ChatNotificationKind { TaskComplete, SessionError, AttentionRequest }`.
- Add `#[serde(default, skip_serializing_if = "Option::is_none")] kind: Option<ChatNotificationKind>` to the
  `ChatNotification` variant. Absent `kind` must not appear on the wire — the mobile client parses this event.
- Update the two existing emit sites in `event_handler.rs` (`Session Error` → `Some(SessionError)`,
  `Task Complete` → `Some(TaskComplete)`) and the construction site in `ws_integration.rs`.
- Add a serde test in `events.rs`: `kind: Some(AttentionRequest)` serializes to `"kind":"attention_request"`
  with camelCase siblings, and `kind: None` omits the field entirely.
- Verify: `cargo test -p mainframe-types events`, `cargo check -p mainframe-server --tests`.

### Task 9 — pure normalization + dedupe module

- Files: `packages/core-rs/crates/mainframe-chat/src/attention_request.rs` (new),
  `packages/core-rs/crates/mainframe-chat/src/lib.rs`,
  `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`.
- In `event_handler.rs`, extract the existing inline truncation inside `get_last_assistant_text` into
  `pub(crate) fn truncate_push_body(text: &str) -> String` (chars-based, `PUSH_BODY_MAX_LENGTH - 1` head plus
  `\u{2026}`) and call it from `get_last_assistant_text`. Behavior must not change.
- New module contents:
  - `pub const ATTENTION_DEDUPE_WINDOW: Duration = Duration::from_secs(60);`
  - `pub fn normalize_attention_body(raw: &str) -> Option<String>` — trim; return `None` when empty after
    trimming; otherwise `Some(truncate_push_body(trimmed))`.
  - `#[derive(Default)] pub struct AttentionDedupe { seen: HashMap<(String, String), Instant> }` with
    `pub fn admit(&mut self, chat_id: &str, body: &str, now: Instant) -> bool` — prunes entries older than
    the window, returns `false` when the same `(chat_id, body)` was admitted within the window, otherwise
    records `now` and returns `true`.
- Write the tests first, inline: empty / whitespace-only → `None`; a 250-char message truncates to 200 chars
  ending in `…`; a 200-char message is untouched; same text twice at `t` and `t + 59s` → one admit; at
  `t + 61s` → two; different texts back to back → two; same text in two chat ids → two (AC7, AC8).
- Register `pub mod attention_request;` in `lib.rs` (alphabetical position).
- Keep the file under 300 lines and every function under 50.
- Verify: `cargo test -p mainframe-chat attention_request`.

### Task 10 — `SessionSink::on_attention_request`

- File: `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`.
- Add `fn on_attention_request(&self, _message: &str) {}` with a doc comment: Claude's `PushNotification`
  tool call, forwarded raw; the sink owns trimming, truncation and dedupe. Default no-op — adapters whose
  CLI has no such tool need not implement it.
- Verify: `cargo check -p mainframe-adapter-api`.

### Task 11 — `notify_attention_request` on the deps traits

- Files: `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`,
  `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`,
  `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`,
  `packages/core-rs/crates/mainframe-chat/src/event_handler/permission_cancel_tests.rs`,
  `packages/core-rs/crates/mainframe-chat/src/event_handler/worktree_trigger_tests.rs`.
- Add `fn notify_attention_request(&self) -> bool;` (required, **not** defaulted — the file's own comment
  records that a defaulted trait method caused bug class #273) to `EventHandlerDeps` next to
  `notify_task_complete`, and to `ChatManagerDeps`.
- Implement the delegation in `EhDeps` (`chat_manager.rs:427`) and return `true` from the five test fakes:
  `FakeDeps` and `BgDeps` (`event_handler.rs`), `CancelDeps` (`permission_cancel_tests.rs`), `TriggerDeps`
  (`worktree_trigger_tests.rs`), `StoreDeps` (`chat_manager/tests.rs`).
- Verify: `cargo check -p mainframe-chat --tests`.

### Task 12 — the sink emits the notification

- File: `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`.
- Add `attention_dedupe: Arc<Mutex<AttentionDedupe>>` to `EventHandler` (created in `new`) and to
  `SessionSinkImpl` (cloned in `build_sink`).
- Implement `on_attention_request` on `SessionSinkImpl` in this exact order, and keep it under 50 lines:
  1. `let Some(body) = normalize_attention_body(message) else { return; };`
  2. `if !self.deps.notify_attention_request() { return; }` — no log line on this path (AC6).
  3. `if !dedupe.admit(&self.chat_id, &body, Instant::now()) { return; }`
  4. `self.deps.emit_event(DaemonEvent::ChatNotification { chat_id, title: "Claude needs your attention",
     body: body.clone(), level: ChatNotificationLevel::Success, kind: Some(ChatNotificationKind::AttentionRequest) })`
  5. `self.deps.send_push(PushOut { chat_id, title, body, push_type: "attention_request", priority: "high" })`
- Verify: `cargo check -p mainframe-chat`.

### Task 13 — sink tests

- File: `packages/core-rs/crates/mainframe-chat/src/event_handler/attention_tests.rs` (new) plus
  `#[cfg(test)] mod attention_tests;` in `event_handler.rs`.
- Mirror `permission_cancel_tests.rs`: a `AttentionDeps` fake recording `emit_event` + `send_push` calls and
  a settable `notify_attention_request` flag.
- Cases: one call with message `M` → exactly one `ChatNotification` with title
  "Claude needs your attention", body `M`, `kind: Some(AttentionRequest)`, and one `PushOut` with
  `push_type: "attention_request"`, `priority: "high"` (AC1, AC5); toggle off → zero events, zero pushes
  (AC6); the same message twice back to back → one event (AC7); empty / whitespace-only message → zero
  events (AC8); a 250-char message → body is 200 chars ending in `…` (AC1).
- Verify: `cargo test -p mainframe-chat attention`.

### Task 14 — daemon wiring for the setting

- File: `packages/core-rs/crates/mainframe-server/src/chat_deps.rs`.
- Implement `notify_attention_request` on `DaemonChatDeps` exactly like `notify_task_complete`:
  `self.db.call_blocking(|d| Ok(read_notification_config(d).chat.attention_request)).unwrap_or(true)`.
  Reading per call is what makes a mid-session toggle take effect on the next call.
- Verify: `cargo check -p mainframe-server`.

### Task 15 — Claude adapter detection

- Files: `packages/core-rs/crates/mainframe-adapter-claude/src/assistant_event.rs`,
  `packages/core-rs/crates/mainframe-adapter-claude/src/events.rs` (RecordingSink gains the method).
- In `handle_assistant_event`, immediately **before** `let mut guard = session.state.lock()`, scan
  `message.content` (when it is an array) for blocks with `type == "tool_use"` and
  `name == "PushNotification"`, and for each call `sink.on_attention_request(msg)` when
  `input.message` is a string (`Value::as_str`). Nothing else is read — `status` and every other input field
  are ignored (AC8). Placing the scan before the lock covers the subagent early-return path with the same
  code and takes no session lock across a sink call.
- Extract the loop into `fn scan_attention_requests(content: &[Value], sink: &dyn SessionSink)` to keep
  `handle_assistant_event` under 50 lines.
- Tests (in `events.rs`'s existing `RecordingSink` test module, or a sibling test module in the same crate):
  a stream event carrying the tool call records one `on_attention_request` with the exact message; a
  `parent_tool_use_id`-tagged (subagent) event records it too; a non-string / missing `message` records
  nothing and the event still reaches `on_message`; a stream with no such tool call records nothing (AC10).
- Verify: `cargo test -p mainframe-adapter-claude`.

### Task 16 — Rust gate

- Verify, from `packages/core-rs`: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo test -p mainframe-types -p mainframe-services -p mainframe-chat -p mainframe-adapter-claude -p mainframe-server`.

## Group D — settings toggle (UI)

### Task 17 — red: pane test for the new switch

- File: `packages/ui/src/features/settings/panes/notifications/__tests__/NotificationsPane.test.tsx`.
- Add cases: the Chat group renders `settings-notify-attention-request-toggle`, checked when the store holds
  the default config; clicking it calls `updateGeneralSettings` with exactly
  `{ notifications: { chat: { attentionRequest: false } } }` and writes the merged value to the store
  (AC11). Follow the existing mocking style in the file.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/settings/panes/notifications/__tests__/NotificationsPane.test.tsx` — new cases fail.

### Task 18 — green: the switch

- File: `packages/ui/src/features/settings/panes/notifications/NotificationsPane.tsx`.
- Add a third `ToggleRow` inside `<SettingGroup title="Chat">`, after Session Error:
  `label="When Claude asks for your attention"`,
  `description="Notify when Claude interrupts to ask for you"`,
  `checked={notifications.chat.attentionRequest}`, `onChange={(v) => patchChat('attentionRequest', v)}`,
  `testId="settings-notify-attention-request-toggle"`. No other change — `patchChat` is already generic.
- Verify: the same vitest command passes, plus `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

## Group E — transcript tool card (UI)

### Task 19 — red: card test

- File: `packages/ui/src/features/chat/tools/cards/__tests__/PushNotificationCard.test.tsx` (new).
- Use `makeToolPart` from `./_part-fixture`. Cases: renders the message from
  `args.message` in the card body; renders the result text byte-identical to the CLI's string when a result
  is present (AC9); renders without crashing when `args.message` is missing; `nestedVerticalScrollers(root)`
  is empty.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/tools/cards/__tests__/PushNotificationCard.test.tsx` — fails (module missing).

### Task 20 — green: `PushNotificationCard`

- File: `packages/ui/src/features/chat/tools/cards/PushNotificationCard.tsx` (new).
- Mirror `WebFetchCard.tsx`: `CollapsibleCardShell` + `FamilyTile` + `StatusDot` + `resolveResultText` +
  `ErrorBody` from `../shared`. Icon `BellIcon` (lucide), colors `var(--mf-warning)` /
  `var(--mf-warning-tint)` (decision P5). Verb "Notify"; target is the message, `truncate`d on one line in
  the header; body shows the message clamped at two lines (`line-clamp-2`) and, when present, the result
  text below it. `data-testid`s: `push-notification-card-root`, `push-notification-card-trigger`,
  `push-notification-card-message`.
- Load the `mainframe-design-system` skill before writing markup or class names.
- Verify: the same vitest command passes.

### Task 21 — register the card

- File: `packages/ui/src/features/chat/tools/register-cards.ts`.
- Import `PushNotificationCard` and add `PushNotification: PushNotificationCard` to the `Object.assign` block
  under a "standalone" comment. Do **not** add the tool to any hidden/progress category (D9).
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/tools` and
  `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

## Group F — OS notification (UI + shell)

### Task 22 — red: router test

- File: `packages/ui/src/features/sessions/ws/__tests__/session-list-router.test.ts`.
- Add cases: a `chat.notification` with `kind: 'attention_request'` calls the new `onOsNotify` dep with the
  event's title and body **and** calls `onMarkUnread`; a `chat.notification` with `kind: 'task_complete'`,
  with `kind: 'session_error'`, and with no `kind` at all calls `onMarkUnread` only (AC4).
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/session-list-router.test.ts` — new cases fail.

### Task 23 — green: route attention notifications

- File: `packages/ui/src/features/sessions/ws/session-list-router.ts`.
- Add `onOsNotify?: (title: string, body: string) => void;` to `SessionListRouterDeps` (documented: raised
  per client, deliberately not deduped here — the daemon deduped at the source, D8).
- In `case 'chat.notification'`, call `this.deps.onOsNotify?.(event.title, event.body)` when
  `event.kind === 'attention_request'`, then `onMarkUnread` as today. Unknown/absent `kind` keeps today's
  behavior.
- Update the module header comment to describe the new branch.
- Verify: the same vitest command passes.

### Task 24 — wire the router to the host bridge

- Files: `packages/ui/src/features/sessions/ws/use-session-list-router.ts`,
  `packages/ui/src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`.
- Pass `onOsNotify: (title, body) => { void getHost().notify(title, body).catch((err) =>
  console.warn('[sessions/useSessionListRouter] notify failed', err)); }` into `createSessionListRouter`
  (import `getHost` from `../../../lib/host`). It must sit **outside** the `activeChatIdsRef` guard used by
  `onMarkUnread` — the OS notification fires even when the user is looking at that session.
- Add a test asserting the host's `notify` is called for an attention notification on the *active* thread
  while `markUnread` is not.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`.

### Task 25 — permission-gated desktop notification

- Files: `packages/ui/src/lib/tauri/bridge.ts`,
  `packages/app-tauri/src-tauri/capabilities/main.json`.
- Add `"notification:allow-request-permission"` to the capability permissions list (decision P7).
- Rewrite `showNotification` to `isPermissionGranted()` → when false, `await requestPermission()` → send only
  when the result is `'granted'`; otherwise a single tagged `console.warn`. Import the two helpers from
  `@tauri-apps/plugin-notification` alongside `sendNotification`.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck` and, from `packages/app-tauri/src-tauri`,
  `cargo check`.

## Final verification

Run before handing the branch over:

1. `cd packages/core-rs && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
2. `pnpm --filter @qlan-ro/mainframe-types build`
3. `pnpm --filter @qlan-ro/mainframe-ui typecheck && pnpm --filter @qlan-ro/mainframe-ui test`
4. `pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit` (the orphaned TS daemon must still compile —
   decision P4 predicts no change is needed; if it fails, add the leaf to its zod groups rather than
   loosening the type)
5. `pnpm changeset status`
6. Manual smoke, one pass: launch the Tauri app against an isolated data dir
   (`MAINFRAME_DATA_DIR` + `DAEMON_PORT` set — never the defaults), run a Claude session that calls the tool,
   confirm the OS banner, the unread dot, and the transcript card; then flip the new toggle off and confirm
   a second call produces nothing.

## Risks

- **The OS permission prompt is first seen mid-session.** Task 25 requests it lazily, so the first attention
  request on a fresh install may be consumed by the prompt itself. Accepted: the alternative is prompting at
  boot for a feature the user may never hit.
- **`kind` reaches the mobile client.** It is optional and skipped when `None`, so an old mobile build
  ignores it. No submodule change is in scope.
- **`cargo clippy --workspace` is slow in a cold worktree.** Expect a multi-minute first run; do not set
  `CARGO_TARGET_DIR` to reuse another target dir (CLAUDE.md disk-hygiene rule).
