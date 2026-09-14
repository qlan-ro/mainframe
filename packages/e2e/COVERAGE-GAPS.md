# e2e coverage gaps

> **Stale as of 2026-08-11.** The buckets below were triaged on 2026-05-31 against the pre-v2 tree.
> `UNUSED-TESTIDS.md` was regenerated on 2026-08-11 and its id counts no longer match this file's.
> Re-triaging the refreshed inventory is separate work, not covered here.

_Companion to [`UNUSED-TESTIDS.md`](./UNUSED-TESTIDS.md) (the raw auto-generated dump — see that file
for the current unused-id count). This file triages those ids into **why** each is uncovered and
**what** a covering test would look like, so the next pass can pick high-value work without
re-deriving the analysis._

## How to regenerate the raw list

```bash
pnpm --filter @qlan-ro/mainframe-e2e run testids
```

`testids:check` verifies the committed `UNUSED-TESTIDS.md` and `COVERAGE-GAP-REPORT.md` are current.

## Methodology caveats

The raw count over-reports gaps. An "unused" test-id is one whose string never appears next to
`data-testid=`/`getByTestId` in a spec/fixture/helper. Two classes are **false positives**:

1. **Exercised via role/text, not test-id.** Permission and plan buttons are clicked with
   `getByRole('button', { name: /…/ })`. The behavior is tested; the selector just isn't the id.
2. **Passed as a bare string to a helper.** `openZone(page, 'zone-rail-button-files',
   'files-root-toggle')` exercises `files-root-toggle`, but the scanner only matches
   `data-testid="…"` literals, so the id reads as unused. Same for `files-refresh` and other
   `openZone` content args.

So treat the raw number as an upper bound. The buckets below are the real picture.

---

## 1. Excluded — remote access (per project decision)

Not to be automated in this suite. **10 ids.**

`named-tunnel-clear-config`, `named-tunnel-save`, `named-tunnel-toggle`, `named-tunnel-token-input`,
`named-tunnel-url-input`, `quick-tunnel-toggle`, `tunnel-recheck-verify`, `pairing-generate-code`,
`pairing-regenerate-code`, `remote-access-device-remove-${…}`.

---

## 2. Blocked — AI-coupled (needs a live agent turn)

> **Unblock mechanism (working):** the native Rust replay adapter
> (`packages/core-rs/crates/mainframe-adapter-mock`) runs committed NDJSON fixtures in CI with no
> API call. Enroll a spec by passing a stable `recordingKey` to `launchTauriApp`, then add the
> matching fixture under `fixtures/recordings`. Record mode was removed with the Node daemon;
> future capture tooling should tee the Rust `SessionSink`.

These render only after Claude produces a plan, a question, tool calls, or a PR — or the control
itself dispatches a message to the agent. Coverable, but each adds a real API turn (cost +
nondeterminism) **unless recorded via mock-cli (above)**. **~40 ids.**

| Group | Ids | Trigger required |
|-------|-----|------------------|
| Plan approval | `chat-plan-approve-button`, `chat-plan-reject-button`, `chat-plan-revise-button`, `chat-plan-cancel-revise-button`, `chat-plan-send-feedback-button`, `chat-plan-feedback-input`, `chat-plan-exec-mode-select`, `chat-plan-clear-context-checkbox` | AI returns an ExitPlanMode plan |
| Ask-user-question | `chat-question-*` (back/next/skip/submit, option, option-other, other-input) | AI emits an AskUserQuestion turn |
| Permissions | `chat-permission-option-{optionId}` (allow-once / allow-always / reject-once), `chat-permission-details-toggle` | AI requests a tool permission (today covered via `getByRole`) |
| Inline review → agent | `editor-inline-comment-send`, `editor-line-comment-send`, `editor-submit-review`, `line-comment-widget` | `sendCommentMessage` dispatches to the chat; the *send* path is AI-coupled (open/type/cancel is not — see §4) |
| Tool-result UI | `thread-tool-result-collapse`, `thread-tool-result-expand`, `thread-find-prev`, `message-part-thinking-toggle`, `tool-mcp-expand`, `tool-skill-expand`, `tool-schedule-expand`, `tool-task-group-toggle` | AI must invoke the matching tool / emit thinking |
| Subagents & bg tasks | `task-card`, `task-card-agent`, `task-card-model`, `bg-task-row-${…}`, `bg-task-kill-${…}`, `bg-task-recovered-${…}`, `chat-session-bar-bg-tasks-pill`, `chat-session-bar-bg-tasks-popover` | AI dispatches a Task / background task |
| PRs | `chat-pr-badges`, `chat-pr-open-${…}`, `pr-pill` | AI opens a PR |
| Composer in-flight | `composer-stop`, `composer-queued-edit`, `composer-queued-edit-input`, `composer-queued-save`, `composer-queued-cancel` | Requires an in-flight turn to stop/queue against |
| Lightbox | `chat-lightbox-close-button`, `chat-lightbox-next-button`, `chat-lightbox-prev-button` | AI message with ≥2 images (or attach + send) |

