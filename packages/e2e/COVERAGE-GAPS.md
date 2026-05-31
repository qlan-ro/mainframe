# e2e coverage gaps

_Last updated 2026-05-31. Companion to [`UNUSED-TESTIDS.md`](./UNUSED-TESTIDS.md) (the raw
auto-generated dump). This file triages those 164 unused test-ids into **why** each is uncovered and
**what** a covering test would look like, so the next pass can pick high-value work without
re-deriving the analysis._

## How to regenerate the raw list

```bash
node /tmp/testid-gap.mjs   # writes UNUSED-TESTIDS.md (source test-ids minus e2e references)
```

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

> **Unblock mechanism (in progress):** the mock-cli record/replay plugin (`plugins/mock-cli/`, see its
> `DESIGN.md`/`PLAN.md`) lets these specs run in CI with no API call. Enroll a spec by giving its
> `beforeAll` a `launchApp({ recordingKey })`, recording once with `E2E_MODE=record`, and committing
> the fixture; CI then runs it with `E2E_MODE=mock`. First proof target: `06-permissions` (Interactive).

These render only after Claude produces a plan, a question, tool calls, or a PR — or the control
itself dispatches a message to the agent. Coverable, but each adds a real API turn (cost +
nondeterminism) **unless recorded via mock-cli (above)**. **~40 ids.**

| Group | Ids | Trigger required |
|-------|-----|------------------|
| Plan approval | `chat-plan-approve-button`, `chat-plan-reject-button`, `chat-plan-revise-button`, `chat-plan-cancel-revise-button`, `chat-plan-send-feedback-button`, `chat-plan-feedback-input`, `chat-plan-exec-mode-select`, `chat-plan-clear-context-checkbox` | AI returns an ExitPlanMode plan |
| Ask-user-question | `chat-question-*` (back/next/skip/submit, option, option-other, other-input) | AI emits an AskUserQuestion turn |
| Permissions | `chat-permission-allow-once-button`, `chat-permission-always-allow-button`, `chat-permission-deny-button`, `chat-permission-details-toggle` | AI requests a tool permission (today covered via `getByRole`) |
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

## Summary

| Bucket | Count | Action |
|--------|-------|--------|
| Excluded (remote access) | ~10 | none |
| Blocked — AI-coupled | ~40 | opt-in `@ai` suite, future |
| Blocked — process-heavy (sandbox) | ~13 | needs runnable-app fixture, future |
| Actionable — deterministic | ~75 | specs `58`–`68` above |
| Not worth automating | ~4 | none |
| False positives (role/helper) | remainder | already covered |