---

## 3. Blocked — process-heavy (needs a live sandbox/dev server)

The sandbox lifecycle controls require a project with a runnable launch config and an actually
running child process. Out of scope for the lightweight fixture today. **~10 ids.**

`sandbox-button-start`, `sandbox-button-stop`, `sandbox-button-stop-all`, `sandbox-button-restart`,
`sandbox-button-reload`, `sandbox-button-stop-process-${…}`, `sandbox-button-toggle-process-${…}`,
`sandbox-button-submit-captures`, `sandbox-capture-context`, `sandbox-textarea-annotation-${…}`,
`sandbox-button-remove-capture-${…}` (`sandbox-button-generate-with-agent` is also AI-coupled).
`capture-meta-row`, `capture-row-label` belong here too (populated by a capture session).

---

## 4. Actionable — deterministic specs worth adding (no AI)

These are reachable with fixture-only setup. Ordered roughly by value. Each row is a proposed spec.

| Proposed spec | Ids covered | Setup notes |
|---------------|-------------|-------------|
| `58-branch-popover` | `branch-list-local-toggle`, `branch-list-remote-toggle`, `branch-group-toggle-${…}`, `branch-submenu-dialog`, `branch-list-remote-row-${…}` | Open the branch popover; expand/collapse local & remote groups. `branch-popover-fetch/push/update-all` need a real remote → leave to a remote-enabled variant. |
| `59-new-branch-dialog` | `new-branch-dialog`, `new-branch-back`, `new-branch-cancel`, `new-branch-start-point-select`, `rename-branch-back`, `rename-branch-cancel` | Open new-branch + rename-branch dialogs from the branch UI; exercise start-point select; dismiss. (Verify branch *rename* doesn't use `window.prompt` — the tag rename did, see `50-tags`.) |
| `60-panel-crud` | `agents-item-menu-${…}`, `agents-item-edit-${…}`, `agents-item-delete-${…}`, `skills-item-menu-${…}`, `skills-item-edit-${…}`, `skills-item-delete-${…}` | Seed an agent + a skill on disk (like `46-skills-panel`), then open the row menu → edit/delete. |
| `61-todos-attachments` | `todos-attachments-upload`, `todos-attachments-file-input`, `todos-modal-upload`, `todos-modal-file-input`, `todos-modal-attachment-preview-${…}`, `todos-modal-attachment-remove-${…}`, `todos-attachment-preview-${…}`, `todos-attachment-delete-${…}`, `todos-quick-attachment-preview-${…}`, `todos-quick-attachment-remove-${…}` | `setInputFiles` a small PNG into the modal/quick file inputs; assert preview, then remove. |
| `62-todos-misc` | `todos-quick-body-input`, `todos-sidebar-item-${…}`, `todos-card-start-${…}`, `todos-modal-start-session`, `todos-filter-chip-${…}` | Extend `57`: fill quick body; click a milestone/label sidebar item; start-session from a card/modal (creates a chat — assert the chat exists, don't await AI). `todos-filter-chip` is the status/type quick-filter row. `todos-retry` only shows on a load error → skip. |
| `63-chats-panel` | `chats-clear-filters`, `chats-session-select-${…}`, `chats-project-new-session-${…}`, `chats-project-delete-${…}`, `project-group-parent` | Filter chats then clear; multi-select sessions; new-session from a project row; delete a project. |
| `64-worktree-section` | `worktree-pill`, `worktree-section-toggle-${…}`, `worktree-section-new-session-${…}`, `worktree-section-delete-${…}` | Build on `48-composer-worktree`: after a worktree exists, exercise its sidebar section toggle/new-session/delete and the pill. |
| `65-misc-controls` | `general-theme-option-${…}`, `model-dropdown-trigger`, `model-dropdown-option-${…}`, `review-button-mode-${…}`, `tags-button-filter-${…}`, `message-part-copy`, `message-part-copy-url`, `context-section-title`, `selector-breadcrumb`, `selector-crumb`, `toaster-dismiss-${…}`, `search-palette-session-${…}`, `changes-branch-file-${…}` | Grab-bag of single deterministic interactions: theme switch (extend `41-settings`), model dropdown, review-modal mode toggle (extend `10`), filter sessions by tag (extend `50`), copy a user message, context tab title, directory-picker breadcrumb nav (extend `54`), dismiss a toast, search-palette result click, branch-mode changed file (extend `12`). |
| `66-settings-providers` | `providers-${…}`, `settings-modal-sidebar-provider-${…}` | Open settings → providers sidebar section. |
| `67-conflict-resolution` | `conflict-view-dialog`, `conflict-view-abort` | Construct a real merge conflict via git in the fixture project, trigger the conflict view, abort. Higher setup cost. |
| `68-external-session` | `external-session-branch`, `external-session-worktree`, `sessions-attachment-${…}` | Import an external session (partially explored already); assert branch/worktree metadata. |

### Not worth automating
- `status-bar-update-download`, `status-bar-update-install` — need a real app-update event.
- `error-boundary-retry` — needs an induced render crash.
- `connection-overlay` — only on daemon disconnect; could kill the daemon mid-test but flaky.
- `todos-retry` — only on a todos load failure.

---

## 5. Blocked — the behavior does not exist under `E2E_MODE=mock`

Four of the six e2e scenarios the PR #688 fix plan
(`docs/plans/2026-09-14-pr-688-review-fixes-plan.md`, Verification step 7) asks for are not
reachable from this suite. Not "hard to set up" — the code path that produces the behavior is
never entered when the chat runs on `mock-cli`, or the fixture has no second daemon to switch
to. A spec written anyway would pass against a broken implementation, so each one is pinned by
a unit test instead. The other two scenarios ARE covered:
`tests-tauri/facade-protocol-partial.spec.ts` (no ghost bubble after a retry) and
`tests-tauri/facade-reconnect-mid-stream.spec.ts` (a mid-turn reconnect resumes running).

### 5.1 Plan-mode clear context empties the transcript and it stays empty

**Why unreachable.** The wipe is an adapter concern. `ChatPlanMode::handle_clear_context`
resolves a handler through `Adapter::create_plan_mode_handler`, whose trait default is `None`;
only `ClaudeAdapter` overrides it. `mock-cli` therefore takes the `warn!("no plan-mode handler
for adapter")` branch, so `clear_messages` / `notify_transcript_cleared` never run and the
daemon never pushes `_mainframe.dev/transcript_cleared` — the only signal the client wipes on
(`acp-session-attachment.ts`). Ticking `chat-plan-clear-context` in mock mode is observable
only as a checkbox state, which is what `gates.spec.ts`'s "§plan gate exec-mode" already
asserts and why its comment says the approval "never reaches `ClaudePlanModeHandler`".

**Pinned by.**
- daemon half — `packages/core-rs/crates/mainframe-adapter-claude/src/plan_mode_handler.rs::on_approve_and_clear_context_kills_resets_clears_and_starts`
- client half — `packages/ui/src/features/chat/controller/__tests__/acp-session-plane.test.ts::"dispatches transcript.cleared and re-resumes from the start"`

**What a covering fixture would need.** `mock-cli` would have to implement
`create_plan_mode_handler` with a replay-safe `on_approve_and_clear_context` that clears the
message cache and calls `notify_transcript_cleared`.

### 5.2 A prompt queued behind a running turn appears last and stays last after the dequeue

**Why unreachable.** Nothing is ever queued in mock mode. `queued_message_metadata`
(`chat_manager/send_queue.rs`) sets `is_queued` only when `session.supports_replay_ack()` is
true; the trait default in `mainframe-adapter-api/src/adapter.rs` is `false` and only
`ClaudeSession` overrides it. So a mid-turn prompt on `mock-cli` gets no `queued` metadata, no
`queuedRefs` entry, and its user message is encoded straight into the transcript at the tail —
the encoder's D1 drop (`encoder.rs::is_queued`) never fires. Verified on the wire: every
`_mainframe.dev/queue_state` this suite can produce carries `refs: []`. (The
`criteria 3 + 5` comment in `tests-tauri/facade-protocol-streaming.spec.ts` overstates this —
the mid-turn prompt makes the notification appear, but it snapshots an empty list.)

**Pinned by.**
- encoder half — `packages/core-rs/crates/mainframe-acp/src/encoder/tests.rs::queued_messages_are_not_encoded_as_items`
- client half — `packages/ui/src/features/chat/controller/__tests__/chat-thread-state-queued.test.ts::"replaces stale queued entries with only the snapshot refs"`

**What a covering fixture would need.** `mock-cli` would have to override
`supports_replay_ack()` to `true` and hold a turn's output until the recording's
`onQueuedProcessed` marker, so a second `sendMessage` really sits in `queuedRefs` while the
first turn replays.

### 5.3 A Codex gate answered with "Always allow" does not re-prompt on the next turn

**Why unreachable.** The session-scoped accept lives in the Codex adapter's approval handler
(`ApprovalHandler::handle_request`, `acceptForSession`), which mock mode never runs — `mock-cli`
replays `onPermission` positionally and has no approval policy at all, so "does not re-prompt"
has nothing to suppress.

**Pinned by.** `packages/core-rs/crates/mainframe-adapter-codex/tests/approval_handler.rs::accept_for_session_reaches_codex`

**What a covering fixture would need.** A live `codex` binary, i.e. the excluded real-adapter
suite, not a recording.

### 5.4 Switching daemons routes the next prompt to the new daemon

**Why unreachable.** `fixtures/daemon.ts` runs exactly one daemon on one port
(`assertPortFree` exists to guarantee that), and the renderer bakes that port at build time
(`VITE_DAEMON_PORT`, checked by `global-setup.ts::assertBundleTargetsTestPort`). With no second
daemon there is no switch to observe.

**Pinned by.** `packages/ui/src/lib/daemon/__tests__/dispose-daemon-session.test.ts::"a daemon switch drops the cached facade clients — even a switch that lands back on the same daemon id (R1.1)"`

**What a covering fixture would need.** A second `startDaemon` on its own port and data dir,
plus a renderer bundle that resolves the daemon URL at runtime instead of baking one port — the
`assertBundleTargetsTestPort` guard is a hard blocker until that resolution moves out of build
time.


---

## Summary

| Bucket | Count | Action |
|--------|-------|--------|
| Excluded (remote access) | ~10 | none |
| Blocked — AI-coupled | ~40 | opt-in `@ai` suite, future |
| Blocked — process-heavy (sandbox) | ~13 | needs runnable-app fixture, future |
| Actionable — deterministic | ~75 | specs `58`–`68` above |
| Not worth automating | ~4 | none |
| Blocked — absent under `E2E_MODE=mock` | 4 scenarios | pinned by unit tests, see §5 |
| False positives (role/helper) | remainder | already covered |
