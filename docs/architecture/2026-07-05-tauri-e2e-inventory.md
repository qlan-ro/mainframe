# app-tauri E2E Test Inventory + data-testid Coverage

Generated 2026-07-05 against commit `47ee674d`.

Built by parsing `packages/e2e/tests-tauri/*.spec.ts` with the TypeScript
compiler API (AST-level `test.describe`/`test`/`test.skip` extraction, not
regex-on-lines) and cross-referencing against a `data-testid=` grep of
`packages/ui/src`. The parsing script was throwaway (`/tmp/e2e-inv/*.js`, not
committed); this document is the hand-reviewed output.

## Changes since previous inventory (48cbfecc)

This is a regeneration against the current branch tip, after a bug-fix +
re-unskip campaign (commits `ce7bc74c`..`47ee674d`, 13 commits) landed on top
of the previous snapshot. Total test count is unchanged (no specs were added or
removed); the shift is entirely in the active/skip split, plus refined skip
reasons on a few tests that are still blocked pending further investigation:

| | previous (48cbfecc) | current (47ee674d) | delta |
|---|---|---|---|
| Total tests | 422 | 422 | — |
| Active | 345 | 364 | +19 |
| Skipped | 77 | 58 | −19 |
| Describe blocks | 112 | 112 | — |

Per-file skip→active moves:

- `git-branch.spec.ts`: 2 active / 12 skip → **14 active / 0 skip** — the
  whole file's `git-branch-popover` positioning bug (Hint-wraps-trigger fix,
  commit `ce7bc74c`) was the single root cause blocking it; now fully
  unskipped.
- `composer-advanced.spec.ts`: 5/15 → **8/12** — the mention/skill
  trigger-popover-reopen bug (commit `f1666315`) fixed 3 of the composer
  trigger tests; the remaining 12 skips are unrelated (browser-crash cluster,
  selection-toolbar investigation, quote-composer-only question).
- `run-surface.spec.ts`: 8/4 → **11/1** — the launch-refetch/stop-start-flip
  fix (commit `81a5c49c`) unblocked 3 tests; one (echo-once buffered console
  output via the add-menu launch path) is still open, reason refined to note
  the round-2 refetch fix didn't cover that path.
- `sessions-draft.spec.ts`: 9/1 → **10/0** — the draft-discard-with-pill-active
  fix (commit `3368d065`) closed the file's last skip.
- `editor-diff.spec.ts`, `gates.spec.ts`, `sessions-tags.spec.ts`: active/skip
  counts unchanged, but the underlying root-cause comments were refined during
  the campaign (diff chunk nav now diagnosed as a horizontal-scroll-into-view
  bug rather than a clipping bug; the plan-gate exec-mode skip now points at
  the mock-session respawn timing; the tag-popover context-menu skip now notes
  the `setTimeout(0)` defer from `3368d065` didn't close the race).

Part 2 (data-testid coverage) numbers are unchanged (714 / 528 / 186 / 73.9%)
except two reference counts that shifted as a side effect of the
`gates.spec.ts` refinement above (the plan gate exec-mode test's testid list
dropped `chat-permission-deny`/`chat-permission-gate` in favor of the plan-only
testids it now actually exercises): `chat-permission-gate` 14 → 13 and
`chat-permission-deny` 11 → 10.

## Methodology & known caveats

- **Test inventory (Part 1):** every `test(...)` / `test.skip(...)` call
  nested under a `test.describe(...)` block across all 33 spec files —
  422 tests total (364 active, 58 skipped) in 112 describe blocks. Skip
  detection covers both the whole-test `test.skip('title', fn)` form (reason
  taken from the in-body comment, since Playwright's own skip modifier
  carries no reason argument) and the conditional `test.skip(true, 'reason')`
  form used inside an otherwise-normal `test(...)` block, including cases
  where the reason is a `const` string variable declared nearby (resolved by
  name) rather than an inline literal.
- **Description column:** reused from the test title (capitalized, trailing
  period added). Titles in this suite are already written as precise
  behavior assertions (e.g. *"review button is disabled without a
  worktree"*), confirmed by spot-reading `chat-header`, `settings`,
  `sessions-rows`, `daemon-picker`, `git-branch`, `run-surface`, and
  `transcript` specs in full. Leading in-file comments were tried as an
  alternative source but often turned out to be mid-paragraph fragments once
  isolated from surrounding context (they read worse than the title alone) —
  skipped for that reason. Read the `.spec.ts` file directly for the fuller
  rationale behind a given scenario (many carry multi-line root-cause
  comments, especially around skipped tests).
- **data-testid extraction (per test):** `getByTestId('x')` /
  `getByTestId(\`template-${expr}\`)` (interpolations collapsed to `*`,
  preserving any static suffix), `T.xxx` helper refs (resolved against
  `packages/e2e/helpers/tauri/testids.ts`), `[data-testid="x"]` and
  `[data-testid^="prefix-"]` locator strings, and `data-chat-id` references.
  Three helper factories in `page-objects.ts` (`sessionsSidebar`, `composer`,
  `chatThread`) wrap testids behind method calls (e.g.
  `sessionsSidebar(page).row(chatId)` → `sessions-row` + `data-chat-id`) —
  these are resolved via a small static map verified against that file's
  current 48 lines, not full type-checking, so a future edit to
  `page-objects.ts` would need the map updated by hand. A handful of tests
  (3, all in `context-panel.spec.ts` / `sidebar-chrome.spec.ts`) genuinely
  reference no testid — they assert on text content or a bounding box
  computed by a locally-defined spec helper.
- **UI testid universe (Part 2):** `grep data-testid=` across
  `packages/ui/src/**/*.{ts,tsx}`, excluding `__tests__/` (stub testids in
  unit-test mocks aren't real component surface). Templated testids
  (`data-testid={\`prefix-${id}\`}`) are recorded as a `prefix-*` pattern;
  ternary/branching literals (`data-testid={cond ? 'a' : 'b'}`) register both
  branches. Coverage counting matches a source testid/pattern against a
  test's testid list via wildcard equivalence (`*` treated as `.*`), counting
  **distinct tests**, not occurrences.
  - **Excluded as unresolvable (35 sites):** bare prop-forwarded testids
    (`data-testid={testId}` on passthrough primitives like
    `components/ui/hint.tsx`, `read-more.tsx`, `command.tsx`) and fully
    parameterized templates with no static anchor at all (e.g.
    `` `${prefix}-${opt.id}` `` in `AppearanceControls.tsx`) — these can't be
    resolved to a literal without tracing every call site, so they're
    reported as a count, not enumerated as fake universe entries.
  - **Passthrough inflation caveat:** patterns like `*-cancel` / `*-confirm`
    (from `confirm-dialog.tsx`) or `*-option-*` (from
    `CodexTuningDefaults.tsx`) do have a static anchor and are kept, but the
    wildcard portion is an entire caller-supplied prefix — treat their
    reference counts as "this shape of ID is exercised somewhere," not "this
    specific dialog instance is covered."
  - **Dynamic/prop-forwarded exclusions are not in the 714-entry universe** —
    they're reported only as a summary count.


# Part 1 — Test Inventory

## chat-header.spec.ts

### §chat-header — model chip + context meter

| Test | Status | Description | data-testids |
|---|---|---|---|
| model chip renders once chat config loads, before any turn | active | Model chip renders once chat config loads, before any turn. | `chat-header-context`, `chat-header-model` |
| context meter and percentage appear after a turn, with a positive percentage | active | Context meter and percentage appear after a turn, with a positive percentage. | `chat-header-context`, `chat-header-context-pct` |

### §chat-header — review button (worktree gate)

| Test | Status | Description | data-testids |
|---|---|---|---|
| review button is disabled without a worktree | active | Review button is disabled without a worktree. | `chat-header-review` |
| enabling a worktree enables the review button; clicking it opens the review modal | active | Enabling a worktree enables the review button; clicking it opens the review modal. | `chat-header-review`, `review-modal` |

### §chat-header — hide-chat control (dynamic floor)

| Test | Status | Description | data-testids |
|---|---|---|---|
| disabled while Chat is the only lit surface | active | Disabled while Chat is the only lit surface. | `chat-header-hide` |
| enabled once Files is lit (⌘/Ctrl+2), and hides the chat surface when clicked | active | Enabled once Files is lit (⌘/Ctrl+2), and hides the chat surface when clicked. | `chat-header`, `chat-header-hide`, `files-surface` |

### §chat-header — split controls

| Test | Status | Description | data-testids |
|---|---|---|---|
| split-right lights a second surface beside Chat in the top row | active | Split-right lights a second surface beside Chat in the top row. | `chat-header-split-right`, `files-surface` |
| split-down lights a third surface into the bottom strip | active | Split-down lights a third surface into the bottom strip. | `chat-header-split-down`, `run-surface` |

### §chat-header — PR link chips

| Test | Status | Description | data-testids |
|---|---|---|---|
| PR chip renders for a chat with a detected PR | skip — TODO(recording): chat-header-pr-<number> is driven by custom.detectedPrs, which is only populated by the daemon's PR-detection background service (reading... | PR chip renders for a chat with a detected PR. | — |

## chat.spec.ts

### §messaging

| Test | Status | Description | data-testids |
|---|---|---|---|
| sends a message and receives a text response | active | Sends a message and receives a text response. | `chat-assistant-message` |
| turn footer shows token count after response | skip — TODO(app-tauri): no turn-footer token-count testid exists in app-tauri | Turn footer shows token count after response. | — |
| AI can invoke a bash tool to list files | active | AI can invoke a bash tool to list files. | `chat-bash-card` |

### §permissions interactive

| Test | Status | Description | data-testids |
|---|---|---|---|
| shows permission gate for a file creation request | active | Shows permission gate for a file creation request. | `chat-permission-gate` |
| Deny dismisses the gate and AI becomes idle | active | Deny dismisses the gate and AI becomes idle. | `chat-permission-deny`, `chat-thread-running` |
| Allow Once permits the tool; next identical request shows the gate again | active | Allow Once permits the tool; next identical request shows the gate again. | `chat-permission-allow-once`, `chat-permission-deny`, `chat-permission-gate` |

### §permissions auto-edits (live only)

| Test | Status | Description | data-testids |
|---|---|---|---|
| file edits proceed without a gate (live only) | skip — TODO(app-tauri): live-only test, no recording; | File edits proceed without a gate (live only). | — |

### §permissions yolo (live only)

| Test | Status | Description | data-testids |
|---|---|---|---|
| all tool permissions auto-approved in Yolo mode (live only) | skip — TODO(app-tauri): live-only test, no recording; | All tool permissions auto-approved in Yolo mode (live only). | — |

### §plan approval

| Test | Status | Description | data-testids |
|---|---|---|---|
| plan gate appears and can be approved → permission gate → always allow → idle | active | Plan gate appears and can be approved → permission gate → always allow → idle. | `chat-permission-always-allow`, `chat-permission-gate`, `chat-plan-approve`, `chat-plan-gate` |
| plan revision: keep-planning opens feedback input, send-feedback triggers a new plan gate | active | Plan revision: keep-planning opens feedback input, send-feedback triggers a new plan gate. | `chat-plan-feedback-input`, `chat-plan-gate`, `chat-plan-keep-planning`, `chat-plan-reject`, `chat-plan-send-feedback` |

### §ask-question

| Test | Status | Description | data-testids |
|---|---|---|---|
| question gate renders; submit disabled until option chosen; submit enabled after choice; submits | active | Question gate renders; submit disabled until option chosen; submit enabled after choice; submits. | `chat-question-gate`, `chat-question-option-0-*`, `chat-question-submit` |

## composer-advanced.spec.ts

### §composer mention trigger (@)

| Test | Status | Description | data-testids |
|---|---|---|---|
| typing @ opens the file mention popover and lists a known project file | active | Typing @ opens the file mention popover and lists a known project file. | `chat-composer-input`, `composer-file-item-index.ts` |
| picking a file inserts the mention token and closes the popover | active | Picking a file inserts the mention token and closes the popover. | `chat-composer-input`, `composer-file-item-index.ts`, `composer-trigger-popover` |
| picking a directory keeps the token open for drill-down | active | Picking a directory keeps the token open for drill-down. | `chat-composer-input`, `composer-file-item-notes`, `composer-file-item-notes/todo.md` |
| Escape closes the trigger popover without clearing the typed text | active | Escape closes the trigger popover without clearing the typed text. | `chat-composer-input`, `composer-file-item-index.ts`, `composer-trigger-popover` |
| the add-mention toolbar button appends @ to the composer text | skip — TODO(bug): composer text unexpectedly empties in this describe — see comment above | The add-mention toolbar button appends @ to the composer text. | `chat-composer-input`, `composer-add-mention` |
| a typed mention renders as its own colored node in the highlight overlay | active | A typed mention renders as its own colored node in the highlight overlay. | `chat-composer-input`, `composer-prompt-highlight` |

### §composer skill trigger (/)

| Test | Status | Description | data-testids |
|---|---|---|---|
| typing / lists the project skill; picking it inserts the literal /skill token | active | Typing / lists the project skill; picking it inserts the literal /skill token. | `chat-composer-input`, `composer-skill-item-greet-user`, `composer-trigger-popover` |

### §composer quote + worktree mid-session warning

| Test | Status | Description | data-testids |
|---|---|---|---|
| selecting assistant text shows the floating Quote button | skip — TODO(investigate): chat-selection-toolbar never appears after programmatic selection + synthetic mouseup — needs live-instrumented repro | Selecting assistant text shows the floating Quote button. | `chat-assistant-message`, `chat-selection-quote`, `chat-selection-toolbar` |
| clicking Quote adds a quote preview pill above the composer | skip — TODO(investigate): depends on the skipped selection-toolbar test above | Clicking Quote adds a quote preview pill above the composer. | `chat-selection-quote`, `composer-quote-preview` |
| dismissing the quote preview clears it | skip — TODO(investigate): depends on the skipped selection-toolbar test above | Dismissing the quote preview clears it. | `composer-quote-dismiss`, `composer-quote-preview` |
| a sent message with an active quote renders a quote block | skip — wired (or drop if the design deliberately keeps quoting composer-only). | A sent message with an active quote renders a quote block. | — |
| worktree popover shows a mid-session warning once the chat has messages | active | Worktree popover shows a mid-session warning once the chat has messages. | `composer-worktree-cancel`, `composer-worktree-mid-session-warning`, `composer-worktree-popover`, `composer-worktree-tab-new`, `composer-worktree-trigger` |

### §composer worktree setup

| Test | Status | Description | data-testids |
|---|---|---|---|
| New tab shows the current base branch; invalid branch names disable Enable | active | New tab shows the current base branch; invalid branch names disable Enable. | `composer-worktree-base-branch`, `composer-worktree-branch-name`, `composer-worktree-cancel`, `composer-worktree-enable`, `composer-worktree-popover`, `composer-worktree-trigger` |
| Existing tab lists the pre-existing project worktree | skip — TODO(bug/infra): browser-crash cluster — see comment above the describe | Existing tab lists the pre-existing project worktree. | `composer-worktree-attach-*`, `composer-worktree-cancel`, `composer-worktree-popover`, `composer-worktree-tab-existing`, `composer-worktree-tab-new`, `composer-worktree-trigger` |
| Enable creates a new worktree; reopening shows the active-info readout | skip — TODO(bug/infra): browser-crash cluster — see comment above the describe | Enable creates a new worktree; reopening shows the active-info readout. | `composer-worktree-active-info`, `composer-worktree-branch-name`, `composer-worktree-enable`, `composer-worktree-popover`, `composer-worktree-tab-new`, `composer-worktree-trigger` |

### §composer queue

| Test | Status | Description | data-testids |
|---|---|---|---|
| sending a message while the run is active queues it at the thread tail | skip — TODO(bug/infra): browser-crash cluster — see comment above the §composer worktree setup describe | Sending a message while the run is active queues it at the thread tail. | `chat-composer-input`, `chat-permission-gate`, `chat-queued-message` |
| hover Edit swaps the composer into edit mode; Esc cancels without changes | skip — TODO(bug/infra): browser-crash cluster — see comment above the §composer worktree setup describe | Hover Edit swaps the composer into edit mode; Esc cancels without changes. | `chat-composer`, `chat-composer-edit`, `chat-composer-edit-input`, `chat-queued-edit`, `chat-queued-message` |
| editing a queued message and saving (Ctrl/⌘+Enter) updates its content | skip — TODO(bug/infra): browser-crash cluster — see comment above the §composer worktree setup describe | Editing a queued message and saving (Ctrl/⌘+Enter) updates its content. | `chat-composer-edit`, `chat-composer-edit-input`, `chat-queued-edit`, `chat-queued-message` |
| a second queued message gets FIFO position 2; Cancel removes it | skip — TODO(bug/infra): browser-crash cluster — see comment above the §composer worktree setup describe | A second queued message gets FIFO position 2; Cancel removes it. | `chat-composer-input`, `chat-queued-cancel`, `chat-queued-message` |
| the queued message is consumed by the CLI once the run ends | skip — TODO(bug/infra): browser-crash cluster — see comment above the §composer worktree setup describe | The queued message is consumed by the CLI once the run ends. | `chat-permission-deny`, `chat-permission-gate`, `chat-queued-message`, `chat-user-message` |

## composer.spec.ts

### §composer config selects

| Test | Status | Description | data-testids |
|---|---|---|---|
| M5: model select opens, lists models, and closes on pick | active | M5: model select opens, lists models, and closes on pick. | `composer-model-select`, `composer-model-select-option-*` |
| M7: permission-mode select switches to Unattended (yolo) | active | M7: permission-mode select switches to Unattended (yolo). | `composer-permission-mode-select`, `composer-permission-mode-select-option-default`, `composer-permission-mode-select-option-yolo` |
| M4: provider row is present and unlocked before the first message | active | M4: provider row is present and unlocked before the first message. | `composer-adapter-select-option-*`, `composer-model-select`, `composer-provider-footer` |
| M6: effort select shows dynamic levels for a capable model | skip — no effort-capable model found in this environment | M6: effort select shows dynamic levels for a capable model. | `composer-effort-select`, `composer-effort-select-option-high`, `composer-effort-select-option-low`, `composer-model-select`, `composer-model-select-option-claude-opus-4-5-20251001`, `composer-model-select-option-claude-sonnet-4-5-20251101`, `composer-model-select-option-opus`, `composer-model-select-option-sonnet` |
| M6b: effort select for opus-level model includes xhigh and max options | skip — no opus-level model found in this environment | M6b: effort select for opus-level model includes xhigh and max options. | `composer-effort-select`, `composer-effort-select-option-max`, `composer-effort-select-option-xhigh`, `composer-model-select`, `composer-model-select-option-claude-opus-4-5-20251001`, `composer-model-select-option-opus` |
| M6c: haiku model hides the effort select and features trigger | skip — haiku model not found in this environment | M6c: haiku model hides the effort select and features trigger. | `composer-effort-select`, `composer-features-trigger`, `composer-model-select`, `composer-model-select-option-claude-haiku-4-5-20251001`, `composer-model-select-option-haiku` |
| M6d: features popover appears for a capable model and toggles work | skip — no opus-level model found in this environment | M6d: features popover appears for a capable model and toggles work. | `composer-feature-adaptiveThinking`, `composer-feature-fast`, `composer-feature-ultracode`, `composer-features-trigger`, `composer-model-select`, `composer-model-select-option-claude-opus-4-5-20251001`, `composer-model-select-option-opus` |
| M6e: enabling ultracode locks the effort chip to xhigh | skip — no opus-level model found in this environment | M6e: enabling ultracode locks the effort chip to xhigh. | `composer-effort-select`, `composer-feature-ultracode`, `composer-features-trigger`, `composer-model-select`, `composer-model-select-option-claude-opus-4-5-20251001`, `composer-model-select-option-opus` |
| M5b: sonnet-level model shows effort but NOT xhigh option | skip — no sonnet-level model found in this environment | M5b: sonnet-level model shows effort but NOT xhigh option. | `composer-effort-select`, `composer-effort-select-option-max`, `composer-effort-select-option-xhigh`, `composer-model-select`, `composer-model-select-option-claude-sonnet-4-5-20251101`, `composer-model-select-option-sonnet` |

### §composer attachments

| Test | Status | Description | data-testids |
|---|---|---|---|
| attaching an image shows thumbnail in composer | active | Attaching an image shows thumbnail in composer. | `composer-add-attachment`, `composer-attachment-tile` |
| removing attachment clears it from composer | active | Removing attachment clears it from composer. | `composer-attachment-remove`, `composer-attachment-tile` |
| sending a message with attachment gets AI response | skip — TODO(app-tauri): in-message image thumbnail (message-image-thumb) + AI attachment flow not verified yet | Sending a message with attachment gets AI response. | `composer-add-attachment`, `composer-attachment-tile`, `message-image-thumb` |

### §composer plan-mode toggle

| Test | Status | Description | data-testids |
|---|---|---|---|
| is visible for the plan-capable adapter and aria-pressed flips with active styling | active | Is visible for the plan-capable adapter and aria-pressed flips with active styling. | `composer-plan-toggle` |

### §composer provider locked after first message

| Test | Status | Description | data-testids |
|---|---|---|---|
| sending the first message locks the provider row (Locked copy, disabled pills) | active | Sending the first message locks the provider row (Locked copy, disabled pills). | `composer-adapter-select-option-claude`, `composer-model-select`, `composer-provider-footer`, `composer-provider-header`, `composer-provider-model-popover` |

### §composer worktree-missing banner

| Test | Status | Description | data-testids |
|---|---|---|---|
| shows the worktree-missing banner and locks the input + send button | active | Shows the worktree-missing banner and locks the input + send button. | `chat-composer-input`, `chat-composer-send`, `chat-composer-worktree-missing` |

## context-panel.spec.ts

### §context-panel — no active chat

| Test | Status | Description | data-testids |
|---|---|---|---|
| bottom tabs render with zero counts before any chat is active | active | Bottom tabs render with zero counts before any chat is active. | `sidebar-bottom-tab-agents`, `sidebar-bottom-tab-context`, `sidebar-bottom-tab-skills` |
| the Context tab shows the no-active-chat empty state | active | The Context tab shows the no-active-chat empty state. | — |

### §context-panel — tab switching

| Test | Status | Description | data-testids |
|---|---|---|---|
| Context is the default active tab and renders the Global/Project/Session sections | active | Context is the default active tab and renders the Global/Project/Session sections. | `sidebar-bottom-tab-context`, `sidebar-context-section-global`, `sidebar-context-section-project`, `sidebar-context-section-session` |
| switching to Skills shows the empty state and marks Skills as the active tab | active | Switching to Skills shows the empty state and marks Skills as the active tab. | `sidebar-bottom-tab-context`, `sidebar-bottom-tab-skills`, `sidebar-context-section-global` |
| switching to Agents shows the empty state and marks Agents as the active tab | active | Switching to Agents shows the empty state and marks Agents as the active tab. | `sidebar-bottom-tab-agents` |
| switching back to Context restores the section body | active | Switching back to Context restores the section body. | `sidebar-bottom-tab-context`, `sidebar-context-section-global` |

### §context-panel — skills and agents rows

| Test | Status | Description | data-testids |
|---|---|---|---|
| a skill row click opens its SKILL.md in the editor | active | A skill row click opens its SKILL.md in the editor. | `files-tab-strip`, `sidebar-bottom-tab-skills`, `sidebar-skill-item-mock-cli:project:write-tests` |
| an agent row click opens its agent file in the editor | active | An agent row click opens its agent file in the editor. | `files-tab-strip`, `sidebar-agent-item-mock-cli:project:agent:code-reviewer`, `sidebar-bottom-tab-agents` |

### §context-panel — tasks section

| Test | Status | Description | data-testids |
|---|---|---|---|
| renders the progress fill and per-todo rows, with completed rows struck through | active | Renders the progress fill and per-todo rows, with completed rows struck through. | `context-task-row-Run the test suite`, `context-task-row-Write the README`, `context-tasks-progress-fill`, `context-tasks-section` |

### §context-panel — sections, file-open, and attachments

| Test | Status | Description | data-testids |
|---|---|---|---|
| the Session section count reflects the mention plus both attachments, and the mention row carries the @ badge | active | The Session section count reflects the mention plus both attachments, and the mention row carries the @ badge. | `sidebar-context-item-index.ts`, `sidebar-context-section-global`, `sidebar-context-section-project`, `sidebar-context-section-session` |
| the bottom Context tab count badge matches the total context item count | active | The bottom Context tab count badge matches the total context item count. | `sidebar-bottom-tab-context` |
| clicking the file item opens it in the Files surface as an editor tab | active | Clicking the file item opens it in the Files surface as an editor tab. | `files-tab-strip`, `sidebar-context-item-index.ts` |
| attachment thumbnails render; the image thumb opens the lightbox | active | Attachment thumbnails render; the image thumb opens the lightbox. | `image-lightbox-dialog`, `sidebar-attachment-*` |
| the non-image thumb does not open the lightbox | active | The non-image thumb does not open the lightbox. | `image-lightbox-dialog`, `sidebar-attachment-*` |
| collapsing the Session section header hides its rows; clicking again restores them | active | Collapsing the Session section header hides its rows; clicking again restores them. | `sidebar-context-item-index.ts`, `sidebar-context-section-session` |

## daemon-picker.spec.ts

### §daemon-picker

| Test | Status | Description | data-testids |
|---|---|---|---|
| footer trigger opens the daemon picker | active | Footer trigger opens the daemon picker. | `daemon-row-local` |
| local daemon row shows the active check and a connected status dot | active | Local daemon row shows the active check and a connected status dot. | `daemon-row-local-active`, `daemon-row-local-dot` |
| add-remote dialog walks the URL step to the device step, back navigation, and closes without pairing | active | Add-remote dialog walks the URL step to the device step, back navigation, and closes without pairing. | `daemon-add-back`, `daemon-add-close`, `daemon-add-continue`, `daemon-add-device`, `daemon-add-url`, `daemon-add-verify`, `daemon-pair-code`, `daemon-picker-add`, `daemon-picker-empty` |
| an unreachable server URL shows the error state with a retry action | active | An unreachable server URL shows the error state with a retry action. | `daemon-add-close`, `daemon-add-continue`, `daemon-add-url`, `daemon-add-verify`, `daemon-picker-add` |
| completing pairing adds a remote daemon row | active | Completing pairing adds a remote daemon row. | `daemon-add-confirm`, `daemon-add-continue`, `daemon-add-device`, `daemon-add-url`, `daemon-add-verify`, `daemon-pair-code`, `daemon-picker-add` |
| pairing auto-switches the active daemon and shows a "Paired" confirmation | skip — TODO(bug): registry.switchTo -> AppShell key={target.id} remount destroys the open AddRemoteDialog mid-handleConfirm, before it can ever reach the "... | Pairing auto-switches the active daemon and shows a "Paired" confirmation. | `daemon-add-confirm`, `daemon-add-continue`, `daemon-add-device`, `daemon-add-url`, `daemon-add-verify`, `daemon-footer-trigger`, `daemon-pair-code`, `daemon-picker`, `daemon-picker-add`, `daemon-remove-confirm`, `daemon-remove-dialog`, `daemon-row-local` |
| unreachable overlay renders when the daemon connection drops, and switch-to-local recovers | active | Unreachable overlay renders when the daemon connection drops, and switch-to-local recovers. | `daemon-footer-trigger`, `daemon-unreachable`, `daemon-unreachable-switchlocal` |
| manage menu rename updates the remote row label | skip — TODO(bug): the daemon-picker Popover closes itself once the nested rename/remove DaemonSmallDialog dismisses (confirmed live: picker count is 0 righ... | Manage menu rename updates the remote row label. | `daemon-footer-trigger`, `daemon-rename-dialog`, `daemon-rename-input`, `daemon-rename-save` |
| manage menu remove confirms and removes the remote row | skip — TODO(bug): the daemon-picker Popover closes itself once the nested rename/remove DaemonSmallDialog dismisses (confirmed live: picker count is 0 righ... | Manage menu remove confirms and removes the remote row. | `daemon-footer-trigger`, `daemon-picker-empty`, `daemon-remove-confirm`, `daemon-remove-dialog` |
| ends the suite back on the local daemon | active | Ends the suite back on the local daemon. | `daemon-footer-trigger` |

## directory-picker.spec.ts

### §directory-picker Open, browse, select, confirm

| Test | Status | Description | data-testids |
|---|---|---|---|
| opens seeded at the home root with the directory-mode title | active | Opens seeded at the home root with the directory-mode title. | `directory-picker`, `directory-picker-path-input`, `sessions-add-project` |
| pasting the temp project's absolute path re-seeds the tree there | active | Pasting the temp project's absolute path re-seeds the tree there. | `directory-picker-path-input`, `directory-picker-row-*` |
| clicking a directory row expands it, lazy-loads its child, and selects it | active | Clicking a directory row expands it, lazy-loads its child, and selects it. | `directory-picker-confirm`, `directory-picker-row-*`, `directory-picker-selected-path` |
| expanding the empty nested directory shows the per-node Empty state | active | Expanding the empty nested directory shows the per-node Empty state. | `directory-picker-node-empty-*`, `directory-picker-row-*` |
| navigating to a directory with no subfolders shows the root Empty state | active | Navigating to a directory with no subfolders shows the root Empty state. | `directory-picker-empty`, `directory-picker-path-input` |
| Cancel closes the dialog without registering a project | active | Cancel closes the dialog without registering a project. | `directory-picker`, `directory-picker-cancel` |
| confirming a directory registers it as a project and adds it to Recents | active | Confirming a directory registers it as a project and adds it to Recents. | `directory-picker`, `directory-picker-confirm`, `directory-picker-path-input`, `directory-picker-recent`, `directory-picker-recent-*`, `directory-picker-row-*`, `sessions-add-project`, `toast-root` |
| clicking a Recent row re-picks it in one click | active | Clicking a Recent row re-picks it in one click. | `directory-picker`, `directory-picker-recent-*`, `toast-root` |

### §directory-picker Path-crumb edge cases + dismiss

| Test | Status | Description | data-testids |
|---|---|---|---|
| an unreachable path shows an inline load error, not stale rows | active | An unreachable path shows an inline load error, not stale rows. | `directory-picker`, `directory-picker-cancel`, `directory-picker-error`, `directory-picker-path-input`, `sessions-add-project` |
| Escape reverts an edited crumb draft without closing the dialog | active | Escape reverts an edited crumb draft without closing the dialog. | `directory-picker`, `directory-picker-cancel`, `directory-picker-path-input`, `sessions-add-project` |
| Escape with an unedited crumb closes the dialog | active | Escape with an unedited crumb closes the dialog. | `directory-picker`, `sessions-add-project` |
| the header Close button dismisses without registering a project | active | The header Close button dismisses without registering a project. | `directory-picker`, `directory-picker-close`, `sessions-add-project` |
| shows a loading indicator while a browse request is in flight | active | Shows a loading indicator while a browse request is in flight. | `directory-picker`, `directory-picker-cancel`, `directory-picker-loading`, `directory-picker-path-input`, `sessions-add-project` |

### §directory-picker File mode

| Test | Status | Description | data-testids |
|---|---|---|---|
| file-mode is not reachable from any UI entry point | skip — TODO(app-tauri): no UI consumer calls pickDirectory({ mode: "file" }) today — features/sessions/use-add-project.ts is the only pickDirectory call site and... | File-mode is not reachable from any UI entry point. | — |

## editor-comments-review.spec.ts

### §editor-comments-review — inline comment gutter

| Test | Status | Description | data-testids |
|---|---|---|---|
| clicking an empty gutter line opens the comment widget with the line snippet and an empty input | active | Clicking an empty gutter line opens the comment widget with the line snippet and an empty input. | `editor-code`, `editor-comment-widget-input`, `editor-comment-widget-snippet` |
| typing text and clicking "Add context" saves the comment and closes the widget, leaving the ● marker | active | Typing text and clicking "Add context" saves the comment and closes the widget, leaving the ● marker. | `editor-code`, `editor-comment-widget-input`, `editor-comment-widget-save` |
| clicking the ● marker reopens the widget pre-filled with the saved text | active | Clicking the ● marker reopens the widget pre-filled with the saved text. | `editor-code`, `editor-comment-widget-close`, `editor-comment-widget-input` |
| Cancel closes the widget without saving as a distinct action, but typed text is NOT discarded — the anchor keeps it (no draft buffer exists) | active | Cancel closes the widget without saving as a distinct action, but typed text is NOT discarded — the anchor keeps it (no draft buffer exists). | `editor-code`, `editor-comment-widget-cancel`, `editor-comment-widget-close`, `editor-comment-widget-input` |
| Escape behaves the same way Cancel does — closes without saving, keeps the typed text | active | Escape behaves the same way Cancel does — closes without saving, keeps the typed text. | `editor-code`, `editor-comment-widget-close`, `editor-comment-widget-input` |
| the submit-review bar shows the total comment count and enables submit once any comment has text | active | The submit-review bar shows the total comment count and enables submit once any comment has text. | `editor-submit-review`, `editor-submit-review-btn` |
| right-click → Copy copies the selected line text to the clipboard | active | Right-click → Copy copies the selected line text to the clipboard. | `editor-code`, `editor-context-menu-content`, `editor-context-menu-copy` |
| right-click → Copy Reference writes "path:line (word)" to the clipboard | active | Right-click → Copy Reference writes "path:line (word)" to the clipboard. | `editor-code`, `editor-context-menu-content`, `editor-context-menu-copy-ref` |
| right-click → Add Agent Context sets the composer quote to the same "path:line" reference | active | Right-click → Add Agent Context sets the composer quote to the same "path:line" reference. | `composer-quote-dismiss`, `composer-quote-preview`, `editor-code`, `editor-context-menu-add-context`, `editor-context-menu-content` |
| Go to Definition / Find All References are disabled for a file type with no LSP language mapping | active | Go to Definition / Find All References are disabled for a file type with no LSP language mapping. | `editor-code`, `editor-context-menu-content`, `editor-context-menu-find-refs`, `editor-context-menu-go-to-def` |
| Go to Definition jumps to the symbol and Find All References lists + closes the panel | skip — construction (external process cold-start + no workspace `typescript`). | Go to Definition jumps to the symbol and Find All References lists + closes the panel. | — |

### §editor-comments-review — submit review to chat

| Test | Status | Description | data-testids |
|---|---|---|---|
| submitting a single-comment review clears the gutter and posts a ReviewCommentCard to the chat | active | Submitting a single-comment review clears the gutter and posts a ReviewCommentCard to the chat. | `chat-user-review-comment`, `chat-user-review-comment-L2`, `editor-code`, `editor-comment-widget-input`, `editor-comment-widget-save`, `editor-submit-review`, `editor-submit-review-btn` |

## editor-diff.spec.ts

### §editor-diff — Changes panel

| Test | Status | Description | data-testids |
|---|---|---|---|
| clicking a changed-file row opens a HEAD-vs-working diff with both panes rendered and the correct chunk count | active | Clicking a changed-file row opens a HEAD-vs-working diff with both panes rendered and the correct chunk count. | `changes-row-tall.ts`, `diff-tab`, `editor-diff` |
| the reveal button mounts once the diff tab is ready — DiffTab always passes filePath to DiffHeader | active | The reveal button mounts once the diff tab is ready — DiffTab always passes filePath to DiffHeader. | `diff-prev-change`, `diff-reveal` |
| prev/next-change buttons navigate chunks, scrolling the far-apart bottom chunk into view | skip — TODO(bug): horizontal scroll-into-view for a chunk far down a long line never happens (`.cm-scroller.scrollLeft` stays 0) — the marker mounts and sc... | Prev/next-change buttons navigate chunks, scrolling the far-apart bottom chunk into view. | `diff-next-change`, `diff-prev-change`, `diff-tab`, `editor-diff` |
| the diff tab has no dirty chip and no save path, even after editing the modified pane | active | The diff tab has no dirty chip and no save path, even after editing the modified pane. | `diff-tab`, `editor-diff`, `editor-save-status`, `editor-tab-save-error` |
| opening a diff for a file that lost its disk copy after appearing as an uncommitted change shows "No diff available" | active | Opening a diff for a file that lost its disk copy after appearing as an uncommitted change shows "No diff available". | `changes-refresh`, `changes-row-orphan.txt`, `changes-status-orphan.txt`, `diff-next-change`, `diff-prev-change`, `diff-reveal`, `diff-tab`, `inspector-tab-changes` |

### §editor-diff — Open in diff editor from EditFileCard

| Test | Status | Description | data-testids |
|---|---|---|---|
| "Open in diff editor" on the Edit tool card opens a diff tab with the tool's original/modified sides | active | "Open in diff editor" on the Edit tool card opens a diff tab with the tool's original/modified sides. | `chat-edit-card`, `chat-edit-open-diff`, `diff-tab`, `editor-diff` |

## editor.spec.ts

### §editor

| Test | Status | Description | data-testids |
|---|---|---|---|
| opening a file from the tree adds an italic preview tab | active | Opening a file from the tree adds an italic preview tab. | `editor-code`, `file-tree-row-index.ts` |
| opening a second file replaces the existing preview tab | active | Opening a second file replaces the existing preview tab. | `file-tree-row-utils.ts`, `files-tab-strip` |
| double-clicking a preview tab promotes it to permanent; opening another file then appends instead of replacing | active | Double-clicking a preview tab promotes it to permanent; opening another file then appends instead of replacing. | `file-tree-row-notes.md`, `files-tab-strip` |
| closing a tab removes it and activates the previously-active tab | active | Closing a tab removes it and activates the previously-active tab. | `files-tab-strip` |
| editing the buffer shows the unsaved chip; Cmd+S saves it and persists to disk | active | Editing the buffer shows the unsaved chip; Cmd+S saves it and persists to disk. | `editor-code`, `editor-save-status` |
| save error is shown when the file is not writable | active | Save error is shown when the file is not writable. | `editor-code`, `editor-tab-save-error`, `file-tree-row-readonly.ts` |
| read-only banner appears when a file is opened read-only | skip — read-only entry point (e.g. | Read-only banner appears when a file is opened read-only. | — |
| disk-conflict banner: Reload takes the disk content when the buffer is dirty | skip — TODO(app-tauri): file-watch (file:changed) event did not reach the UI within 20s in browser mode | Disk-conflict banner: Reload takes the disk content when the buffer is dirty. | `editor-code`, `editor-save-status`, `editor-tab-disk-conflict`, `editor-tab-reload`, `file-tree-row-conflict-reload.ts` |
| disk-conflict banner: Keep mine dismisses the banner and preserves local edits | skip — TODO(app-tauri): file-watch (file:changed) event did not reach the UI within 20s in browser mode | Disk-conflict banner: Keep mine dismisses the banner and preserves local edits. | `editor-code`, `editor-save-status`, `editor-tab-disk-conflict`, `editor-tab-keep-mine`, `file-tree-row-conflict-keep.ts` |
| Cmd+F opens the CM6 search panel and highlights matches | active | Cmd+F opens the CM6 search panel and highlights matches. | `editor-code`, `file-tree-row-search.ts` |
| footer status shows Ln/Col that follows the cursor | active | Footer status shows Ln/Col that follows the cursor. | `editor-code`, `viewer-shell-status` |
| markdown file opens in Preview mode; Source toggles to CM6 | active | Markdown file opens in Preview mode; Source toggles to CM6. | `editor-code`, `file-tree-row-notes.md`, `markdown-mode-edit`, `markdown-mode-preview`, `markdown-preview` |
| edits typed in Source mode reflect back in Preview mode | active | Edits typed in Source mode reflect back in Preview mode. | `editor-code`, `markdown-mode-edit`, `markdown-mode-preview`, `markdown-preview` |

## files-tree.spec.ts

### §files-tree — no project

| Test | Status | Description | data-testids |
|---|---|---|---|
| inspector shows the no-project empty state before any chat is active | active | Inspector shows the no-project empty state before any chat is active. | `inspector-pane`, `main-toolbar-inspector` |
| file picker shows the no-project state when opened with no active chat | active | File picker shows the no-project state when opened with no active chat. | `file-picker-no-project`, `files-tab-strip-add` |

### §files-tree — Inspector pane

| Test | Status | Description | data-testids |
|---|---|---|---|
| toggling the inspector from the toolbar shows and hides the pane | active | Toggling the inspector from the toolbar shows and hides the pane. | `inspector-pane`, `main-toolbar-inspector` |
| the changes tab badge shows the uncommitted file count | active | The changes tab badge shows the uncommitted file count. | `inspector-tab-changes` |
| Files tab is selected by default and Changes tab switches the body | active | Files tab is selected by default and Changes tab switches the body. | `changes-panel`, `file-tree`, `inspector-tab-changes`, `inspector-tab-files` |
| the file tree loads the seeded project root | active | The file tree loads the seeded project root. | `file-tree-row-CLAUDE.md`, `file-tree-row-data.csv`, `file-tree-row-index.ts`, `file-tree-row-src`, `file-tree-row-src/utils.ts` |
| expanding a folder lazily fetches and renders its children | active | Expanding a folder lazily fetches and renders its children. | `file-tree-row-src`, `file-tree-row-src/utils.ts` |
| collapsing an expanded folder hides its children | active | Collapsing an expanded folder hides its children. | `file-tree-row-src`, `file-tree-row-src/utils.ts` |
| clicking a file opens it in a Files editor tab | active | Clicking a file opens it in a Files editor tab. | `file-tree-row-CLAUDE.md`, `files-tab-strip` |
| the refresh button re-fetches the tree and shows a newly created file | active | The refresh button re-fetches the tree and shows a newly created file. | `file-tree-refresh`, `file-tree-row-runtime-file.txt` |
| revealing a file from its viewer highlights it in the tree | active | Revealing a file from its viewer highlights it in the tree. | `file-tree-row-data.csv`, `inspector-tab-files`, `viewer-csv`, `viewer-shell-reveal` |
| the file row context menu offers find-in-file, reveal, and copy actions | active | The file row context menu offers find-in-file, reveal, and copy actions. | `file-tree-copy-path`, `file-tree-copy-relative-path`, `file-tree-find-in-file`, `file-tree-find-in-folder`, `file-tree-reveal`, `file-tree-row-index.ts` |
| the folder row context menu offers find-in-folder instead of find-in-file | active | The folder row context menu offers find-in-folder instead of find-in-file. | `file-tree-find-in-file`, `file-tree-find-in-folder`, `file-tree-row-src` |
| the root row context menu is available from the header label | active | The root row context menu is available from the header label. | `file-tree`, `file-tree-find-in-folder`, `file-tree-reveal` |
| reveal in Finder is enabled against the local test daemon | active | Reveal in Finder is enabled against the local test daemon. | `file-tree-reveal`, `file-tree-row-index.ts` |
| switching scope modes changes the changes-panel row set | active | Switching scope modes changes the changes-panel row set. | `changes-mode-branch`, `changes-mode-session`, `changes-mode-uncommitted`, `changes-panel`, `changes-row-index.ts`, `inspector-tab-changes` |
| uncommitted mode shows status glyphs for added, modified, deleted, and renamed files | active | Uncommitted mode shows status glyphs for added, modified, deleted, and renamed files. | `changes-status-delete-me.txt`, `changes-status-index.ts`, `changes-status-new-file.txt`, `changes-status-renamed-notes.md` |
| clicking a changed file row opens a HEAD-vs-working diff tab | active | Clicking a changed file row opens a HEAD-vs-working diff tab. | `changes-row-index.ts`, `diff-tab` |
| the changes refresh button re-fetches the row set | active | The changes refresh button re-fetches the row set. | `changes-refresh`, `changes-row-another-change.txt`, `inspector-tab-changes` |
| the file picker opens from the tab-strip add button with the search hint | active | The file picker opens from the tab-strip add button with the search hint. | `file-picker-dialog`, `files-tab-strip-add` |
| the file picker searches by name, supports arrow-key navigation, and opens the selected file with Enter | active | The file picker searches by name, supports arrow-key navigation, and opens the selected file with Enter. | `file-picker-dialog`, `file-picker-input`, `file-picker-row-CLAUDE.md`, `files-tab-strip` |
| the file picker shows a no-match empty state for an unmatched query | active | The file picker shows a no-match empty state for an unmatched query. | `file-picker-input`, `files-tab-strip-add` |

## find-in-path.spec.ts

### §find-in-path

| Test | Status | Description | data-testids |
|---|---|---|---|
| opens scoped to a single file from the "Find in file" context-menu item | active | Opens scoped to a single file from the "Find in file" context-menu item. | `file-tree-find-in-file`, `file-tree-row-src/alpha.ts`, `find-in-path`, `find-in-path-input` |
| opens scoped to a directory from the "Find in folder" context-menu item | active | Opens scoped to a directory from the "Find in folder" context-menu item. | `file-tree-find-in-folder`, `file-tree-row-src`, `find-in-path` |
| shows the idle hint when empty and the below-threshold hint at 1 character | active | Shows the idle hint when empty and the below-threshold hint at 1 character. | `file-tree-find-in-folder`, `file-tree-row-src`, `find-in-path`, `find-in-path-hint`, `find-in-path-idle-hint`, `find-in-path-input` |
| directory scope: debounced results are grouped by file and include-ignored is offered | active | Directory scope: debounced results are grouped by file and include-ignored is offered. | `file-tree-find-in-folder`, `file-tree-row-src`, `find-in-path`, `find-in-path-include-ignored`, `find-in-path-input`, `find-in-path-result-src/alpha.ts:3:7`, `find-in-path-result-src/beta.ts:2:17` |
| directory scope: shows the no-matches state for a non-matching query | active | Directory scope: shows the no-matches state for a non-matching query. | `file-tree-find-in-folder`, `file-tree-row-src`, `find-in-path`, `find-in-path-empty`, `find-in-path-input`, `find-in-path-result-src/alpha.ts:3:7` |
| file scope: results are limited to the scoped file and include-ignored is not offered | active | File scope: results are limited to the scoped file and include-ignored is not offered. | `file-tree-find-in-file`, `file-tree-row-src/alpha.ts`, `find-in-path`, `find-in-path-include-ignored`, `find-in-path-input`, `find-in-path-result-src/alpha.ts:3:7`, `find-in-path-result-src/beta.ts:2:17` |
| clicking a result opens the matched file in the editor | active | Clicking a result opens the matched file in the editor. | `file-tree-find-in-file`, `file-tree-row-src/alpha.ts`, `files-tab-strip`, `find-in-path`, `find-in-path-input`, `find-in-path-result-src/alpha.ts:3:7`, `viewer-shell-status` |
| Enter opens the active result via the keyboard | active | Enter opens the active result via the keyboard. | `file-tree-find-in-file`, `file-tree-row-src/gamma.ts`, `files-tab-strip`, `find-in-path`, `find-in-path-input`, `find-in-path-result-src/gamma.ts:2:7`, `viewer-shell-status` |
| Escape closes the dialog | active | Escape closes the dialog. | `file-tree-find-in-file`, `file-tree-row-src/beta.ts`, `find-in-path`, `find-in-path-input` |

## gates.spec.ts

### §permission gate details

| Test | Status | Description | data-testids |
|---|---|---|---|
| Details toggle reveals the raw tool input; always-allow shown when suggestions exist | active | Details toggle reveals the raw tool input; always-allow shown when suggestions exist. | `chat-permission-always-allow`, `chat-permission-deny`, `chat-permission-details-pre`, `chat-permission-details-toggle`, `chat-permission-gate` |

### §permission gate no suggestions

| Test | Status | Description | data-testids |
|---|---|---|---|
| always-allow is absent when the request carries no suggestions | active | Always-allow is absent when the request carries no suggestions. | `chat-permission-allow-once`, `chat-permission-always-allow`, `chat-permission-deny`, `chat-permission-gate` |

### §ask-question wizard extras

| Test | Status | Description | data-testids |
|---|---|---|---|
| "Other…" reveals a free-text input; Skip dismisses the gate without an answer | active | "Other…" reveals a free-text input; Skip dismisses the gate without an answer. | `chat-question-gate`, `chat-question-option-0-__other__`, `chat-question-other-input-0`, `chat-question-skip` |

### §ask-question wizard multi-question

| Test | Status | Description | data-testids |
|---|---|---|---|
| Next/Back paginate with a "N of M" counter; the multi-select question renders checkboxes and allows toggling more than one option | active | Next/Back paginate with a "N of M" counter; the multi-select question renders checkboxes and allows toggling more than one option. | `chat-question-back`, `chat-question-gate`, `chat-question-next`, `chat-question-option-0-API key`, `chat-question-option-1-Production`, `chat-question-option-1-Staging`, `chat-question-submit` |

### §plan gate exec-mode

| Test | Status | Description | data-testids |
|---|---|---|---|
| selecting Unattended + clear-context and approving shows a matching running footer | skip — TODO(bug): after approve+clearContext kills and respawns the mock session, the follow-up chat-permission-gate (plan-approval.1.ndjson) never appears... | Selecting Unattended + clear-context and approving shows a matching running footer. | `chat-plan-approve`, `chat-plan-clear-context`, `chat-plan-execmode-yolo`, `chat-plan-gate`, `chat-plan-running-footer` |

### §gate queue-front

| Test | Status | Description | data-testids |
|---|---|---|---|
| only one gate is mounted at a time; tool 1 resolves before tool 2 appears, in recorded order | active | Only one gate is mounted at a time; tool 1 resolves before tool 2 appears, in recorded order. | `chat-permission-allow-once`, `chat-permission-deny`, `chat-permission-gate` |

## git-branch.spec.ts

### §git-branch — Toolbar branch popover

| Test | Status | Description | data-testids |
|---|---|---|---|
| toolbar branch trigger opens the popover; branches lazy-load | active | Toolbar branch trigger opens the popover; branches lazy-load. | `git-branch-list`, `git-branch-row-feature/ff-branch`, `git-branch-row-feature/pull-target`, `git-branch-row-main`, `git-worktree-row-wt-delete`, `git-worktree-row-wt-session` |
| search filters the branch list by substring | active | Search filters the branch list by substring. | `git-branch-row-feature/conflict-a`, `git-branch-row-feature/conflict-b`, `git-branch-row-feature/ff-branch`, `git-branch-row-main`, `git-branch-search` |
| new branch dialog creates a branch and checks it out | active | New branch dialog creates a branch and checks it out. | `git-branch-row-feature/e2e-created`, `git-new-branch`, `git-new-branch-create`, `git-new-branch-dialog`, `git-new-branch-name` |
| branch row submenu: checkout switches the worktree current branch | active | Branch row submenu: checkout switches the worktree current branch. | `git-submenu-checkout` |
| branch row submenu: new branch from a selected branch | active | Branch row submenu: new branch from a selected branch. | `git-new-branch-create`, `git-new-branch-dialog`, `git-new-branch-name`, `git-new-branch-start`, `git-submenu-new-branch-from` |
| branch row submenu: merge fast-forwards a clean ancestor branch | active | Branch row submenu: merge fast-forwards a clean ancestor branch. | `git-submenu-merge` |
| branch row submenu: rename renames a branch | active | Branch row submenu: rename renames a branch. | `git-branch-row-feature/renamed-branch`, `git-rename-input`, `git-rename-submit`, `git-rename-view`, `git-submenu-rename` |
| branch row submenu: delete force-deletes a not-yet-merged branch (two-step confirm) | active | Branch row submenu: delete force-deletes a not-yet-merged branch (two-step confirm). | `git-branch-row-feature/delete-me`, `git-confirm-dialog`, `git-confirm-dialog-confirm`, `git-submenu-delete` |
| branch row submenu: pull fast-forwards a branch from the bare remote | active | Branch row submenu: pull fast-forwards a branch from the bare remote. | `git-submenu-pull` |
| branch row submenu: push sends a local-only commit to the bare remote | active | Branch row submenu: push sends a local-only commit to the bare remote. | `git-submenu-push` |
| conflict view: a genuinely conflicting merge auto-routes to the conflict view; abort recovers | active | Conflict view: a genuinely conflicting merge auto-routes to the conflict view; abort recovers. | `git-branch-search`, `git-conflict-abort`, `git-conflict-view`, `git-submenu-checkout`, `git-submenu-merge` |
| worktree section: toggle collapses/expands rows; delete removes wt-delete | active | Worktree section: toggle collapses/expands rows; delete removes wt-delete. | `git-branch-row-feature/worktree-delete`, `git-confirm-dialog`, `git-confirm-dialog-confirm`, `git-worktree-delete-wt-delete`, `git-worktree-row-wt-delete`, `git-worktree-toggle-wt-delete` |
| quick actions: fetch, update all, and push current complete without error | active | Quick actions: fetch, update all, and push current complete without error. | `git-fetch`, `git-push-current`, `git-update-all`, `toast-root` |
| worktree section: new session on worktree creates a worktree-scoped chat | active | Worktree section: new session on worktree creates a worktree-scoped chat. | `git-branch-popover`, `git-worktree-new-session-wt-session`, `main-toolbar-branch`, `sessions-row` |

## layout.spec.ts

### §20 layout — surface rail, floor, shortcuts

| Test | Status | Description | data-testids |
|---|---|---|---|
| Chat is the only lit surface at boot and is disabled at the dynamic floor | active | Chat is the only lit surface at boot and is disabled at the dynamic floor. | `chat-thread`, `files-surface`, `run-surface`, `surface-rail-chat`, `surface-rail-files`, `surface-rail-run` |
| the rail button toggles Files on, joining Chat in the top row | active | The rail button toggles Files on, joining Chat in the top row. | `files-surface`, `surface-rail-chat`, `surface-rail-files` |
| ControlOrMeta+2 toggles Files off; Chat is once again the sole lit surface | active | ControlOrMeta+2 toggles Files off; Chat is once again the sole lit surface. | `files-surface`, `surface-rail-chat` |
| ControlOrMeta+2 turns Files back on; ControlOrMeta+3 adds Run to the bottom strip | active | ControlOrMeta+2 turns Files back on; ControlOrMeta+3 adds Run to the bottom strip. | `files-surface`, `run-surface` |
| the last lit surface cannot be toggled off (Files becomes the floor after Chat and Run are hidden) | active | The last lit surface cannot be toggled off (Files becomes the floor after Chat and Run are hidden). | `chat-header`, `chat-header-hide`, `files-surface`, `files-tab-strip-close`, `run-surface`, `surface-rail-chat`, `surface-rail-files`, `surface-rail-run` |

### §20 layout — splits + divider resize

| Test | Status | Description | data-testids |
|---|---|---|---|
| chat-header split-right adds Files beside Chat in the top row | active | Chat-header split-right adds Files beside Chat in the top row. | `chat-header-split-right`, `files-surface` |
| files-tab-strip split-down adds Run to the bottom strip | active | Files-tab-strip split-down adds Run to the bottom strip. | `files-tab-strip-split-down`, `run-surface` |
| dragging the horizontal divider resizes the top-row split, and the fraction sticks across a re-render | active | Dragging the horizontal divider resizes the top-row split, and the fraction sticks across a re-render. | `file-picker-dialog`, `files-tab-strip-add`, `surf-divider-x` |
| dragging the vertical divider resizes the top row against the bottom strip | active | Dragging the vertical divider resizes the top row against the bottom strip. | `surf-divider-y` |
| closing a non-floor surface removes only its pane | active | Closing a non-floor surface removes only its pane. | `chat-thread`, `files-surface`, `files-tab-strip-close`, `run-surface` |

### §20 layout — drag: Files-tab-to-Run and escape-cancel

| Test | Status | Description | data-testids |
|---|---|---|---|
| dragging a Files tab onto the center of Run joins it as a Run tab | active | Dragging a Files tab onto the center of Run joins it as a Run tab. | `drop-zone-center`, `files-surface-picker`, `files-tab-strip`, `run-surface` |
| Escape cancels a Files-tab drag; the tab stays in Files | active | Escape cancels a Files-tab drag; the tab stays in Files. | `files-tab-strip`, `run-surface`, `surface-drag-layer` |
| dragging a Files tab onto the right edge of Run splits it into a second pane | active | Dragging a Files tab onto the right edge of Run splits it into a second pane. | `drop-zone-right`, `files-surface-picker`, `files-tab-strip`, `run-pane-*`, `run-pane-pane-*` |
| surface grip drag reposition (top-left / top-right / bottom) — not covered (live-run needed) | skip — TODO(app-tauri): needs a live run to pin reposition-target coordinates deterministically; | Surface grip drag reposition (top-left / top-right / bottom) — not covered (live-run needed). | — |

### §20 layout — per-session layout persistence

| Test | Status | Description | data-testids |
|---|---|---|---|
| arranging a layout in session A does not leak into session B, and A is restored on return | active | Arranging a layout in session A does not leak into session B, and A is restored on return. | `chat-composer-input`, `data-chat-id`, `files-surface`, `sessions-row`, `surface-rail-files` |

## preview.spec.ts

### §preview — running lifecycle

| Test | Status | Description | data-testids |
|---|---|---|---|
| Run surface picker lists the preview config | active | Run surface picker lists the preview config. | `run-picker-launch-*`, `run-surface`, `run-surface-picker`, `surface-rail-run` |
| starting the config shows the starting body and keeps toolbar controls locked | active | Starting the config shows the starting body and keeps toolbar controls locked. | `preview-body-starting`, `preview-capture-cluster`, `preview-toolbar`, `preview-url-clear-cache`, `preview-url-input`, `preview-url-open-browser`, `preview-url-reload`, `run-picker-launch-*` |
| reaches the running state and unlocks the toolbar | active | Reaches the running state and unlocks the toolbar. | `preview-body-running`, `preview-capture-cluster`, `preview-run-restart`, `preview-run-start`, `preview-run-stop`, `preview-url-clear-cache`, `preview-url-input`, `preview-url-open-browser`, `preview-url-reload` |
| URL bar normalizes valid input and flags invalid input | active | URL bar normalizes valid input and flags invalid input. | `preview-url-input` |
| device toggle switches between the desktop and mobile frame | active | Device toggle switches between the desktop and mobile frame. | `preview-body-running`, `preview-device-desktop`, `preview-device-mobile` |
| Inspect button toggles its own active indicator (local state, no native pick) | active | Inspect button toggles its own active indicator (local state, no native pick). | `preview-inspect-active-indicator`, `preview-toolbar-inspect` |
| Stop returns the body to the stopped CTA state and re-locks the toolbar | active | Stop returns the body to the stopped CTA state and re-locks the toolbar. | `preview-body-cta`, `preview-body-stopped`, `preview-capture-cluster`, `preview-run-stop`, `preview-url-input` |
| clicking the stopped-body CTA restarts the config back to running | active | Clicking the stopped-body CTA restarts the config back to running. | `preview-body-cta`, `preview-body-running`, `preview-body-starting`, `preview-run-stop` |
| capturing a screenshot opens the annotation popover (needs native webview.capture) | skip — TODO(tauri-native): host.preview.mount().capture() always rejects under FakeHostBridge (browser/dev mode), and onCaptureClick only opens the popover inside t... | Capturing a screenshot opens the annotation popover (needs native webview.capture). | — |
| region-capture completes and opens the annotation popover (needs native region-select result) | skip — TODO(tauri-native): handle.startRegionSelect() resolves in browser mode but handle.onRegionSelect never fires (no native completion event) — regionSelectActi... | Region-capture completes and opens the annotation popover (needs native region-select result). | — |
| clicking an inspected element in the webview reports a pick result | skip — TODO(tauri-native): InspectResult only arrives via handle.onInspect(), which requires a real native webview delivering pixel-level pick events. | Clicking an inspected element in the webview reports a pick result. | — |
| the preview webview renders the live page and reflects in-webview navigation | skip — TODO(tauri-native): pixels + two-way URL sync (handle.onNavigate) require a real native webview; | The preview webview renders the live page and reflects in-webview navigation. | — |

### §preview — failed config

| Test | Status | Description | data-testids |
|---|---|---|---|
| a config with a nonexistent executable reaches the failed state | active | A config with a nonexistent executable reaches the failed state. | `preview-body-failed`, `preview-run-start`, `run-picker-launch-*`, `run-surface`, `surface-rail-run` |

## review-panel.spec.ts

### §review-panel — layout, files, diff, viewed toggle

| Test | Status | Description | data-testids |
|---|---|---|---|
| ⌘⇧R opens a 3-column modal with correct file rows/stats and the first file auto-selected | active | ⌘⇧R opens a 3-column modal with correct file rows/stats and the first file auto-selected. | `editor-diff`, `review-branch-badge`, `review-file-counts`, `review-file-row-*`, `review-file-stat-*`, `review-viewed-counter`, `review-viewed-toggle` |
| clicking a file row selects it and swaps the diff to that file | active | Clicking a file row selects it and swaps the diff to that file. | `editor-diff`, `review-file-row-CLAUDE.md`, `review-file-row-index.ts` |
| the Viewed toggle marks the file viewed and advances the header progress counter | active | The Viewed toggle marks the file viewed and advances the header progress counter. | `review-file-row-index.ts`, `review-file-row-new-file.ts`, `review-viewed-counter`, `review-viewed-toggle` |
| Open in workspace closes the modal and opens the file in the Files surface | active | Open in workspace closes the modal and opens the file in the Files surface. | `files-tab-strip`, `review-modal`, `review-open-in-workspace` |

### §review-panel — comment to chat

| Test | Status | Description | data-testids |
|---|---|---|---|
| selecting a diff line and submitting a comment appends a ReviewCommentCard to the chat | active | Selecting a diff line and submitting a comment appends a ReviewCommentCard to the chat. | `chat-user-review-comment`, `chat-user-review-comment-L2`, `editor-diff`, `review-close`, `review-comment-input`, `review-comment-selected-line`, `review-comment-submit`, `review-file-row-index.ts`, `review-modal` |

### §review-panel — commit rail

| Test | Status | Description | data-testids |
|---|---|---|---|
| submit is disabled until a commit message is entered | active | Submit is disabled until a commit message is entered. | `review-commit-submit` |
| a suggestion chip prefixes the commit message and enables submit | active | A suggestion chip prefixes the commit message and enables submit. | `review-commit-input`, `review-commit-submit`, `review-commit-suggestion-feat` |
| unviewed files are flagged before commit | active | Unviewed files are flagged before commit. | `review-commit-unviewed-warning` |
| committing stages and commits every changed file, showing the done state | active | Committing stages and commits every changed file, showing the done state. | `review-commit-done`, `review-commit-input`, `review-commit-submit` |
| the Done button closes the review modal | active | The Done button closes the review modal. | `review-commit-done`, `review-modal` |

### §review-panel — close controls

| Test | Status | Description | data-testids |
|---|---|---|---|
| the commit rail Cancel button closes the panel | active | The commit rail Cancel button closes the panel. | `review-commit-cancel`, `review-modal` |
| the header close button closes the panel | active | The header close button closes the panel. | `review-close`, `review-modal` |
| Escape closes the panel | active | Escape closes the panel. | `review-modal` |

## run-surface.spec.ts

### §21 run-surface — empty-state picker + new-terminal (degraded)

| Test | Status | Description | data-testids |
|---|---|---|---|
| the empty-state picker lists New terminal and every launch config | active | The empty-state picker lists New terminal and every launch config. | `run-picker-launch-echo-once`, `run-picker-launch-exit-immediately`, `run-picker-launch-sleep-long`, `run-picker-new-terminal`, `run-surface-picker` |
| New terminal fails gracefully in browser mode: no tab, no crash, picker persists | active | New terminal fails gracefully in browser mode: no tab, no crash, picker persists. | `run-picker-new-terminal`, `run-surface-picker`, `surface-rail-run` |

### §21 run-surface — tab strip, add-menu, launch lifecycle, console logs

| Test | Status | Description | data-testids |
|---|---|---|---|
| starting a launch config from the picker opens a tab and reaches running status | active | Starting a launch config from the picker opens a tab and reaches running status. | `main-toolbar-launch`, `main-toolbar-launch-stop-sleep-long`, `run-picker-launch-sleep-long`, `run-tab-*` |
| the per-pane "+" popover lists New terminal and the launch configs; New terminal is a no-op | active | The per-pane "+" popover lists New terminal and the launch configs; New terminal is a no-op. | `run-add-menu-*`, `run-pane-${paneId}`, `run-pane-launch-echo-once-*`, `run-pane-launch-exit-immediately-*`, `run-pane-new-terminal-*`, `run-tab-strip-add-*` |
| launching echo-once from the add-menu opens a second tab whose console shows its output | skip — TODO(bug): echo-once buffered console output never appears via the add-menu launch path (still "No output yet." 15s after launch) — round-2 refetch ... | Launching echo-once from the add-menu opens a second tab whose console shows its output. | `run-console-pane`, `run-pane-launch-echo-once-*`, `run-tab-*`, `run-tab-strip-add-*` |
| tab activate: clicking a pill switches which console is selected | active | Tab activate: clicking a pill switches which console is selected. | `run-tab-*` |
| tab close: closing echo-once removes it, leaving only sleep-long | active | Tab close: closing echo-once removes it, leaving only sleep-long. | `run-tab-*`, `run-tab-close-*` |
| Stop reverts the toolbar to Start for sleep-long | active | Stop reverts the toolbar to Start for sleep-long. | `main-toolbar-launch`, `main-toolbar-launch-start-sleep-long`, `main-toolbar-launch-stop-sleep-long`, `run-tab-*` |

### §21 run-surface — failed launch config

| Test | Status | Description | data-testids |
|---|---|---|---|
| a config that exits non-zero reaches failed status; its tab is not removed | active | A config that exits non-zero reaches failed status; its tab is not removed. | `run-picker-launch-exit-immediately`, `run-tab-*` |

### §21 run-surface — split controls, secondary-pane close, close-at-floor

| Test | Status | Description | data-testids |
|---|---|---|---|
| run-tab-strip-split-right (Run's own header) brings in the Files surface | active | Run-tab-strip-split-right (Run's own header) brings in the Files surface. | `files-surface`, `run-tab-strip-split-right` |
| secondary-pane close: dragging a Files tab onto Run's edge splits it, then run-pane-close un-splits it | active | Secondary-pane close: dragging a Files tab onto Run's edge splits it, then run-pane-close un-splits it. | `drop-zone-right`, `file-picker-dialog`, `file-picker-input`, `file-picker-row-*`, `files-tab-strip`, `files-tab-strip-add`, `run-pane-close-*` |
| run-surface-close is disabled once Run becomes the sole lit surface (the dynamic floor) | active | Run-surface-close is disabled once Run becomes the sole lit surface (the dynamic floor). | `chat-header`, `chat-header-hide`, `files-surface`, `run-surface-close`, `surface-rail-files`, `surface-rail-run` |

## sessions-draft.spec.ts

### §sessions-draft — All view picker + draft row

| Test | Status | Description | data-testids |
|---|---|---|---|
| New (All view) opens the project picker; picking a project resolves the draft without creating a chat | active | New (All view) opens the project picker; picking a project resolves the draft without creating a chat. | `sessions-draft-row`, `sessions-new-button`, `sessions-new-picker`, `sessions-new-picker-project-*`, `sessions-row` |
| composer config selectors are usable on the unsent draft | active | Composer config selectors are usable on the unsent draft. | `chat-composer-input`, `composer-model-select`, `composer-model-select-option-*`, `composer-permission-mode-select`, `composer-permission-mode-select-option-default`, `sessions-draft-row` |
| discarding the draft (✕) clears the row and returns to the previously active session | active | Discarding the draft (✕) clears the row and returns to the previously active session. | `data-chat-id`, `sessions-draft-row`, `sessions-draft-row-discard`, `sessions-row` |
| first send creates exactly one chat in the picked project (no chat exists before send) | active | First send creates exactly one chat in the picked project (no chat exists before send). | `chat-composer-input`, `chat-composer-send`, `data-chat-id`, `sessions-draft-row`, `sessions-new-button`, `sessions-new-picker-project-*`, `sessions-row` |

### §sessions-draft — pill-active skip + no leak across New cycles

| Test | Status | Description | data-testids |
|---|---|---|---|
| with a project pill active, New skips the picker and the draft inherits that project | active | With a project pill active, New skips the picker and the draft inherits that project. | `chat-header-project`, `sessions-draft-row`, `sessions-draft-row-discard`, `sessions-filter-pill-*`, `sessions-new-button`, `sessions-new-picker` |
| abandoning a draft in project A does not leak into a second New picking project B | active | Abandoning a draft in project A does not leak into a second New picking project B. | `chat-composer-input`, `chat-composer-send`, `data-chat-id`, `sessions-draft-row`, `sessions-new-button`, `sessions-new-picker`, `sessions-new-picker-project-*`, `sessions-row` |

### §sessions-draft — WelcomeState suggestions

| Test | Status | Description | data-testids |
|---|---|---|---|
| suggestions render for a project with git history; row count matches the daemon response | active | Suggestions render for a project with git history; row count matches the daemon response. | `sessions-new-button`, `sessions-new-picker-project-*`, `sessions-welcome`, `sessions-welcome-suggestion-*` |
| clicking a suggestion inserts its exact prefill text into the composer | active | Clicking a suggestion inserts its exact prefill text into the composer. | `chat-composer-input`, `sessions-welcome`, `sessions-welcome-suggestion-0` |

### §sessions-draft — FirstRunState (zero projects)

| Test | Status | Description | data-testids |
|---|---|---|---|
| a workspace with no projects shows the FirstRunState hero, not the project picker or Welcome state | active | A workspace with no projects shows the FirstRunState hero, not the project picker or Welcome state. | `sessions-firstrun`, `sessions-new-picker`, `sessions-welcome` |
| the "Add project…" CTA opens the directory picker | active | The "Add project…" CTA opens the directory picker. | `directory-picker`, `sessions-firstrun-add-project` |

## sessions-filters.spec.ts

### §sessions-filters Project + tag filter bar

| Test | Status | Description | data-testids |
|---|---|---|---|
| "All" pill is selected by default and shows every session | active | "All" pill is selected by default and shows every session. | `sessions-filter-pill-*`, `sessions-filter-pill-all`, `sessions-row` |
| clicking a project pill filters the list AND activates that project's session | active | Clicking a project pill filters the list AND activates that project's session. | `data-chat-id`, `sessions-filter-pill-*`, `sessions-filter-pill-all`, `sessions-row` |
| clicking the active project pill again clears the filter but keeps the active session | active | Clicking the active project pill again clears the filter but keeps the active session. | `data-chat-id`, `sessions-filter-pill-*`, `sessions-filter-pill-all`, `sessions-row` |
| selecting a different project pill switches the active session; "All" resets the filter | active | Selecting a different project pill switches the active session; "All" resets the filter. | `data-chat-id`, `sessions-filter-pill-*`, `sessions-filter-pill-all`, `sessions-row` |
| right-click hint dismiss persists across reload | active | Right-click hint dismiss persists across reload. | `sessions-filter-pill-*`, `sessions-filter-pill-*-wrap`, `sessions-pill-hint-dismiss` |
| right-click menu shows Rename disabled and Remove enabled | active | Right-click menu shows Rename disabled and Remove enabled. | `sessions-filter-pill-*`, `sessions-project-remove-*`, `sessions-project-rename-*` |
| add-project dashed pill opens the directory picker | active | Add-project dashed pill opens the directory picker. | `directory-picker`, `directory-picker-close`, `sessions-add-project` |
| tag filter bar is absent until a tag is in use | active | Tag filter bar is absent until a tag is in use. | `sessions-tag-filter-bar` |
| applying a tag to a session surfaces it in the tag filter bar | active | Applying a tag to a session surfaces it in the tag filter bar. | `data-chat-id`, `sessions-row`, `sessions-row-action-tags`, `sessions-tag-filter-*`, `sessions-tag-filter-bar`, `sessions-tag-popover`, `sessions-tag-popover-search` |
| toggling a tag pill filters the session list | active | Toggling a tag pill filters the session list. | `data-chat-id`, `sessions-row`, `sessions-tag-filter-*` |
| sort menu switches sort mode and the group headers change | active | Sort menu switches sort mode and the group headers change. | `sessions-group-header-A–Z`, `sessions-group-header-By status`, `sessions-group-header-Today`, `sessions-sort-button`, `sessions-sort-name`, `sessions-sort-popover`, `sessions-sort-recent`, `sessions-sort-status` |
| project-pill and tag-filter-bar overflow "+N more"/"Less" toggle | skip — TODO(app-tauri): overflow "+N more" needs 6+ projects/tags (sidebar minWidth floor defeats viewport narrowing) | Project-pill and tag-filter-bar overflow "+N more"/"Less" toggle. | — |
| attention badges appear on non-filtered pills | active | Attention badges appear on non-filtered pills. | `data-chat-id`, `sessions-filter-pill-attn-*`, `sessions-row` |
| synthetic has-pr/has-worktree chips render only in the expanded state | skip — TODO(app-tauri): synthetic has-pr/has-worktree chips need a worktree/PR fixture | Synthetic has-pr/has-worktree chips render only in the expanded state. | — |
| right-click Remove Project removes it after confirm, with a toast | active | Right-click Remove Project removes it after confirm, with a toast. | `sessions-filter-pill-*`, `sessions-project-remove-*`, `toast-root` |

### §sessions-filters Empty state

| Test | Status | Description | data-testids |
|---|---|---|---|
| shows "No sessions yet" when there are no filters and no sessions | active | Shows "No sessions yet" when there are no filters and no sessions. | `sessions-empty-state` |
| shows "No sessions match these filters." once a filter is active | active | Shows "No sessions match these filters." once a filter is active. | `sessions-empty-state`, `sessions-filter-pill-*` |

## sessions-rows.spec.ts

### §sessions-rows Row selection, hover, context menu, pin, meta line

| Test | Status | Description | data-testids |
|---|---|---|---|
| clicking a row selects it (data-active), deselecting the previously active row | active | Clicking a row selects it (data-active), deselecting the previously active row. | `data-chat-id`, `sessions-row` |
| idle status dot is muted on a fresh, read chat | active | Idle status dot is muted on a fresh, read chat. | `data-chat-id`, `sessions-row`, `sessions-row-status-dot` |
| hovering a row swaps the relative-time label for the tag/rename/archive action buttons | active | Hovering a row swaps the relative-time label for the tag/rename/archive action buttons. | `data-chat-id`, `sessions-row`, `sessions-row-action-archive`, `sessions-row-action-rename`, `sessions-row-action-tags`, `sessions-row-relative-time` |
| right-click context menu shows exactly Pin, Rename, Tags, Archive before any message has been sent | active | Right-click context menu shows exactly Pin, Rename, Tags, Archive before any message has been sent. | `data-chat-id`, `sessions-ctx-archive`, `sessions-ctx-copy-id`, `sessions-ctx-pin`, `sessions-ctx-rename`, `sessions-ctx-tags`, `sessions-row` |
| pinning via the context menu moves the row into a Pinned group with a pin glyph; unpinning reverts it | active | Pinning via the context menu moves the row into a Pinned group with a pin glyph; unpinning reverts it. | `data-chat-id`, `sessions-ctx-pin`, `sessions-group-header-Pinned`, `sessions-group-pin-glyph`, `sessions-row` |
| project chip renders in the meta line only in the All view | active | Project chip renders in the meta line only in the All view. | `data-chat-id`, `sessions-filter-pill-*`, `sessions-filter-pill-all`, `sessions-row`, `sessions-row-meta-project` |
| applying a tag surfaces a colored dot in the row meta line | active | Applying a tag surfaces a colored dot in the row meta line. | `data-chat-id`, `sessions-row`, `sessions-row-action-tags`, `sessions-row-meta-tag-dot-*`, `sessions-tag-popover`, `sessions-tag-popover-search` |

### §sessions-rows Worktree meta pill + missing state

| Test | Status | Description | data-testids |
|---|---|---|---|
| worktree pill shows the branch basename; going missing on disk flips the pill + dot to destructive | active | Worktree pill shows the branch basename; going missing on disk flips the pill + dot to destructive. | `data-chat-id`, `sessions-row`, `sessions-row-meta-worktree`, `sessions-row-meta-worktree-missing`, `sessions-row-status-dot` |

### §sessions-rows Working + waiting status dot during a gate-held run

| Test | Status | Description | data-testids |
|---|---|---|---|
| shows a working spinner while the CLI processes, then a waiting beacon once the permission gate lands | active | Shows a working spinner while the CLI processes, then a waiting beacon once the permission gate lands. | `chat-permission-deny`, `chat-permission-gate`, `data-chat-id`, `sessions-row`, `sessions-row-status-dot` |

### §sessions-rows Unread status dot + copy session id

| Test | Status | Description | data-testids |
|---|---|---|---|
| marks the row unread once a response lands while a different chat is active, and clears it on reselect | active | Marks the row unread once a response lands while a different chat is active, and clears it on reselect. | `data-chat-id`, `sessions-row`, `sessions-row-status-dot` |
| copy-session-id appears once the chat has a claudeSessionId, and copies it to the clipboard | active | Copy-session-id appears once the chat has a claudeSessionId, and copies it to the clipboard. | `data-chat-id`, `sessions-ctx-copy-id`, `sessions-row` |

### §sessions-rows PR link

| Test | Status | Description | data-testids |
|---|---|---|---|
| PR link opens in a new tab (target=_blank) | skip — TODO(app-tauri): PR-link needs a detected-PR fixture; | PR link opens in a new tab (target=_blank). | — |

## sessions-tags.spec.ts

### §sessions-tags Tag popover lifecycle

| Test | Status | Description | data-testids |
|---|---|---|---|
| opens the tag popover from the row hover action | active | Opens the tag popover from the row hover action. | `data-chat-id`, `sessions-row`, `sessions-tag-popover-search` |
| opens the tag popover from the row context menu | skip — TODO(bug): Tags row-context-menu action still does not open the popover — setTimeout(0) defer (commit 3368d065) does not close the race against the ... | Opens the tag popover from the row context menu. | `data-chat-id`, `sessions-row`, `sessions-tag-popover-search` |
| creates a tag via type + Enter and applies it immediately | active | Creates a tag via type + Enter and applies it immediately. | `data-chat-id`, `sessions-row`, `sessions-row-meta-tag-dot-*`, `sessions-tag-filter-*`, `sessions-tag-popover-search`, `sessions-tag-toggle-*` |
| an applied tag survives a page reload (daemon-persisted) | active | An applied tag survives a page reload (daemon-persisted). | `data-chat-id`, `sessions-row`, `sessions-row-meta-tag-dot-*`, `sessions-tag-toggle-*` |
| creates a second tag via the create row and applies it | active | Creates a second tag via the create row and applies it. | `data-chat-id`, `sessions-row`, `sessions-row-meta-tag-dot-*`, `sessions-tag-popover-create`, `sessions-tag-popover-search`, `sessions-tag-toggle-*` |
| search field filters the registry list | active | Search field filters the registry list. | `data-chat-id`, `sessions-row`, `sessions-tag-popover-search`, `sessions-tag-registry-row-*` |
| toggles a tag off, removing its dot from the row | active | Toggles a tag off, removing its dot from the row. | `data-chat-id`, `sessions-row`, `sessions-row-meta-tag-dot-*`, `sessions-tag-toggle-*` |
| renames a tag via the registry item context menu, cascading to the row | active | Renames a tag via the registry item context menu, cascading to the row. | `data-chat-id`, `sessions-row`, `sessions-row-meta-tag-dot-*`, `sessions-tag-filter-*`, `sessions-tag-registry-rename`, `sessions-tag-registry-row-*`, `sessions-tag-rename-input` |
| recolors a tag via the recolor panel (registry-only — no cascade needed for the name) | active | Recolors a tag via the recolor panel (registry-only — no cascade needed for the name). | `data-chat-id`, `sessions-row`, `sessions-row-meta-tag-dot-*`, `sessions-tag-color-red`, `sessions-tag-recolor-panel`, `sessions-tag-registry-recolor`, `sessions-tag-registry-row-*` |
| delete confirm dialog: Cancel keeps the tag in the registry | active | Delete confirm dialog: Cancel keeps the tag in the registry. | `data-chat-id`, `sessions-row`, `sessions-tag-delete-confirm`, `sessions-tag-delete-confirm-cancel`, `sessions-tag-registry-delete`, `sessions-tag-registry-row-*` |
| delete confirm dialog: OK removes the tag from the registry, the row, and the filter bar | active | Delete confirm dialog: OK removes the tag from the registry, the row, and the filter bar. | `data-chat-id`, `sessions-row`, `sessions-row-meta-tag-dot-*`, `sessions-tag-delete-confirm`, `sessions-tag-delete-confirm-ok`, `sessions-tag-filter-*`, `sessions-tag-registry-delete`, `sessions-tag-registry-row-*` |
| shows an inline validation message for a disallowed tag name and suppresses create | active | Shows an inline validation message for a disallowed tag name and suppresses create. | `data-chat-id`, `sessions-row`, `sessions-tag-popover`, `sessions-tag-popover-create`, `sessions-tag-popover-search`, `sessions-tag-toggle-bad_name` |

## sessions.spec.ts

### §45 Sessions panel

| Test | Status | Description | data-testids |
|---|---|---|---|
| SP1: new-session button shows project picker (no filter active) | active | SP1: new-session button shows project picker (no filter active). | `sessions-new-button`, `sessions-new-picker`, `sessions-row` |
| SP6: rename a session | active | SP6: rename a session. | `sessions-rename-input`, `sessions-row`, `sessions-row-action-rename`, `sessions-row-title` |
| SP8: archive a session | active | SP8: archive a session. | `sessions-archive-confirm`, `sessions-archive-confirm-dialog`, `sessions-row`, `sessions-row-action-archive` |
| SP9: view and restore an archived session | active | SP9: view and restore an archived session. | `archived-session-item`, `restore-session-btn`, `sessions-archived-dialog`, `sessions-more-archived`, `sessions-more-button`, `sessions-row` |

### §45 Sessions panel — archive dialog worktree branch

| Test | Status | Description | data-testids |
|---|---|---|---|
| a chat with a worktree shows keep/delete worktree buttons, not the single confirm | active | A chat with a worktree shows keep/delete worktree buttons, not the single confirm. | `data-chat-id`, `sessions-archive-confirm`, `sessions-archive-confirm-dialog`, `sessions-archive-delete-worktree`, `sessions-archive-keep-worktree`, `sessions-row`, `sessions-row-action-archive` |
| deleting the worktree removes the directory from disk | active | Deleting the worktree removes the directory from disk. | `data-chat-id`, `sessions-archive-confirm-dialog`, `sessions-archive-delete-worktree`, `sessions-row`, `sessions-row-action-archive` |

### §35 External session import

| Test | Status | Description | data-testids |
|---|---|---|---|
| import button is enabled when external sessions exist | active | Import button is enabled when external sessions exist. | `sessions-more-button`, `sessions-more-import` |
| opens dialog and shows importable sessions | active | Opens dialog and shows importable sessions. | `external-session-item`, `sessions-import-dialog`, `sessions-import-project-*`, `sessions-more-button`, `sessions-more-import` |
| imports a session and closes dialog | active | Imports a session and closes dialog. | `external-session-item`, `import-session-btn`, `sessions-import-dialog`, `sessions-import-project-*`, `sessions-more-button`, `sessions-more-import`, `sessions-row` |
| imported session has a title | active | Imported session has a title. | `sessions-row`, `sessions-row-title` |
| import does not switch active chat | active | Import does not switch active chat. | `external-session-item`, `import-session-btn`, `sessions-import-dialog`, `sessions-import-project-*`, `sessions-more-button`, `sessions-more-import`, `sessions-row`, `sessions-row-title` |

### §35 External session import — pagination

| Test | Status | Description | data-testids |
|---|---|---|---|
| the import dialog shows the first page (50 rows) and a load-more sentinel | active | The import dialog shows the first page (50 rows) and a load-more sentinel. | `external-session-item`, `sessions-import-dialog`, `sessions-import-load-more`, `sessions-import-project-*`, `sessions-more-button`, `sessions-more-import` |
| scrolling the sentinel into view loads page 2; the sentinel then disappears | active | Scrolling the sentinel into view loads page 2; the sentinel then disappears. | `external-session-item`, `sessions-import-load-more` |

### §35 External session import — retry on error

| Test | Status | Description | data-testids |
|---|---|---|---|
| a failed fetch shows the error state; retry recovers the list | active | A failed fetch shows the error state; retry recovers the list. | `external-session-item`, `sessions-import-dialog`, `sessions-import-project-*`, `sessions-import-retry`, `sessions-more-button`, `sessions-more-import` |

## settings.spec.ts

### §settings

| Test | Status | Description | data-testids |
|---|---|---|---|
| sidebar-settings-button opens the dialog; close button closes it | active | Sidebar-settings-button opens the dialog; close button closes it. | `settings-dialog` |
| ⌘, opens the dialog via the global hotkey | active | ⌘, opens the dialog via the global hotkey. | `settings-dialog` |
| Esc closes the dialog | active | Esc closes the dialog. | `settings-dialog` |
| all five tabs render their pane; there is no keybindings tab | active | All five tabs render their pane; there is no keybindings tab. | `settings-nav-*`, `settings-nav-keybindings`, `settings-pane-*` |
| appearance controls apply a token change and persist across reload | active | Appearance controls apply a token change and persist across reload. | `settings-appearance-mode-dark`, `settings-appearance-scheme-ocean`, `settings-appearance-ui-scale-large`, `settings-appearance-window-style-split`, `sidebar-settings-button` |
| worktree-dir Save button appears only when dirty, and the value persists on reopen | active | Worktree-dir Save button appears only when dirty, and the value persists on reopen. | `settings-worktree-dir-input`, `settings-worktree-dir-save` |
| a notification toggle flips and persists across reopen | active | A notification toggle flips and persists across reopen. | `settings-notify-task-complete-toggle` |
| a failed PATCH reverts the toggle via resync (leaf-patch with resync-on-failure) | active | A failed PATCH reverts the toggle via resync (leaf-patch with resync-on-failure). | `settings-notify-session-error-toggle` |
| Providers nav lists the claude adapter and opens its config form | active | Providers nav lists the claude adapter and opens its config form. | `settings-nav-provider-claude`, `settings-pane-provider-claude`, `settings-provider-header-claude` |
| executable path commits on blur and persists on reopen | active | Executable path commits on blur and persists on reopen. | `settings-claude-executable-path-input` |
| default session mode radio persists on reopen | active | Default session mode radio persists on reopen. | `settings-claude-mode-option-yolo` |
| default model dropdown pick persists on reopen | active | Default model dropdown pick persists on reopen. | `settings-claude-model-dropdown-trigger`, `settings-claude-model-option-opus[1m]` |
| system-prompt and plan-mode toggles persist on reopen | active | System-prompt and plan-mode toggles persist on reopen. | `settings-claude-plan-mode-toggle`, `settings-claude-system-prompt-toggle` |
| About pane populates version and author from the host bridge | active | About pane populates version and author from the host bridge. | `settings-about-author`, `settings-about-version` |
| About pane renders no check-for-updates button | active | About pane renders no check-for-updates button. | `settings-about-check-updates` |
| Remote Access renders the named-tunnel, quick-tunnel, and devices sections | active | Remote Access renders the named-tunnel, quick-tunnel, and devices sections. | `settings-remote-access-devices-section`, `settings-remote-access-named-tunnel-section`, `settings-remote-access-pairing-section`, `settings-remote-access-quick-tunnel-section` |
| named-tunnel Save is disabled until both token and URL are filled | active | Named-tunnel Save is disabled until both token and URL are filled. | `named-tunnel-save`, `named-tunnel-token-input`, `named-tunnel-url-input` |
| quick-tunnel toggle is present and enabled (start left untriggered) | active | Quick-tunnel toggle is present and enabled (start left untriggered). | `quick-tunnel-toggle` |

### §settings tuning inheritance

| Test | Status | Description | data-testids |
|---|---|---|---|
| a new chat inherits a provider default effort; a per-chat override does not mutate the provider default | skip — mock-cli adapter not registered in this environment (needs E2E_MODE=mock) | A new chat inherits a provider default effort; a per-chat override does not mutate the provider default. | `composer-effort-select`, `composer-effort-select-option-low`, `composer-model-select`, `composer-model-select-option-claude-opus-4-5-20251001`, `settings-mock-cli-default-effort`, `settings-mock-cli-default-effort-option-high`, `settings-mock-cli-model-dropdown-trigger`, `settings-mock-cli-model-option-claude-opus-4-5-20251001`, `settings-nav-provider-mock-cli`, `settings-pane-provider-mock-cli` |

## sidebar-chrome.spec.ts

### §sidebar-chrome

| Test | Status | Description | data-testids |
|---|---|---|---|
| settings button opens the settings dialog | active | Settings button opens the settings dialog. | `settings-dialog`, `settings-dialog-close`, `sidebar-settings-button` |
| tasks button opens the tasks modal | active | Tasks button opens the tasks modal. | `sidebar-tasks-button`, `tasks-board-close`, `tasks-board-modal` |
| workflows button opens the workflows modal | active | Workflows button opens the workflows modal. | `sidebar-workflows-button`, `workflows-close`, `workflows-modal` |
| Escape closes the workflows modal on the first press | active | Escape closes the workflows modal on the first press. | `sidebar-workflows-button`, `workflows-modal` |
| workflows button shows a pending dot when a run needs input | skip — seed for that state. | Workflows button shows a pending dot when a run needs input. | — |
| footer shows the daemon connected status | active | Footer shows the daemon connected status. | `daemon-footer-trigger` |
| footer idle count chip appears for a seeded, never-run chat | active | Footer idle count chip appears for a seeded, never-run chat. | `sidebar-footer-count-idle`, `sidebar-footer-count-waiting`, `sidebar-footer-count-working` |
| footer working count chip appears during an agent turn | skip — made configurable, or a live 'working'-holding daemon hook). | Footer working count chip appears during an agent turn. | — |
| dragging the resize handle up grows the bottom panel | active | Dragging the resize handle up grows the bottom panel. | — |
| dragging the resize handle down clamps at the minimum height | active | Dragging the resize handle down clamps at the minimum height. | — |
| hide-sidebar collapses the sidebar and show-sidebar-button restores it | active | Hide-sidebar collapses the sidebar and show-sidebar-button restores it. | `sessions-sidebar`, `show-sidebar-button`, `sidebar-hide-button` |

### §sidebar-chrome — footer waiting count

| Test | Status | Description | data-testids |
|---|---|---|---|
| the waiting count chip appears while a permission gate is pending and matches the pending count | active | The waiting count chip appears while a permission gate is pending and matches the pending count. | `chat-permission-deny`, `chat-permission-gate`, `sidebar-footer-count-waiting`, `sidebar-footer-count-working` |

## spotlight.spec.ts

### §spotlight

| Test | Status | Description | data-testids |
|---|---|---|---|
| main-toolbar-search button opens the palette | active | Main-toolbar-search button opens the palette. | `search-palette`, `search-palette-input` |
| ⌘O opens the palette via the global hotkey | active | ⌘O opens the palette via the global hotkey. | `search-palette` |
| Esc closes the palette | active | Esc closes the palette. | `search-palette` |
| default mode with an empty query lists recent sessions | active | Default mode with an empty query lists recent sessions. | `search-palette-session-row-*` |
| default mode query filters to a matching project file | active | Default mode query filters to a matching project file. | `search-palette-file-row-*`, `search-palette-input` |
| clicking a file row opens it in the Files surface | active | Clicking a file row opens it in the Files surface. | `files-tab-strip`, `search-palette`, `search-palette-file-row-*`, `search-palette-input` |
| clicking a session row switches the active session | active | Clicking a session row switches the active session. | `data-chat-id`, `search-palette`, `search-palette-input`, `search-palette-session-row-*`, `sessions-row` |
| `>` command mode runs a command (Toggle Sidebar) | active | `>` command mode runs a command (Toggle Sidebar). | `search-palette`, `search-palette-command-row-sidebar`, `search-palette-input`, `search-palette-mode-chip`, `sessions-new-button` |
| `@` symbol mode switches the field to symbol search | active | `@` symbol mode switches the field to symbol search. | `search-palette-input`, `search-palette-mode-chip` |
| `@` symbol row opens the file at the symbol line (needs a running LSP server) | skip — TODO(app-tauri): needs a verified LSP server under the e2e daemon; | `@` symbol row opens the file at the symbol line (needs a running LSP server). | — |
| `#` changes mode row opens the file diff | active | `#` changes mode row opens the file diff. | `diff-tab`, `search-palette`, `search-palette-change-row-*`, `search-palette-input`, `search-palette-mode-chip` |
| ↑↓ moves the active row and Enter opens the selected file | active | ↑↓ moves the active row and Enter opens the selected file. | `files-tab-strip`, `search-palette`, `search-palette-file-row-widget-*`, `search-palette-input` |
| unmatched query shows the empty state | active | Unmatched query shows the empty state. | `search-palette-empty`, `search-palette-input` |

## stress-matrix.spec.ts

### §ADR stress matrix — combined run

| Test | Status | Description | data-testids |
|---|---|---|---|
| long chat → subagent + mid-turn permission → reconnect mid-stream → optimistic dedup | active | Long chat → subagent + mid-turn permission → reconnect mid-stream → optimistic dedup. | `chat-assistant-message`, `chat-bash-card`, `chat-composer-input`, `chat-permission-allow-once`, `chat-permission-gate`, `chat-task-card`, `chat-task-toggle`, `chat-thread-viewport`, `chat-user-message` |

## tasks.spec.ts

### §tasks

| Test | Status | Description | data-testids |
|---|---|---|---|
| board and drawer show empty state before any tasks exist | active | Board and drawer show empty state before any tasks exist. | `main-toolbar-inspector`, `tasks-drawer`, `tasks-drawer-empty`, `tasks-list-empty` |
| quick dialog creates task #1 from title + body + priority | active | Quick dialog creates task #1 from title + body + priority. | `tasks-list-row-1`, `tasks-quick-body`, `tasks-quick-create`, `tasks-quick-dialog`, `tasks-quick-priority-high`, `tasks-quick-title` |
| board New-task button creates task #2 via the full edit modal | active | Board New-task button creates task #2 via the full edit modal. | `tasks-board-new`, `tasks-edit-delete`, `tasks-edit-save`, `tasks-edit-title`, `tasks-list-group-in_progress`, `tasks-list-row-2`, `tasks-list-row-type-2` |
| sidebar tasks button opens the board populated with both seeded tasks | active | Sidebar tasks button opens the board populated with both seeded tasks. | `sidebar-tasks-button`, `tasks-board-modal`, `tasks-list-row-1`, `tasks-list-row-2` |
| board: list/board view toggle switches TaskListView and TaskBoardView | active | Board: list/board view toggle switches TaskListView and TaskBoardView. | `tasks-card-1`, `tasks-card-2`, `tasks-column-in_progress`, `tasks-column-open`, `tasks-list-row-1`, `tasks-list-row-2`, `tasks-view-board`, `tasks-view-list` |
| list row: status cycle button cycles open → in_progress → done → open | active | List row: status cycle button cycles open → in_progress → done → open. | `tasks-list-group-done`, `tasks-list-group-open`, `tasks-list-row-1`, `tasks-list-row-cycle-1` |
| list row: expand reveals body + Start/Edit CTAs, collapse hides them | active | List row: expand reveals body + Start/Edit CTAs, collapse hides them. | `tasks-list-row-edit-cta-1`, `tasks-list-row-expand-1`, `tasks-list-row-start-cta-1` |
| edit modal: type/priority/status selects + labels/assignees/milestone save and persist | active | Edit modal: type/priority/status selects + labels/assignees/milestone save and persist. | `tasks-edit-assignees`, `tasks-edit-cancel`, `tasks-edit-milestone`, `tasks-edit-save`, `tasks-edit-start`, `tasks-edit-title`, `tasks-label-input`, `tasks-label-pill-backend`, `tasks-label-pill-urgent`, `tasks-label-remove-backend`, `tasks-list-row-1`, `tasks-list-row-edit-1`, `tasks-list-row-type-1` |
| edit modal: dependency picker adds and removes a dependency on task #2 | active | Edit modal: dependency picker adds and removes a dependency on task #2. | `tasks-dep-input`, `tasks-dep-opt-2`, `tasks-dep-pill-2`, `tasks-dep-remove-2`, `tasks-edit-cancel`, `tasks-edit-save`, `tasks-edit-title`, `tasks-list-row-1`, `tasks-list-row-edit-1` |
| edit modal: attachments add and delete | active | Edit modal: attachments add and delete. | `tasks-attach-add`, `tasks-attach-delete-*`, `tasks-edit-cancel`, `tasks-list-row-1`, `tasks-list-row-edit-1` |
| seeds tasks #3, #4, #5 for filter/sort/drawer coverage | active | Seeds tasks #3, #4, #5 for filter/sort/drawer coverage. | `tasks-board-new`, `tasks-edit-save`, `tasks-edit-title`, `tasks-list-row-3`, `tasks-list-row-4`, `tasks-list-row-5`, `tasks-quick-bug`, `tasks-quick-create`, `tasks-quick-dialog`, `tasks-quick-priority-high`, `tasks-quick-priority-low`, `tasks-quick-title` |
| filters: search narrows the list; the priority filter narrows further; Clear resets | active | Filters: search narrows the list; the priority filter narrows further; Clear resets. | `tasks-filter-clear`, `tasks-filter-opt-critical`, `tasks-filter-priority`, `tasks-filter-priority-count`, `tasks-filter-search`, `tasks-list-row-1`, `tasks-list-row-3`, `tasks-list-row-4`, `tasks-list-row-5` |
| sort menu: priority (default) then Number reorder the open column deterministically | active | Sort menu: priority (default) then Number reorder the open column deterministically. | `tasks-card-*`, `tasks-card-delete-*`, `tasks-card-edit-*`, `tasks-card-start-*`, `tasks-column-open`, `tasks-sort-menu`, `tasks-sort-option-number`, `tasks-view-board`, `tasks-view-list` |
| drawer: rows, active count, New button, and expand-to-modal | active | Drawer: rows, active count, New button, and expand-to-modal. | `main-toolbar-inspector`, `tasks-board-modal`, `tasks-drawer`, `tasks-drawer-count`, `tasks-drawer-expand`, `tasks-drawer-new`, `tasks-drawer-row-*`, `tasks-drawer-row-3`, `tasks-edit-cancel`, `tasks-edit-save`, `tasks-edit-title` |
| drawer: resize handle grows the drawer and clamps at the minimum height | active | Drawer: resize handle grows the drawer and clamps at the minimum height. | `main-toolbar-inspector`, `tasks-drawer`, `tasks-drawer-resize-handle` |
| delete a task from the list row | active | Delete a task from the list row. | `tasks-board-modal`, `tasks-list-row-2`, `tasks-list-row-delete-2` |
| delete a task from the edit modal | active | Delete a task from the edit modal. | `tasks-board-modal`, `tasks-edit-delete`, `tasks-edit-title`, `tasks-list-row-4`, `tasks-list-row-edit-4` |
| start-session CTA creates a chat prefilled with the task message | skip — touchable from this spec (packages/ui/.../use-start-todo-session.ts). | Start-session CTA creates a chat prefilled with the task message. | `chat-composer-input`, `sessions-row`, `tasks-board-modal`, `tasks-list-row-3`, `tasks-list-row-start-3` |

## tool-cards.spec.ts

### §tool-cards — Bash (messaging)

| Test | Status | Description | data-testids |
|---|---|---|---|
| is collapsed by default; expanding reveals command, description, and colorized output | active | Is collapsed by default; expanding reveals command, description, and colorized output. | `chat-bash-card`, `chat-bash-command`, `chat-bash-description`, `chat-bash-output`, `chat-bash-trigger` |

### §tool-cards — Write (permissions-interactive)

| Test | Status | Description | data-testids |
|---|---|---|---|
| collapsed by default; expanding shows the written content once the write succeeds | active | Collapsed by default; expanding shows the written content once the write succeeds. | `chat-permission-allow-once`, `chat-permission-deny`, `chat-permission-gate`, `chat-write-card`, `chat-write-trigger`, `tool-card-file-path` |

### §tool-cards — Read + Edit (changes-tab)

| Test | Status | Description | data-testids |
|---|---|---|---|
| Read card shows the line-count meta and a collapsed code preview | active | Read card shows the line-count meta and a collapsed code preview. | `read-card-code-preview`, `read-card-root`, `read-card-trigger`, `tool-card-file-path` |
| Edit card is open by default with +/- stat pills and the diff body visible | active | Edit card is open by default with +/- stat pills and the diff body visible. | `chat-edit-card`, `tool-card-file-path` |
| "Open in diff editor" opens the Files surface diff tab with the edit's sides | active | "Open in diff editor" opens the Files surface diff tab with the edit's sides. | `chat-edit-card`, `chat-edit-open-diff`, `diff-tab`, `editor-diff` |

### §tool-cards — AskUserQuestion display (ask-question)

| Test | Status | Description | data-testids |
|---|---|---|---|
| renders the answered question with its selected-answer pill once the gate resolves | active | Renders the answered question with its selected-answer pill once the gate resolves. | `chat-ask-body`, `chat-ask-card`, `chat-ask-header`, `chat-question-gate`, `chat-question-option-0-*`, `chat-question-submit` |

### §tool-cards — Plan (plan-approval)

| Test | Status | Description | data-testids |
|---|---|---|---|
| an approved plan renders the PlanBubble ("Implementing plan") in the transcript | active | An approved plan renders the PlanBubble ("Implementing plan") in the transcript. | `chat-permission-deny`, `chat-permission-gate`, `chat-plan-approve`, `chat-plan-bubble`, `chat-plan-card`, `chat-plan-gate` |
| a rejected plan (keep-planning → feedback) echoes the feedback as a user message and leaves the first PlanCard resultless | active | A rejected plan (keep-planning → feedback) echoes the feedback as a user message and leaves the first PlanCard resultless. | `chat-plan-body`, `chat-plan-card`, `chat-plan-feedback-input`, `chat-plan-gate`, `chat-plan-keep-planning`, `chat-plan-label`, `chat-plan-reject`, `chat-plan-send-feedback`, `chat-plan-trigger`, `chat-user-message` |

### §tool-cards — Skill + SkillLoaded (chat-status)

| Test | Status | Description | data-testids |
|---|---|---|---|
| Skill tool call renders the slash-command row; onSkillLoaded renders an expandable system pill | active | Skill tool call renders the slash-command row; onSkillLoaded renders an expandable system pill. | `chat-skill-loaded-pill`, `chat-slash-command-row`, `chat-system-message` |

### §tool-cards — Task subagent (task-subagent)

| Test | Status | Description | data-testids |
|---|---|---|---|
| collapsed by default with agent name/description; expanding renders the nested subagent transcript | active | Collapsed by default with agent name/description; expanding renders the nested subagent transcript. | `chat-bash-card`, `chat-bash-command`, `chat-task-agent`, `chat-task-card`, `chat-task-description`, `chat-task-toggle` |

### §tool-cards — TaskProgress (task-progress)

| Test | Status | Description | data-testids |
|---|---|---|---|
| default-open card shows rows reduced to their latest status | active | Default-open card shows rows reduced to their latest status. | `chat-task-progress-card`, `chat-task-progress-item-completed`, `chat-task-progress-item-in_progress`, `chat-task-progress-item-pending`, `chat-task-progress-toggle` |

### §tool-cards — WebFetch (web-fetch)

| Test | Status | Description | data-testids |
|---|---|---|---|
| collapsed by default; expanding shows the fetched url and a summary body | active | Collapsed by default; expanding shows the fetched url and a summary body. | `web-fetch-card-root`, `web-fetch-card-summary`, `web-fetch-card-trigger`, `web-fetch-card-url` |

### §tool-cards — MCP pill (mcp-tool)

| Test | Status | Description | data-testids |
|---|---|---|---|
| done pill is expandable to ARGUMENTS/RESULT; the errored second call renders the failed variant | active | Done pill is expandable to ARGUMENTS/RESULT; the errored second call renders the failed variant. | `chat-mcp-pill`, `marker-body` |

### §tool-cards — ToolFallback (unregistered-tool)

| Test | Status | Description | data-testids |
|---|---|---|---|
| a tool name absent from TOOL_REGISTRY falls through to the generic card | active | A tool name absent from TOOL_REGISTRY falls through to the generic card. | `chat-tool-fallback-args`, `chat-tool-fallback-card`, `chat-tool-fallback-result`, `chat-tool-fallback-trigger` |

### §tool-cards — Schedule/Cron/Monitor pills (schedule-pills)

| Test | Status | Description | data-testids |
|---|---|---|---|
| Schedule/Cron/Monitor pills (all 5 kinds) | active | Schedule/Cron/Monitor pills (all 5 kinds). | `chat-schedule-croncreate-pill`, `chat-schedule-crondelete-pill`, `chat-schedule-cronlist-pill`, `chat-schedule-monitor-pill`, `chat-schedule-schedulewakeup-pill`, `marker-body` |

### §tool-cards — EnterWorktree / ExitWorktree pills (worktree-pills)

| Test | Status | Description | data-testids |
|---|---|---|---|
| EnterWorktree / ExitWorktree pills | active | EnterWorktree / ExitWorktree pills. | `chat-worktree-enter-pill`, `chat-worktree-exit-pill`, `marker-body` |

### §tool-cards — ToolResultExpand (tool-result-truncated)

| Test | Status | Description | data-testids |
|---|---|---|---|
| ToolResultExpand "Show full output" for a truncated tool result | active | ToolResultExpand "Show full output" for a truncated tool result. | `chat-bash-card`, `chat-bash-output`, `chat-bash-trigger`, `tool-result-expand-toggle` |

### §tool-cards — ToolGroup (tool-group)

| Test | Status | Description | data-testids |
|---|---|---|---|
| ToolGroup — consecutive explore-family tool calls collapse under one header | active | ToolGroup — consecutive explore-family tool calls collapse under one header. | `chat-tool-group`, `chat-tool-group-toggle`, `read-card-root`, `search-card-root`, `tool-group-trigger-count`, `tool-group-trigger-label` |

### §tool-cards — Bash exit-code coloring (bash-exit-code)

| Test | Status | Description | data-testids |
|---|---|---|---|
| Bash card exit-code coloring (ExitLine green/red) and error-bordered card | active | Bash card exit-code coloring (ExitLine green/red) and error-bordered card. | `chat-bash-card`, `chat-bash-output`, `chat-bash-trigger` |

## transcript.spec.ts

### §transcript — thread turn

| Test | Status | Description | data-testids |
|---|---|---|---|
| read-more toggle clamps text over 600 characters and expands/collapses on click | active | Read-more toggle clamps text over 600 characters and expands/collapses on click. | `chat-user-readmore-toggle` |
| assistant reply renders markdown (bold list) and a Bash tool card | active | Assistant reply renders markdown (bold list) and a Bash tool card. | `chat-assistant-message`, `chat-bash-card` |
| assistant message action bar: copy sets the copied state, More exports Markdown, timestamp renders | active | Assistant message action bar: copy sets the copied state, More exports Markdown, timestamp renders. | `chat-assistant-message`, `chat-message-copy`, `chat-message-export`, `chat-message-more`, `chat-message-timestamp` |
| assistant message action bar: timing pill shows total duration on hover | active | Assistant message action bar: timing pill shows total duration on hover. | `chat-assistant-message`, `chat-message-timing` |
| scroll-to-bottom button appears when scrolled up and returns to the tail on click | active | Scroll-to-bottom button appears when scrolled up and returns to the tail on click. | `chat-scroll-to-bottom`, `chat-thread-viewport` |
| find-in-chat (⌘F): opens, counts matches, cycles with Enter/Shift+Enter, closes with Escape | active | Find-in-chat (⌘F): opens, counts matches, cycles with Enter/Shift+Enter, closes with Escape. | `find-bar`, `thread-find-input` |

### §transcript — code block

| Test | Status | Description | data-testids |
|---|---|---|---|
| fenced code block renders a language label and a working copy button | active | Fenced code block renders a language label and a working copy button. | `chat-code-copy` |

### §transcript — compaction pill

| Test | Status | Description | data-testids |
|---|---|---|---|
| system message renders the compaction pill after a compaction event | active | System message renders the compaction pill after a compaction event. | `chat-compaction-pill` |

### §transcript — no fixture / not deterministically reachable

| Test | Status | Description | data-testids |
|---|---|---|---|
| slash-command message renders the pill variant | skip — TODO(recording): the pill only renders when server metadata carries `command.name`, which core's convertUserContent() derives ONLY from a raw transcript t... | Slash-command message renders the pill variant. | — |
| assistant link right-click menu offers Copy link / Open link | skip — TODO(recording): none of the committed fixtures/recordings/*.ndjson assistant replies contain a markdown link (`](http...)`); | Assistant link right-click menu offers Copy link / Open link. | — |
| a failed send shows "Failed to send" + Retry | skip — TODO(recording): meta.error (chat-user-message-send-failed / -retry) is only set via the controller's `local.message.failed` action, which fires from exac... | A failed send shows "Failed to send" + Retry. | — |
| a load failure shows the load-error banner with Retry | skip — TODO(fixture): ChatManager.getMessages() (packages/core/src/chat/ chat-manager.ts) is deliberately best-effort — it catches any history-load failure (mi... | A load failure shows the load-error banner with Retry. | — |

## viewers.spec.ts

### §viewers

| Test | Status | Description | data-testids |
|---|---|---|---|
| image opens in Fit mode by default with zoom controls disabled | active | Image opens in Fit mode by default with zoom controls disabled. | `file-tree-row-image.png`, `viewer-image`, `viewer-image-actual-toggle`, `viewer-image-fit-toggle`, `viewer-image-zoom-in`, `viewer-image-zoom-out`, `viewer-shell-status` |
| switching to 100% enables zoom in/out and updates the displayed zoom level | active | Switching to 100% enables zoom in/out and updates the displayed zoom level. | `viewer-image-actual-toggle`, `viewer-image-fit-toggle`, `viewer-image-zoom-in`, `viewer-image-zoom-out` |
| svg opens in Preview mode by default; Code toggle shows the raw source | active | Svg opens in Preview mode by default; Code toggle shows the raw source. | `file-tree-row-shape.svg`, `viewer-shell-status`, `viewer-svg`, `viewer-svg-preview-toggle`, `viewer-svg-source`, `viewer-svg-source-toggle` |
| csv renders a sortable table with the seeded headers and rows in file order | active | Csv renders a sortable table with the seeded headers and rows in file order. | `file-tree-row-data.csv`, `viewer-csv`, `viewer-csv-header-age`, `viewer-csv-header-name`, `viewer-shell-status` |
| filter input narrows rows; an unmatched query shows the empty-filter row | active | Filter input narrows rows; an unmatched query shows the empty-filter row. | `viewer-csv`, `viewer-csv-empty`, `viewer-csv-filter` |
| clicking a column header cycles sort asc → desc → off | active | Clicking a column header cycles sort asc → desc → off. | `viewer-csv`, `viewer-csv-filter`, `viewer-csv-header-age` |
| pdf embed mounts and the open-externally button reflects the local-daemon reality | active | Pdf embed mounts and the open-externally button reflects the local-daemon reality. | `file-tree-row-doc.pdf`, `viewer-pdf`, `viewer-pdf-fallback`, `viewer-shell-status` |
| unsupported binary shows the no-preview card; open-externally + reveal-in-tree work | skip — ── Unsupported viewer — BLOCKED, see header comment ──────────────────── | Unsupported binary shows the no-preview card; open-externally + reveal-in-tree work. | — |
| markdown file opens in Preview mode by default | active | Markdown file opens in Preview mode by default. | `editor-code`, `file-tree-row-notes.md`, `markdown-mode-preview`, `markdown-preview` |
| the viewer shell reveal button highlights the open file in the file tree | active | The viewer shell reveal button highlights the open file in the file tree. | `file-tree-row-image.png`, `inspector-tab-files`, `viewer-shell`, `viewer-shell-reveal` |

## window-states.spec.ts

### §window-states Toasts

| Test | Status | Description | data-testids |
|---|---|---|---|
| a real add-project success flow shows the success status chip variant + description | active | A real add-project success flow shows the success status chip variant + description. | `toast-root`, `toast-status-chip` |
| the auto-dismiss countdown rail hides on hover and reappears on mouse leave | active | The auto-dismiss countdown rail hides on hover and reappears on mouse leave. | `toast-countdown-rail`, `toast-root` |
| the dismiss button removes the toast | active | The dismiss button removes the toast. | `toast-dismiss`, `toast-root` |
| error toast does not auto-dismiss | skip — TODO(app-tauri): no UI-reachable path makes POST /api/projects fail non-409; | Error toast does not auto-dismiss. | — |

### §window-states First-run tour

| Test | Status | Description | data-testids |
|---|---|---|---|
| auto-opens ~1.5s after settle on an empty-sessions workspace | active | Auto-opens ~1.5s after settle on an empty-sessions workspace. | `tour-label-card`, `tour-overlay` |
| Next/Back walk the reachable steps, auto-skipping the anchorless model step; Done completes the tour | active | Next/Back walk the reachable steps, auto-skipping the anchorless model step; Done completes the tour. | `tour-back-btn`, `tour-label-card`, `tour-next-btn`, `tour-overlay`, `tour-spotlight`, `tour-step-dot-0`, `tour-step-dot-1`, `tour-step-dot-2`, `tour-step-dot-3` |
| Skip dismisses the tour permanently across reload | active | Skip dismisses the tour permanently across reload. | `tour-overlay`, `tour-skip-btn` |

### §window-states Connection overlay

| Test | Status | Description | data-testids |
|---|---|---|---|
| a local daemon health outage shows the reconnect overlay; recovery hides it | active | A local daemon health outage shows the reconnect overlay; recovery hides it. | `connection-overlay` |

### §window-states ErrorState

| Test | Status | Description | data-testids |
|---|---|---|---|
| MfErrorBoundary renders ErrorState on a render crash | skip — TODO(app-tauri): no deliberate crash route exists to trip MfErrorBoundary from e2e; | MfErrorBoundary renders ErrorState on a render crash. | — |

## workflows.spec.ts

### §workflows Library

| Test | Status | Description | data-testids |
|---|---|---|---|
| scope tabs filter workflows by All / This project / Global | active | Scope tabs filter workflows by All / This project / Global. | `workflows-library-row-*`, `workflows-library-scope-all`, `workflows-library-scope-global`, `workflows-library-scope-project` |
| New workflow opens a blank editor in split mode | active | New workflow opens a blank editor in split mode. | `workflows-builder`, `workflows-builder-description`, `workflows-builder-name`, `workflows-editor`, `workflows-editor-yaml`, `workflows-library-new` |
| Cancel discards the draft and returns to the library with no new row | active | Cancel discards the draft and returns to the library with no new row. | `workflows-builder-name`, `workflows-editor`, `workflows-editor-cancel`, `workflows-library`, `workflows-library-row-global:cancelled-draft` |
| the header Close button also discards an in-progress draft | active | The header Close button also discards an in-progress draft. | `workflows-builder-name`, `workflows-editor`, `workflows-editor-close`, `workflows-library-new`, `workflows-library-row-global:closed-draft` |

### §workflows Editor

| Test | Status | Description | data-testids |
|---|---|---|---|
| builder edits (name, description, scope, a step, a trigger, an output) round-trip live into the YAML pane | active | Builder edits (name, description, scope, a step, a trigger, an output) round-trip live into the YAML pane. | `workflows-builder-add-output`, `workflows-builder-add-step`, `workflows-builder-add-trigger`, `workflows-builder-description`, `workflows-builder-name`, `workflows-builder-scope-project`, `workflows-editor`, `workflows-editor-yaml`, `workflows-library-new`, `workflows-steplib`, `workflows-steplib-set` |
| a builder-built workflow with a name and one step becomes savable and appears in the library | active | A builder-built workflow with a name and one step becomes savable and appears in the library. | `workflows-builder-add-step`, `workflows-builder-name`, `workflows-builder-scope-global`, `workflows-editor`, `workflows-editor-cancel`, `workflows-editor-save`, `workflows-editor-validation-error`, `workflows-library`, `workflows-library-new`, `workflows-library-row-global:my-safe-flow`, `workflows-steplib`, `workflows-steplib-set` |
| an invalid `name:` fails schema parsing and surfaces via workflows-editor-validation-error | active | An invalid `name:` fails schema parsing and surfaces via workflows-editor-validation-error. | `workflows-editor`, `workflows-editor-mode-yaml`, `workflows-editor-save`, `workflows-editor-validation-error`, `workflows-editor-yaml`, `workflows-library-new` |
| a dangling output reference in YAML mode surfaces a real validation error and blocks save | active | A dangling output reference in YAML mode surfaces a real validation error and blocks save. | `workflows-editor`, `workflows-editor-cancel`, `workflows-editor-mode-yaml`, `workflows-editor-save`, `workflows-editor-yaml`, `workflows-library-new` |

### §workflows Runs

| Test | Status | Description | data-testids |
|---|---|---|---|
| the library shows zero runs before anything has been started | active | The library shows zero runs before anything has been started. | `workflows-nav-runs`, `workflows-run-row-*`, `workflows-runs-filter-all` |
| running the "set" workflow from the library navigates to a succeeding run detail | active | Running the "set" workflow from the library navigates to a succeeding run detail. | `workflows-library-row-*`, `workflows-library-run-*`, `workflows-nav-library`, `workflows-run-back`, `workflows-step-steps.0` |
| runs filter tabs show the completed run under "Done" and hide it under "Waiting" | skip — (packages/ui/.../use-workflows-store.ts + possibly packages/core). | Runs filter tabs show the completed run under "Done" and hide it under "Waiting". | `workflows-nav-runs`, `workflows-run-back`, `workflows-run-row-*`, `workflows-runs-filter-all`, `workflows-runs-filter-succeeded`, `workflows-runs-filter-waiting` |

### §workflows Needs you

| Test | Status | Description | data-testids |
|---|---|---|---|
| the needs-you section lists the pending interaction, expanded by default, with its answer field | active | The needs-you section lists the pending interaction, expanded by default, with its answer field. | `sidebar-workflows-button`, `workflows-field-answer`, `workflows-needsyou` |
| View run opens the paused run's detail showing a Waiting step, Back returns to the needs list | active | View run opens the paused run's detail showing a Waiting step, Back returns to the needs list. | `workflows-interaction-viewrun-*`, `workflows-needsyou`, `workflows-run-back`, `workflows-step-steps.0` |
| submitting the answer resolves the interaction and clears the needs-you list | skip — this spec (packages/ui/.../WfAnswerForm.tsx + WfInteractionCard.tsx). | Submitting the answer resolves the interaction and clears the needs-you list. | `workflows-answer-submit`, `workflows-field-answer`, `workflows-interaction-answer-*`, `workflows-needsyou-empty` |
| the run detail shows the step as Done with the submitted answer after resolution | skip — this run, so this run never resolves to 'succeeded' for THIS test to find). | The run detail shows the step as Done with the submitted answer after resolution. | `workflows-nav-runs`, `workflows-run-row-*`, `workflows-step-steps.0` |

# Part 2 — data-testid Coverage

**Universe:** 714 static testids/prefixes found in `packages/ui/src` (excluding `__tests__`). 528 (73.9%) referenced by at least one e2e test; 186 untested. 35 additional prop-forwarded/dynamic testid sites (e.g. `data-testid={testId}`, or fully-parameterized templates like ``${prefix}-${id}`` with no static anchor) were excluded from the universe — they can't be resolved to a literal without tracing every call site.

**Top 10 most-referenced:** `sessions-row` (47), `file-tree-row-*` (32), `files-tab-*` (24), `editor-code` (20), `*-option-*` (19), `*-cancel` (18), `chat-composer-input` (17), `files-tab-strip` (17), `tasks-list-row-*` (14), `chat-permission-gate` (13).

### Coverage gap map (sorted ascending by test-reference count — untested testids first)

| data-testid | defined in | # tests referencing |
|---|---|---|
| `*-option-inherit` | packages/ui/src/features/settings/panes/providers/CodexTuningDefaults.tsx | 0 |
| `chat-ask-answer-notes` | packages/ui/src/features/chat/tools/cards/AskUserQuestionCard.tsx | 0 |
| `chat-ask-answer-preview` | packages/ui/src/features/chat/tools/cards/AskUserQuestionCard.tsx | 0 |
| `chat-ask-question-text` | packages/ui/src/features/chat/tools/cards/AskUserQuestionCard.tsx | 0 |
| `chat-ask-trigger` | packages/ui/src/features/chat/tools/cards/AskUserQuestionCard.tsx | 0 |
| `chat-capture-selector` | packages/ui/src/features/chat/messages/UserAttachments.tsx | 0 |
| `chat-composer-cancel` | packages/ui/src/features/chat/composer/Composer.tsx | 0 |
| `chat-composer-edit-cancel` | packages/ui/src/features/chat/composer/edit/ComposerEditMode.tsx | 0 |
| `chat-composer-edit-save` | packages/ui/src/features/chat/composer/edit/ComposerEditMode.tsx | 0 |
| `chat-composer-edit-toolbar` | packages/ui/src/features/chat/composer/edit/ComposerEditMode.tsx | 0 |
| `chat-composer-toolbar` | packages/ui/src/features/chat/composer/Composer.tsx; packages/ui/src/features/chat/composer/config-toolbar/ComposerToolbar.tsx | 0 |
| `chat-edit-error-text` | packages/ui/src/features/chat/tools/cards/EditFileCard.tsx | 0 |
| `chat-error-block` | packages/ui/src/features/chat/messages/AssistantErrorBlock.tsx | 0 |
| `chat-header-pr-*` | packages/ui/src/features/chat/thread/ChatCardHeader.tsx | 0 |
| `chat-image-zoom-dialog` | packages/ui/src/features/chat/parts/ZoomableImage.tsx | 0 |
| `chat-image-zoom-trigger` | packages/ui/src/features/chat/messages/InlineImageThumbs.tsx; packages/ui/src/features/chat/parts/ZoomableImage.tsx | 0 |
| `chat-link-copy` | packages/ui/src/features/chat/parts/markdown-text.tsx | 0 |
| `chat-link-copy-url` | packages/ui/src/features/chat/parts/markdown-text.tsx | 0 |
| `chat-link-open` | packages/ui/src/features/chat/parts/markdown-text.tsx | 0 |
| `chat-plan-revise-cancel` | packages/ui/src/features/chat/gates/PlanGate.tsx | 0 |
| `chat-question-text` | packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx | 0 |
| `chat-reasoning-toggle` | packages/ui/src/components/ui/assistant-ui/reasoning.tsx | 0 |
| `chat-slash-command-args` | packages/ui/src/features/chat/tools/cards/SlashCommandCard.tsx | 0 |
| `chat-thread-area` | packages/ui/src/layout/SurfaceHost.tsx | 0 |
| `chat-thread-load-error` | packages/ui/src/features/chat/thread/ChatThread.tsx | 0 |
| `chat-thread-load-retry` | packages/ui/src/features/chat/thread/ChatThread.tsx | 0 |
| `chat-thread-running-text` | packages/ui/src/features/chat/thread/ChatThread.tsx | 0 |
| `chat-tool-fallback-error` | packages/ui/src/components/ui/assistant-ui/tool-fallback-parts.tsx | 0 |
| `chat-user-attachment-*` | packages/ui/src/features/chat/messages/UserAttachments.tsx | 0 |
| `chat-user-attachments` | packages/ui/src/features/chat/messages/UserAttachments.tsx | 0 |
| `chat-user-message-retry` | packages/ui/src/features/chat/messages/UserMessage.tsx | 0 |
| `chat-user-message-send-failed` | packages/ui/src/features/chat/messages/UserMessage.tsx | 0 |
| `chat-user-snippet-expand-*` | packages/ui/src/features/chat/messages/code-snippet.tsx | 0 |
| `chat-user-snippet-scroll-*` | packages/ui/src/features/chat/messages/code-snippet.tsx | 0 |
| `chat-write-error-text` | packages/ui/src/features/chat/tools/cards/WriteFileCard.tsx | 0 |
| `composer-attachments` | packages/ui/src/features/chat/composer/Composer.tsx | 0 |
| `composer-dropzone` | packages/ui/src/features/chat/composer/Composer.tsx | 0 |
| `composer-features-popover` | packages/ui/src/features/chat/composer/config-toolbar/FeaturesPopover.tsx | 0 |
| `composer-worktree-base-branch-list` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeNewForm.tsx | 0 |
| `composer-worktree-base-branch-option-*` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeNewForm.tsx | 0 |
| `daemon-add-retry` | packages/ui/src/features/daemon/pairing-steps.tsx | 0 |
| `daemon-picker-fallback` | packages/ui/src/features/daemon/DaemonPicker.tsx | 0 |
| `daemon-repair-confirm` | packages/ui/src/features/daemon/RepairPrompt.tsx | 0 |
| `daemon-repair-prompt` | packages/ui/src/features/daemon/RepairPrompt.tsx | 0 |
| `daemon-repair-switchlocal` | packages/ui/src/features/daemon/RepairPrompt.tsx | 0 |
| `daemon-row-*-manage` | packages/ui/src/features/daemon/DaemonRow.tsx | 0 |
| `daemon-row-*-remove` | packages/ui/src/features/daemon/DaemonRow.tsx | 0 |
| `daemon-row-*-rename` | packages/ui/src/features/daemon/DaemonRow.tsx | 0 |
| `daemon-row-*-repair` | packages/ui/src/features/daemon/DaemonRow.tsx | 0 |
| `dialog-close` | packages/ui/src/components/ui/dialog.tsx | 0 |
| `directory-picker-load-error-*` | packages/ui/src/components/overlays/directory-picker/PickerTree.tsx | 0 |
| `directory-picker-node-loading-*` | packages/ui/src/components/overlays/directory-picker/PickerTree.tsx | 0 |
| `editor-comment-widget` | packages/ui/src/features/editor/inline-comments/InlineCommentWidget.tsx | 0 |
| `editor-comment-widget-send` | packages/ui/src/features/editor/inline-comments/InlineCommentWidget.tsx | 0 |
| `editor-context-menu` | packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx | 0 |
| `editor-references-panel` | packages/ui/src/features/editor/lsp/references-panel.tsx | 0 |
| `editor-references-panel-close` | packages/ui/src/features/editor/lsp/references-panel.tsx | 0 |
| `editor-references-row-<path>:<line>` | packages/ui/src/features/editor/lsp/references-panel.tsx | 0 |
| `editor-tab` | packages/ui/src/features/editor/EditorTab.tsx | 0 |
| `editor-tab-readonly` | packages/ui/src/features/editor/EditorTab.tsx | 0 |
| `error-state-copy` | packages/ui/src/features/shared/ErrorState.tsx | 0 |
| `error-state-reload` | packages/ui/src/features/shared/ErrorState.tsx | 0 |
| `error-state-retry` | packages/ui/src/features/shared/ErrorState.tsx | 0 |
| `error-state-root` | packages/ui/src/features/shared/ErrorState.tsx | 0 |
| `external-session-branch` | packages/ui/src/features/sessions/sidebar/ExternalSessionRow.tsx | 0 |
| `external-session-worktree` | packages/ui/src/features/sessions/sidebar/ExternalSessionRow.tsx | 0 |
| `file-picker-loading` | packages/ui/src/features/files/FilePickerDialog.tsx | 0 |
| `files-surface-drag` | packages/ui/src/layout/FilesTabStrip.tsx | 0 |
| `files-tab-close-*` | packages/ui/src/layout/FilesTabStrip.tsx | 0 |
| `files-tab-strip-split-right` | packages/ui/src/layout/FilesTabStrip.tsx | 0 |
| `find-in-path-error` | packages/ui/src/components/overlays/FindInPathModal.tsx | 0 |
| `gate-head-tile` | packages/ui/src/features/chat/gates/shared/GateShell.tsx | 0 |
| `git-branch-group-toggle-*` | packages/ui/src/features/git/BranchGroupSection.tsx | 0 |
| `git-branch-section-toggle-*` | packages/ui/src/features/git/BranchGroupSection.tsx | 0 |
| `git-new-branch-back` | packages/ui/src/features/git/NewBranchDialog.tsx | 0 |
| `git-new-branch-cancel` | packages/ui/src/features/git/NewBranchDialog.tsx | 0 |
| `git-rename-back` | packages/ui/src/features/git/RenameBranchView.tsx | 0 |
| `git-rename-cancel` | packages/ui/src/features/git/RenameBranchView.tsx | 0 |
| `git-submenu` | packages/ui/src/features/git/BranchSubmenu.tsx | 0 |
| `image-lightbox-counter` | packages/ui/src/features/chat/parts/ImageLightbox.tsx | 0 |
| `image-lightbox-current` | packages/ui/src/features/chat/parts/ImageLightbox.tsx | 0 |
| `image-lightbox-next` | packages/ui/src/features/chat/parts/ImageLightbox.tsx | 0 |
| `image-lightbox-prev` | packages/ui/src/features/chat/parts/ImageLightbox.tsx | 0 |
| `main-surface-shell` | packages/ui/src/app/AppShell.tsx | 0 |
| `main-toolbar` | packages/ui/src/layout/MainToolbar.tsx | 0 |
| `main-toolbar-launch-config-*` | packages/ui/src/features/run/ToolbarLaunchControls.tsx | 0 |
| `main-toolbar-launch-generate` | packages/ui/src/features/run/ToolbarLaunchControls.tsx | 0 |
| `main-toolbar-launch-popover` | packages/ui/src/features/run/ToolbarLaunchControls.tsx | 0 |
| `main-toolbar-play` | packages/ui/src/features/run/ToolbarLaunchControls.tsx | 0 |
| `main-toolbar-search` | packages/ui/src/layout/MainToolbar.tsx | 0 |
| `main-toolbar-search-hint` | packages/ui/src/layout/MainToolbar.tsx | 0 |
| `main-toolbar-theme` | packages/ui/src/layout/MainToolbar.tsx | 0 |
| `named-tunnel-clear-config` | packages/ui/src/features/settings/panes/remote-access/NamedTunnelSection.tsx | 0 |
| `named-tunnel-toggle` | packages/ui/src/features/settings/panes/remote-access/NamedTunnelSection.tsx | 0 |
| `pairing-generate-code` | packages/ui/src/features/settings/panes/remote-access/PairingSection.tsx | 0 |
| `pairing-regenerate-code` | packages/ui/src/features/settings/panes/remote-access/PairingSection.tsx | 0 |
| `preview-annotation-backdrop` | packages/ui/src/features/preview/PreviewInstance.tsx | 0 |
| `preview-annotation-cancel` | packages/ui/src/features/preview/CaptureAnnotationPopover.tsx | 0 |
| `preview-annotation-input-*` | packages/ui/src/features/preview/CaptureAnnotationPopover.tsx | 0 |
| `preview-annotation-item-*` | packages/ui/src/features/preview/CaptureAnnotationPopover.tsx | 0 |
| `preview-annotation-list` | packages/ui/src/features/preview/CaptureAnnotationPopover.tsx | 0 |
| `preview-annotation-popover` | packages/ui/src/features/preview/CaptureAnnotationPopover.tsx | 0 |
| `preview-annotation-submit` | packages/ui/src/features/preview/CaptureAnnotationPopover.tsx | 0 |
| `preview-body-tunnel-failed` | packages/ui/src/features/preview/PreviewBodyState.tsx | 0 |
| `preview-device-toggle` | packages/ui/src/features/preview/PreviewDeviceToggle.tsx | 0 |
| `preview-instance-*` | packages/ui/src/features/preview/PreviewInstance.tsx | 0 |
| `preview-tunnel-pending` | packages/ui/src/features/preview/PreviewBodyState.tsx | 0 |
| `remote-access-device-remove-*` | packages/ui/src/features/settings/panes/remote-access/DevicesSection.tsx | 0 |
| `review-commit-error` | packages/ui/src/features/review/ReviewCommitRail.tsx | 0 |
| `review-file-tree-empty` | packages/ui/src/features/review/ReviewFileTree.tsx | 0 |
| `review-load-error` | packages/ui/src/features/review/ReviewPanel.tsx | 0 |
| `run-console-clear` | packages/ui/src/features/run/ConsolePane.tsx | 0 |
| `run-console-drawer` | packages/ui/src/features/run/ConsolePane.tsx | 0 |
| `run-console-drawer-toggle` | packages/ui/src/features/run/ConsolePane.tsx | 0 |
| `run-console-log-area` | packages/ui/src/features/run/ConsolePane.tsx | 0 |
| `run-console-resize` | packages/ui/src/features/run/ConsolePane.tsx | 0 |
| `run-surface-drag` | packages/ui/src/layout/RunTabStrip.tsx | 0 |
| `run-terminal-*` | packages/ui/src/features/terminal/TerminalInstance.tsx | 0 |
| `search-card-path` | packages/ui/src/features/chat/tools/cards/SearchCard.tsx | 0 |
| `search-card-plain-body` | packages/ui/src/features/chat/tools/cards/SearchCard.tsx | 0 |
| `search-palette-footer` | packages/ui/src/features/palette/SpotlightPalette.tsx | 0 |
| `search-palette-loading` | packages/ui/src/features/palette/SpotlightPalette.tsx | 0 |
| `sessions-archive-cancel` | packages/ui/src/features/sessions/sidebar/ArchiveWorktreeDialog.tsx | 0 |
| `sessions-draft-row-title` | packages/ui/src/features/sessions/sidebar/DraftSessionRow.tsx | 0 |
| `sessions-import-back` | packages/ui/src/features/sessions/sidebar/ImportSessionsDialog.tsx | 0 |
| `sessions-list-scroll` | packages/ui/src/features/sessions/sidebar/SessionListVirtuoso.tsx; packages/ui/src/features/sessions/sidebar/SessionSidebar.tsx | 0 |
| `sessions-new-picker-add-project` | packages/ui/src/features/sessions/sidebar/NewSessionPickerPopover.tsx | 0 |
| `sessions-projects-more` | packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx | 0 |
| `sessions-row-meta-pr` | packages/ui/src/features/sessions/sidebar/SessionRowMeta.tsx | 0 |
| `sessions-row-meta-tag-dots` | packages/ui/src/features/sessions/sidebar/SessionRowMeta.tsx | 0 |
| `sessions-row-pin-glyph` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 0 |
| `sessions-sidebar-content-frame` | packages/ui/src/layout/SidebarShell.tsx | 0 |
| `sessions-tag-popover-error` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 0 |
| `sessions-tag-popover-name-error` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 0 |
| `settings-*-default-effort-option-inherit` | packages/ui/src/features/settings/panes/providers/ProviderTuningDefaults.tsx | 0 |
| `settings-*-default-feature-*` | packages/ui/src/features/settings/panes/providers/ProviderTuningDefaults.tsx | 0 |
| `settings-config-conflicts-warning` | packages/ui/src/features/settings/panes/providers/ConfigConflictsWarning.tsx | 0 |
| `sidebar-bottom-panel` | packages/ui/src/features/context-panel/BottomPanel.tsx | 0 |
| `sidebar-bottom-resize` | packages/ui/src/features/context-panel/PanelResizeHandle.tsx | 0 |
| `sidebar-bottom-tab-track` | packages/ui/src/features/context-panel/BottomPanel.tsx | 0 |
| `sidebar-collapse-handle` | packages/ui/src/layout/SidebarCollapseHandle.tsx | 0 |
| `sidebar-collapse-indicator` | packages/ui/src/layout/SidebarCollapseHandle.tsx | 0 |
| `sidebar-footer` | packages/ui/src/layout/SidebarFooter.tsx | 0 |
| `sidebar-footer-counts` | packages/ui/src/layout/SidebarFooter.tsx | 0 |
| `sidebar-header` | packages/ui/src/layout/SidebarHeader.tsx | 0 |
| `sidebar-update-pill` | packages/ui/src/layout/UpdatePill.tsx | 0 |
| `surface-rail` | packages/ui/src/layout/SurfaceRail.tsx | 0 |
| `tasks-attach-zoom-*` | packages/ui/src/features/tasks/TaskAttachments.tsx | 0 |
| `tasks-board-loading` | packages/ui/src/features/tasks/TasksBoard.tsx | 0 |
| `tasks-column-*-empty` | packages/ui/src/features/tasks/TaskColumn.tsx | 0 |
| `tasks-column-${status}` | packages/ui/src/features/tasks/TaskColumn.tsx | 0 |
| `tasks-drawer-label` | packages/ui/src/features/tasks/TasksDrawer.tsx | 0 |
| `tasks-edit-body` | packages/ui/src/features/tasks/TaskEditModal.tsx | 0 |
| `tasks-edit-priority` | packages/ui/src/features/tasks/TaskSelectFields.tsx | 0 |
| `tasks-edit-status` | packages/ui/src/features/tasks/TaskSelectFields.tsx | 0 |
| `tasks-edit-type` | packages/ui/src/features/tasks/TaskSelectFields.tsx | 0 |
| `tasks-priority-dot-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 0 |
| `thread-find-close` | packages/ui/src/features/chat/find/FindBar.tsx | 0 |
| `thread-find-next` | packages/ui/src/features/chat/find/FindBar.tsx | 0 |
| `thread-find-prev` | packages/ui/src/features/chat/find/FindBar.tsx | 0 |
| `toast-action` | packages/ui/src/components/ui/ws-toast.tsx | 0 |
| `toast-open-session` | packages/ui/src/components/ui/ws-toast.tsx | 0 |
| `tool-card-status-dot` | packages/ui/src/features/chat/tools/shared/chrome.tsx | 0 |
| `tool-result-expand-collapse` | packages/ui/src/features/chat/tools/ToolResultExpand.tsx | 0 |
| `tunnel-recheck-verify` | packages/ui/src/features/settings/panes/remote-access/TunnelStatusRow.tsx | 0 |
| `viewer-unsupported` | packages/ui/src/features/viewers/UnsupportedViewer.tsx | 0 |
| `viewer-unsupported-card` | packages/ui/src/features/viewers/UnsupportedViewer.tsx | 0 |
| `viewer-unsupported-icon-chip` | packages/ui/src/features/viewers/UnsupportedViewer.tsx | 0 |
| `viewer-unsupported-open` | packages/ui/src/features/viewers/UnsupportedViewer.tsx | 0 |
| `viewer-unsupported-reveal` | packages/ui/src/features/viewers/UnsupportedViewer.tsx | 0 |
| `workflows-builder-step-*` | packages/ui/src/features/workflows/editor/WfbStepRow.tsx | 0 |
| `workflows-builder-step-configure-*` | packages/ui/src/features/workflows/editor/WfbStepRow.tsx | 0 |
| `workflows-builder-step-remove-*` | packages/ui/src/features/workflows/editor/WfbStepRow.tsx | 0 |
| `workflows-builder-step-title-*` | packages/ui/src/features/workflows/editor/WfbStepRow.tsx | 0 |
| `workflows-iter-*` | packages/ui/src/features/workflows/WfTree.tsx | 0 |
| `workflows-library-edit-*` | packages/ui/src/features/workflows/WfLibrary.tsx | 0 |
| `workflows-run-banner` | packages/ui/src/features/workflows/WfRunDetail.tsx | 0 |
| `workflows-run-banner-cta` | packages/ui/src/features/workflows/WfRunDetail.tsx | 0 |
| `workflows-run-cancel` | packages/ui/src/features/workflows/WfRunDetail.tsx | 0 |
| `workflows-run-parent-link` | packages/ui/src/features/workflows/WfRunDetail.tsx | 0 |
| `workflows-step-*-pip` | packages/ui/src/features/workflows/WfStepNode.tsx | 0 |
| `workflows-step-*-retry` | packages/ui/src/features/workflows/WfStepNode.tsx | 0 |
| `workflows-step-chat-*` | packages/ui/src/features/workflows/WfStepNode.tsx | 0 |
| `workflows-subflow-*` | packages/ui/src/features/workflows/WfTree.tsx | 0 |
| `workflows-title-count` | packages/ui/src/features/workflows/WorkflowsView.tsx | 0 |
| `workflows-view` | packages/ui/src/features/workflows/WorkflowsView.tsx | 0 |
| `archived-session-item` | packages/ui/src/features/sessions/sidebar/ArchivedSessionsDialog.tsx | 1 |
| `changes-mode-*` | packages/ui/src/features/files/ChangesPanel.tsx | 1 |
| `chat-ask-body` | packages/ui/src/features/chat/tools/cards/AskUserQuestionCard.tsx | 1 |
| `chat-ask-card` | packages/ui/src/features/chat/tools/cards/AskUserQuestionCard.tsx | 1 |
| `chat-ask-header` | packages/ui/src/features/chat/tools/cards/AskUserQuestionCard.tsx | 1 |
| `chat-bash-description` | packages/ui/src/features/chat/tools/cards/BashCard.tsx | 1 |
| `chat-code-copy` | packages/ui/src/features/chat/parts/CodeHeader.tsx | 1 |
| `chat-compaction-pill` | packages/ui/src/features/chat/messages/SystemMessage.tsx | 1 |
| `chat-composer` | packages/ui/src/features/chat/composer/Composer.tsx | 1 |
| `chat-composer-worktree-missing` | packages/ui/src/features/chat/composer/Composer.tsx | 1 |
| `chat-header-context-pct` | packages/ui/src/features/chat/thread/ChatSessionInline.tsx | 1 |
| `chat-header-model` | packages/ui/src/features/chat/thread/ChatSessionInline.tsx | 1 |
| `chat-header-project` | packages/ui/src/features/chat/thread/ChatCardHeader.tsx | 1 |
| `chat-header-split-down` | packages/ui/src/features/chat/thread/ChatCardHeader.tsx | 1 |
| `chat-message-copy` | packages/ui/src/features/chat/messages/MessageActionBar.tsx | 1 |
| `chat-message-export` | packages/ui/src/features/chat/messages/MessageActionBar.tsx | 1 |
| `chat-message-more` | packages/ui/src/features/chat/messages/MessageActionBar.tsx | 1 |
| `chat-message-timestamp` | packages/ui/src/features/chat/messages/MessageTimestamp.tsx | 1 |
| `chat-message-timing` | packages/ui/src/features/chat/messages/MessageTiming.tsx | 1 |
| `chat-permission-details-pre` | packages/ui/src/features/chat/gates/PermissionGate.tsx | 1 |
| `chat-permission-details-toggle` | packages/ui/src/features/chat/gates/PermissionGate.tsx | 1 |
| `chat-plan-body` | packages/ui/src/features/chat/tools/cards/PlanCard.tsx | 1 |
| `chat-plan-bubble` | packages/ui/src/features/chat/messages/PlanBubble.tsx | 1 |
| `chat-plan-clear-context` | packages/ui/src/features/chat/gates/PlanClearContextCheck.tsx | 1 |
| `chat-plan-execmode-*` | packages/ui/src/features/chat/gates/PlanExecModeControl.tsx | 1 |
| `chat-plan-label` | packages/ui/src/features/chat/tools/cards/PlanCard.tsx | 1 |
| `chat-plan-running-footer` | packages/ui/src/features/chat/gates/PlanGate.tsx | 1 |
| `chat-plan-trigger` | packages/ui/src/features/chat/tools/cards/PlanCard.tsx | 1 |
| `chat-question-back` | packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx | 1 |
| `chat-question-next` | packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx | 1 |
| `chat-question-other-input-*` | packages/ui/src/features/chat/gates/AskQuestionWizard.tsx | 1 |
| `chat-question-skip` | packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx | 1 |
| `chat-scroll-to-bottom` | packages/ui/src/features/chat/thread/ChatThread.tsx | 1 |
| `chat-selection-toolbar` | packages/ui/src/components/ui/assistant-ui/quote.tsx | 1 |
| `chat-skill-loaded-pill` | packages/ui/src/features/chat/tools/cards/SkillLoadedCard.tsx | 1 |
| `chat-slash-command-row` | packages/ui/src/features/chat/tools/cards/SlashCommandCard.tsx | 1 |
| `chat-system-message` | packages/ui/src/features/chat/messages/SystemMessage.tsx | 1 |
| `chat-task-agent` | packages/ui/src/features/chat/tools/cards/TaskCard.tsx | 1 |
| `chat-task-description` | packages/ui/src/features/chat/tools/cards/TaskCard.tsx | 1 |
| `chat-task-progress-card` | packages/ui/src/features/chat/tools/cards/TaskProgressCard.tsx | 1 |
| `chat-task-progress-item-*` | packages/ui/src/features/chat/tools/cards/TaskProgressCard.tsx | 1 |
| `chat-task-progress-toggle` | packages/ui/src/features/chat/tools/cards/TaskProgressCard.tsx | 1 |
| `chat-thread-running` | packages/ui/src/features/chat/thread/ChatThread.tsx | 1 |
| `chat-tool-fallback-args` | packages/ui/src/components/ui/assistant-ui/tool-fallback-parts.tsx | 1 |
| `chat-tool-fallback-card` | packages/ui/src/components/ui/assistant-ui/tool-fallback.tsx | 1 |
| `chat-tool-fallback-result` | packages/ui/src/components/ui/assistant-ui/tool-fallback-parts.tsx | 1 |
| `chat-tool-fallback-trigger` | packages/ui/src/components/ui/assistant-ui/tool-fallback.tsx | 1 |
| `chat-tool-group` | packages/ui/src/features/chat/tools/tool-dispatch.tsx | 1 |
| `chat-tool-group-toggle` | packages/ui/src/features/chat/tools/tool-dispatch.tsx | 1 |
| `composer-add-mention` | packages/ui/src/components/ui/assistant-ui/attachment.tsx | 1 |
| `composer-attachment-remove` | packages/ui/src/components/ui/assistant-ui/attachment.tsx | 1 |
| `composer-plan-toggle` | packages/ui/src/features/chat/composer/config-toolbar/PlanModeToggle.tsx | 1 |
| `composer-prompt-highlight` | packages/ui/src/features/chat/composer/highlight/ComposerHighlight.tsx | 1 |
| `composer-provider-header` | packages/ui/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx | 1 |
| `composer-provider-model-popover` | packages/ui/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx | 1 |
| `composer-worktree-active-info` | packages/ui/src/features/chat/composer/config-toolbar/WorktreePopover.tsx | 1 |
| `composer-worktree-attach-*` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeExistingTab.tsx | 1 |
| `composer-worktree-base-branch` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeNewForm.tsx | 1 |
| `composer-worktree-mid-session-warning` | packages/ui/src/features/chat/composer/config-toolbar/WorktreePopover.tsx | 1 |
| `composer-worktree-tab-existing` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeExistingTab.tsx | 1 |
| `context-task-row-*` | packages/ui/src/features/context-panel/TasksSection.tsx | 1 |
| `context-tasks-progress-fill` | packages/ui/src/features/context-panel/TasksSection.tsx | 1 |
| `context-tasks-section` | packages/ui/src/features/context-panel/TasksSection.tsx | 1 |
| `daemon-add-back` | packages/ui/src/features/daemon/pairing-steps.tsx | 1 |
| `daemon-picker` | packages/ui/src/features/daemon/DaemonPicker.tsx | 1 |
| `daemon-rename-input` | packages/ui/src/features/daemon/DaemonSmallDialog.tsx | 1 |
| `daemon-rename-save` | packages/ui/src/features/daemon/DaemonSmallDialog.tsx | 1 |
| `daemon-row-*-active` | packages/ui/src/features/daemon/DaemonRow.tsx | 1 |
| `daemon-row-*-dot` | packages/ui/src/features/daemon/DaemonRow.tsx | 1 |
| `daemon-unreachable` | packages/ui/src/features/daemon/DaemonUnreachableBody.tsx | 1 |
| `daemon-unreachable-switchlocal` | packages/ui/src/features/daemon/DaemonUnreachableBody.tsx | 1 |
| `directory-picker-empty` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 1 |
| `directory-picker-error` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 1 |
| `directory-picker-loading` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 1 |
| `directory-picker-node-empty-*` | packages/ui/src/components/overlays/directory-picker/PickerTree.tsx | 1 |
| `directory-picker-recent` | packages/ui/src/components/overlays/directory-picker/RecentDirs.tsx | 1 |
| `directory-picker-selected-path` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 1 |
| `editor-comment-widget-cancel` | packages/ui/src/features/editor/inline-comments/InlineCommentWidget.tsx | 1 |
| `editor-comment-widget-snippet` | packages/ui/src/features/editor/inline-comments/InlineCommentWidget.tsx | 1 |
| `editor-context-menu-add-context` | packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx | 1 |
| `editor-context-menu-copy` | packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx | 1 |
| `editor-context-menu-copy-ref` | packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx | 1 |
| `editor-context-menu-find-refs` | packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx | 1 |
| `editor-context-menu-go-to-def` | packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx | 1 |
| `editor-tab-keep-mine` | packages/ui/src/features/editor/EditorTab.tsx | 1 |
| `editor-tab-reload` | packages/ui/src/features/editor/EditorTab.tsx | 1 |
| `file-picker-no-project` | packages/ui/src/features/files/FilePickerDialog.tsx | 1 |
| `file-tree-copy-path` | packages/ui/src/features/files/FileTreeRowMenu.tsx | 1 |
| `file-tree-copy-relative-path` | packages/ui/src/features/files/FileTreeRowMenu.tsx | 1 |
| `file-tree-refresh` | packages/ui/src/features/files/FileTree.tsx | 1 |
| `files-tab-strip-split-down` | packages/ui/src/layout/FilesTabStrip.tsx | 1 |
| `find-bar` | packages/ui/src/features/chat/find/FindBar.tsx | 1 |
| `find-in-path-empty` | packages/ui/src/components/overlays/FindInPathModal.tsx | 1 |
| `find-in-path-hint` | packages/ui/src/components/overlays/FindInPathModal.tsx | 1 |
| `find-in-path-idle-hint` | packages/ui/src/components/overlays/FindInPathModal.tsx | 1 |
| `git-branch-list` | packages/ui/src/features/git/BranchList.tsx | 1 |
| `git-branch-popover` | packages/ui/src/features/git/BranchPopover.tsx | 1 |
| `git-conflict-abort` | packages/ui/src/features/git/ConflictView.tsx | 1 |
| `git-conflict-view` | packages/ui/src/features/git/ConflictView.tsx | 1 |
| `git-fetch` | packages/ui/src/features/git/BranchListView.tsx | 1 |
| `git-new-branch` | packages/ui/src/features/git/BranchListView.tsx | 1 |
| `git-new-branch-start` | packages/ui/src/features/git/NewBranchDialog.tsx | 1 |
| `git-push-current` | packages/ui/src/features/git/BranchListView.tsx | 1 |
| `git-rename-input` | packages/ui/src/features/git/RenameBranchView.tsx | 1 |
| `git-rename-submit` | packages/ui/src/features/git/RenameBranchView.tsx | 1 |
| `git-rename-view` | packages/ui/src/features/git/RenameBranchView.tsx | 1 |
| `git-update-all` | packages/ui/src/features/git/BranchListView.tsx | 1 |
| `git-worktree-delete-*` | packages/ui/src/features/git/WorktreeSection.tsx | 1 |
| `git-worktree-new-session-*` | packages/ui/src/features/git/WorktreeSection.tsx | 1 |
| `git-worktree-toggle-*` | packages/ui/src/features/git/WorktreeSection.tsx | 1 |
| `main-toolbar-branch` | packages/ui/src/layout/MainToolbar.tsx | 1 |
| `named-tunnel-save` | packages/ui/src/features/settings/panes/remote-access/NamedTunnelSection.tsx | 1 |
| `named-tunnel-token-input` | packages/ui/src/features/settings/panes/remote-access/NamedTunnelSection.tsx | 1 |
| `named-tunnel-url-input` | packages/ui/src/features/settings/panes/remote-access/NamedTunnelSection.tsx | 1 |
| `preview-body-failed` | packages/ui/src/features/preview/PreviewBodyState.tsx | 1 |
| `preview-body-stopped` | packages/ui/src/features/preview/PreviewBodyState.tsx | 1 |
| `preview-device-desktop` | packages/ui/src/features/preview/PreviewDeviceToggle.tsx | 1 |
| `preview-device-mobile` | packages/ui/src/features/preview/PreviewDeviceToggle.tsx | 1 |
| `preview-inspect-active-indicator` | packages/ui/src/features/preview/PreviewBodyState.tsx | 1 |
| `preview-toolbar` | packages/ui/src/features/preview/PreviewToolbar.tsx | 1 |
| `quick-tunnel-toggle` | packages/ui/src/features/settings/panes/remote-access/QuickTunnelSection.tsx | 1 |
| `read-card-code-preview` | packages/ui/src/features/chat/tools/cards/ReadFileCard.tsx | 1 |
| `restore-session-btn` | packages/ui/src/features/sessions/sidebar/ArchivedSessionsDialog.tsx | 1 |
| `review-branch-badge` | packages/ui/src/features/review/ReviewPanelHeader.tsx | 1 |
| `review-comment-input` | packages/ui/src/features/review/ReviewDiffView.tsx | 1 |
| `review-comment-selected-line` | packages/ui/src/features/review/ReviewDiffView.tsx | 1 |
| `review-comment-submit` | packages/ui/src/features/review/ReviewDiffView.tsx | 1 |
| `review-commit-cancel` | packages/ui/src/features/review/ReviewCommitRail.tsx | 1 |
| `review-commit-suggestion-*` | packages/ui/src/features/review/ReviewCommitRail.tsx | 1 |
| `review-commit-unviewed-warning` | packages/ui/src/features/review/ReviewCommitRail.tsx | 1 |
| `review-file-counts` | packages/ui/src/features/review/ReviewPanelHeader.tsx | 1 |
| `review-file-stat-*` | packages/ui/src/features/review/ReviewFileTree.tsx | 1 |
| `review-open-in-workspace` | packages/ui/src/features/review/ReviewFileToolbar.tsx | 1 |
| `run-add-menu-*` | packages/ui/src/layout/RunTabStrip.tsx | 1 |
| `run-console-pane` | packages/ui/src/features/run/ConsolePane.tsx | 1 |
| `run-surface-close` | packages/ui/src/layout/RunTabStrip.tsx | 1 |
| `search-palette-empty` | packages/ui/src/features/palette/SpotlightPalette.tsx | 1 |
| `sessions-archive-keep-worktree` | packages/ui/src/features/sessions/sidebar/ArchiveWorktreeDialog.tsx | 1 |
| `sessions-archived-dialog` | packages/ui/src/features/sessions/sidebar/ArchivedSessionsDialog.tsx | 1 |
| `sessions-ctx-archive` | packages/ui/src/features/sessions/sidebar/SessionContextMenu.tsx | 1 |
| `sessions-ctx-rename` | packages/ui/src/features/sessions/sidebar/SessionContextMenu.tsx | 1 |
| `sessions-ctx-tags` | packages/ui/src/features/sessions/sidebar/SessionContextMenu.tsx | 1 |
| `sessions-firstrun` | packages/ui/src/features/sessions/new-thread/FirstRunState.tsx | 1 |
| `sessions-firstrun-add-project` | packages/ui/src/features/sessions/new-thread/FirstRunState.tsx | 1 |
| `sessions-group-pin-glyph` | packages/ui/src/features/sessions/sidebar/SessionGroupHeader.tsx | 1 |
| `sessions-import-retry` | packages/ui/src/features/sessions/sidebar/ImportSessionsDialog.tsx | 1 |
| `sessions-more-archived` | packages/ui/src/features/sessions/sidebar/SessionsMoreMenu.tsx | 1 |
| `sessions-project-rename-*` | packages/ui/src/features/sessions/sidebar/ProjectPillContextMenu.tsx | 1 |
| `sessions-rename-input` | packages/ui/src/features/sessions/sidebar/SessionRowRename.tsx | 1 |
| `sessions-row-meta-project` | packages/ui/src/features/sessions/sidebar/SessionRowMeta.tsx | 1 |
| `sessions-row-meta-worktree` | packages/ui/src/features/sessions/sidebar/SessionRowMeta.tsx | 1 |
| `sessions-row-meta-worktree-missing` | packages/ui/src/features/sessions/sidebar/SessionRowMeta.tsx | 1 |
| `sessions-row-relative-time` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 1 |
| `sessions-sidebar` | packages/ui/src/features/context-panel/PanelResizeHandle.tsx; packages/ui/src/layout/SidebarShell.tsx | 1 |
| `sessions-sort-*` | packages/ui/src/features/sessions/sidebar/SessionSortMenu.tsx | 1 |
| `sessions-sort-button` | packages/ui/src/features/sessions/sidebar/SessionSortMenu.tsx | 1 |
| `sessions-sort-popover` | packages/ui/src/features/sessions/sidebar/SessionSortMenu.tsx | 1 |
| `sessions-tag-color-*` | packages/ui/src/features/sessions/tags/TagRecolorPanel.tsx | 1 |
| `sessions-tag-delete-confirm-cancel` | packages/ui/src/features/sessions/tags/TagDeleteConfirm.tsx | 1 |
| `sessions-tag-delete-confirm-ok` | packages/ui/src/features/sessions/tags/TagDeleteConfirm.tsx | 1 |
| `sessions-tag-recolor-panel` | packages/ui/src/features/sessions/tags/TagRecolorPanel.tsx | 1 |
| `sessions-tag-registry-recolor` | packages/ui/src/features/sessions/tags/TagRegistryItemMenu.tsx | 1 |
| `sessions-tag-registry-rename` | packages/ui/src/features/sessions/tags/TagRegistryItemMenu.tsx | 1 |
| `sessions-tag-rename-input` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 1 |
| `sessions-welcome-suggestion-insert-*` | packages/ui/src/features/sessions/new-thread/SuggestionRow.tsx | 1 |
| `settings-*-default-effort` | packages/ui/src/features/settings/panes/providers/ProviderTuningDefaults.tsx | 1 |
| `settings-*-default-effort-option-*` | packages/ui/src/features/settings/panes/providers/ProviderTuningDefaults.tsx | 1 |
| `settings-*-executable-path-input` | packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx | 1 |
| `settings-*-mode-option-*` | packages/ui/src/features/settings/panes/providers/SessionModeRadio.tsx | 1 |
| `settings-*-plan-mode-toggle` | packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx | 1 |
| `settings-*-system-prompt-toggle` | packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx | 1 |
| `settings-dialog-close` | packages/ui/src/features/settings/SettingsDialog.tsx | 1 |
| `settings-pane-about` | packages/ui/src/features/settings/panes/about/AboutPane.tsx | 1 |
| `settings-pane-general` | packages/ui/src/features/settings/panes/general/GeneralPane.tsx | 1 |
| `settings-pane-notifications` | packages/ui/src/features/settings/panes/notifications/NotificationsPane.tsx | 1 |
| `settings-pane-providers` | packages/ui/src/features/settings/panes/providers/ProvidersPane.tsx | 1 |
| `settings-pane-remote-access` | packages/ui/src/features/settings/panes/remote-access/RemoteAccessPane.tsx | 1 |
| `settings-provider-header-*` | packages/ui/src/features/settings/panes/providers/ProvidersPane.tsx | 1 |
| `settings-remote-access-devices-section` | packages/ui/src/features/settings/panes/remote-access/DevicesSection.tsx | 1 |
| `settings-remote-access-named-tunnel-section` | packages/ui/src/features/settings/panes/remote-access/NamedTunnelSection.tsx | 1 |
| `settings-remote-access-pairing-section` | packages/ui/src/features/settings/panes/remote-access/PairingSection.tsx | 1 |
| `settings-remote-access-quick-tunnel-section` | packages/ui/src/features/settings/panes/remote-access/QuickTunnelSection.tsx | 1 |
| `settings-worktree-dir-input` | packages/ui/src/features/settings/panes/general/GeneralPane.tsx | 1 |
| `settings-worktree-dir-save` | packages/ui/src/features/settings/panes/general/GeneralPane.tsx | 1 |
| `show-sidebar-button` | packages/ui/src/layout/MainToolbar.tsx | 1 |
| `sidebar-hide-button` | packages/ui/src/layout/SidebarHeader.tsx | 1 |
| `surface-drag-layer` | packages/ui/src/layout/SurfaceDragLayer.tsx | 1 |
| `tasks-attach-*` | packages/ui/src/features/tasks/TaskAttachments.tsx | 1 |
| `tasks-attach-add` | packages/ui/src/features/tasks/TaskAttachments.tsx | 1 |
| `tasks-attach-delete-*` | packages/ui/src/features/tasks/TaskAttachments.tsx | 1 |
| `tasks-board-close` | packages/ui/src/features/tasks/TasksBoard.tsx | 1 |
| `tasks-card-delete-*` | packages/ui/src/features/tasks/TaskCard.tsx | 1 |
| `tasks-card-edit-*` | packages/ui/src/features/tasks/TaskCard.tsx | 1 |
| `tasks-card-start-*` | packages/ui/src/features/tasks/TaskCard.tsx | 1 |
| `tasks-dep-input` | packages/ui/src/features/tasks/DependencyPicker.tsx | 1 |
| `tasks-dep-opt-*` | packages/ui/src/features/tasks/DependencyPicker.tsx | 1 |
| `tasks-dep-pill-*` | packages/ui/src/features/tasks/DependencyPicker.tsx | 1 |
| `tasks-dep-remove-*` | packages/ui/src/features/tasks/DependencyPicker.tsx | 1 |
| `tasks-drawer-count` | packages/ui/src/features/tasks/TasksDrawer.tsx | 1 |
| `tasks-drawer-empty` | packages/ui/src/features/tasks/TasksDrawerList.tsx | 1 |
| `tasks-drawer-expand` | packages/ui/src/features/tasks/TasksDrawer.tsx | 1 |
| `tasks-drawer-new` | packages/ui/src/features/tasks/TasksDrawer.tsx | 1 |
| `tasks-drawer-resize-handle` | packages/ui/src/features/tasks/TasksDrawer.tsx | 1 |
| `tasks-drawer-row-*` | packages/ui/src/features/tasks/TasksDrawerList.tsx | 1 |
| `tasks-drawer-row-${number}` | packages/ui/src/features/tasks/TasksDrawerList.tsx | 1 |
| `tasks-edit-assignees` | packages/ui/src/features/tasks/TaskMetaFields.tsx | 1 |
| `tasks-edit-milestone` | packages/ui/src/features/tasks/TaskMetaFields.tsx | 1 |
| `tasks-edit-start` | packages/ui/src/features/tasks/TaskEditModal.tsx | 1 |
| `tasks-filter-*` | packages/ui/src/features/tasks/FilterMenu.tsx | 1 |
| `tasks-filter-*-count` | packages/ui/src/features/tasks/FilterMenu.tsx | 1 |
| `tasks-filter-clear` | packages/ui/src/features/tasks/TasksFilterBar.tsx | 1 |
| `tasks-filter-opt-*` | packages/ui/src/features/tasks/FilterMenu.tsx | 1 |
| `tasks-filter-search` | packages/ui/src/features/tasks/TasksFilterBar.tsx | 1 |
| `tasks-label-input` | packages/ui/src/features/tasks/LabelAutocomplete.tsx | 1 |
| `tasks-label-pill-*` | packages/ui/src/features/tasks/LabelAutocomplete.tsx | 1 |
| `tasks-label-remove-*` | packages/ui/src/features/tasks/LabelAutocomplete.tsx | 1 |
| `tasks-list-empty` | packages/ui/src/features/tasks/TaskListView.tsx | 1 |
| `tasks-list-row-cycle-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 1 |
| `tasks-list-row-delete-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 1 |
| `tasks-list-row-edit-cta-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 1 |
| `tasks-list-row-expand-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 1 |
| `tasks-list-row-start-cta-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 1 |
| `tasks-quick-body` | packages/ui/src/features/tasks/QuickTaskDialog.tsx | 1 |
| `tasks-sort-menu` | packages/ui/src/features/tasks/SortMenu.tsx | 1 |
| `tasks-sort-option-*` | packages/ui/src/features/tasks/SortMenu.tsx | 1 |
| `thread-find-input` | packages/ui/src/features/chat/find/FindBar.tsx | 1 |
| `toast-countdown-rail` | packages/ui/src/components/ui/ws-toast.tsx | 1 |
| `toast-dismiss` | packages/ui/src/components/ui/ws-toast.tsx | 1 |
| `toast-status-chip` | packages/ui/src/components/ui/ws-toast.tsx | 1 |
| `tool-group-trigger-count` | packages/ui/src/components/ui/assistant-ui/tool-group.tsx | 1 |
| `tool-group-trigger-label` | packages/ui/src/components/ui/assistant-ui/tool-group.tsx | 1 |
| `tool-result-expand-toggle` | packages/ui/src/features/chat/tools/ToolResultExpand.tsx | 1 |
| `tour-back-btn` | packages/ui/src/features/tour/WsTourLabel.tsx | 1 |
| `tour-next-btn` | packages/ui/src/features/tour/WsTourLabel.tsx | 1 |
| `tour-skip-btn` | packages/ui/src/features/tour/TutorialOverlay.tsx | 1 |
| `tour-spotlight` | packages/ui/src/features/tour/TutorialOverlay.tsx | 1 |
| `tour-step-dot-*` | packages/ui/src/features/tour/WsTourLabel.tsx | 1 |
| `viewer-csv-empty` | packages/ui/src/features/viewers/CsvViewer.tsx | 1 |
| `viewer-image` | packages/ui/src/features/viewers/ImageViewer.tsx | 1 |
| `viewer-pdf` | packages/ui/src/features/viewers/PdfViewer.tsx | 1 |
| `viewer-pdf-fallback` | packages/ui/src/features/viewers/PdfViewer.tsx | 1 |
| `viewer-shell` | packages/ui/src/features/viewers/ViewerShell.tsx | 1 |
| `viewer-svg` | packages/ui/src/features/viewers/SvgViewer.tsx | 1 |
| `viewer-svg-source` | packages/ui/src/features/viewers/SvgViewer.tsx | 1 |
| `web-fetch-card-summary` | packages/ui/src/features/chat/tools/cards/WebFetchCard.tsx | 1 |
| `web-fetch-card-url` | packages/ui/src/features/chat/tools/cards/WebFetchCard.tsx | 1 |
| `workflows-answer-submit` | packages/ui/src/features/workflows/WfAnswerForm.tsx | 1 |
| `workflows-builder` | packages/ui/src/features/workflows/editor/WfBuilderPane.tsx | 1 |
| `workflows-builder-add-output` | packages/ui/src/features/workflows/editor/WfBuilderPane.tsx | 1 |
| `workflows-builder-add-trigger` | packages/ui/src/features/workflows/editor/WfbDropdowns.tsx | 1 |
| `workflows-close` | packages/ui/src/features/workflows/WorkflowsView.tsx | 1 |
| `workflows-editor-close` | packages/ui/src/features/workflows/editor/WorkflowEditor.tsx | 1 |
| `workflows-interaction-answer-*` | packages/ui/src/features/workflows/WfInteractionCard.tsx | 1 |
| `workflows-interaction-viewrun-*` | packages/ui/src/features/workflows/WfInteractionCard.tsx | 1 |
| `workflows-library-run-*` | packages/ui/src/features/workflows/WfLibrary.tsx | 1 |
| `workflows-library-scope-*` | packages/ui/src/features/workflows/WfLibrary.tsx | 1 |
| `workflows-needsyou-empty` | packages/ui/src/features/workflows/WfNeedsYou.tsx | 1 |
| `changes-panel` | packages/ui/src/features/files/ChangesPanel.tsx | 2 |
| `changes-refresh` | packages/ui/src/features/files/ChangesPanel.tsx | 2 |
| `changes-status-*` | packages/ui/src/features/files/ChangesPanel.tsx | 2 |
| `chat-bash-command` | packages/ui/src/features/chat/tools/cards/BashCard.tsx | 2 |
| `chat-composer-edit` | packages/ui/src/features/chat/composer/edit/ComposerEditMode.tsx | 2 |
| `chat-composer-edit-input` | packages/ui/src/features/chat/composer/edit/ComposerEditMode.tsx | 2 |
| `chat-edit-open-diff` | packages/ui/src/features/chat/tools/cards/EditFileCard.tsx | 2 |
| `chat-header-context` | packages/ui/src/features/chat/thread/ChatSessionInline.tsx | 2 |
| `chat-header-review` | packages/ui/src/features/chat/thread/ChatCardHeader.tsx | 2 |
| `chat-header-split-right` | packages/ui/src/features/chat/thread/ChatCardHeader.tsx | 2 |
| `chat-plan-card` | packages/ui/src/features/chat/tools/cards/PlanCard.tsx | 2 |
| `chat-plan-feedback-input` | packages/ui/src/features/chat/gates/PlanGate.tsx | 2 |
| `chat-plan-keep-planning` | packages/ui/src/features/chat/gates/PlanGate.tsx | 2 |
| `chat-plan-reject` | packages/ui/src/features/chat/gates/PlanGate.tsx | 2 |
| `chat-plan-send-feedback` | packages/ui/src/features/chat/gates/PlanGate.tsx | 2 |
| `chat-selection-quote` | packages/ui/src/components/ui/assistant-ui/quote.tsx | 2 |
| `chat-task-card` | packages/ui/src/features/chat/tools/cards/TaskCard.tsx | 2 |
| `chat-task-toggle` | packages/ui/src/features/chat/tools/cards/TaskCard.tsx | 2 |
| `chat-thread` | packages/ui/src/features/chat/thread/ChatThread.tsx | 2 |
| `chat-thread-viewport` | packages/ui/src/features/chat/thread/ChatThread.tsx | 2 |
| `chat-user-review-comment` | packages/ui/src/features/chat/messages/ReviewCommentCard.tsx | 2 |
| `chat-user-review-comment-L*` | packages/ui/src/features/chat/messages/ReviewCommentCard.tsx | 2 |
| `composer-adapter-select-option-*` | packages/ui/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx | 2 |
| `composer-add-attachment` | packages/ui/src/components/ui/assistant-ui/attachment.tsx | 2 |
| `composer-feature-*` | packages/ui/src/features/chat/composer/config-toolbar/FeaturesPopover.tsx | 2 |
| `composer-permission-mode-select` | packages/ui/src/features/chat/composer/config-toolbar/PermissionSelect.tsx | 2 |
| `composer-permission-mode-select-option-*` | packages/ui/src/features/chat/composer/config-toolbar/PermissionSelect.tsx | 2 |
| `composer-provider-footer` | packages/ui/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx | 2 |
| `composer-quote-dismiss` | packages/ui/src/components/ui/assistant-ui/quote.tsx | 2 |
| `composer-worktree-branch-name` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeNewForm.tsx | 2 |
| `composer-worktree-enable` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeNewForm.tsx | 2 |
| `daemon-add-close` | packages/ui/src/features/daemon/AddRemoteDialog.tsx | 2 |
| `daemon-add-confirm` | packages/ui/src/features/daemon/pairing-steps.tsx | 2 |
| `daemon-picker-empty` | packages/ui/src/features/daemon/DaemonPicker.tsx | 2 |
| `daemon-remove-confirm` | packages/ui/src/features/daemon/DaemonSmallDialog.tsx | 2 |
| `diff-next-change` | packages/ui/src/features/editor/DiffHeader.tsx | 2 |
| `diff-reveal` | packages/ui/src/features/editor/DiffHeader.tsx | 2 |
| `directory-picker-close` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 2 |
| `directory-picker-confirm` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 2 |
| `directory-picker-recent-*` | packages/ui/src/components/overlays/directory-picker/RecentDirs.tsx | 2 |
| `editor-comment-widget-save` | packages/ui/src/features/editor/inline-comments/InlineCommentWidget.tsx | 2 |
| `editor-submit-review` | packages/ui/src/features/editor/inline-comments/CmEditorWithComments.tsx | 2 |
| `editor-submit-review-btn` | packages/ui/src/features/editor/inline-comments/CmEditorWithComments.tsx | 2 |
| `editor-tab-disk-conflict` | packages/ui/src/features/editor/EditorTab.tsx | 2 |
| `editor-tab-save-error` | packages/ui/src/features/editor/EditorTab.tsx | 2 |
| `file-picker-row-*` | packages/ui/src/features/files/use-file-search.tsx | 2 |
| `file-tree` | packages/ui/src/features/files/FileTree.tsx | 2 |
| `files-tab-strip-close` | packages/ui/src/layout/FilesTabStrip.tsx | 2 |
| `find-in-path-include-ignored` | packages/ui/src/components/overlays/FindInPathModal.tsx | 2 |
| `git-branch-search` | packages/ui/src/features/git/BranchListView.tsx | 2 |
| `git-new-branch-create` | packages/ui/src/features/git/NewBranchDialog.tsx | 2 |
| `git-new-branch-dialog` | packages/ui/src/features/git/NewBranchDialog.tsx | 2 |
| `git-new-branch-name` | packages/ui/src/features/git/NewBranchDialog.tsx | 2 |
| `git-worktree-row-*` | packages/ui/src/features/git/WorktreeSection.tsx | 2 |
| `image-lightbox-dialog` | packages/ui/src/features/chat/parts/ImageLightbox.tsx | 2 |
| `import-session-btn` | packages/ui/src/features/sessions/sidebar/ExternalSessionRow.tsx | 2 |
| `inspector-pane` | packages/ui/src/features/files/InspectorPane.tsx | 2 |
| `main-toolbar-launch` | packages/ui/src/features/run/ToolbarLaunchControls.tsx | 2 |
| `main-toolbar-launch-*-*` | packages/ui/src/features/run/ToolbarLaunchControls.tsx | 2 |
| `preview-body-cta` | packages/ui/src/features/preview/PreviewBodyState.tsx | 2 |
| `preview-body-starting` | packages/ui/src/features/preview/PreviewBodyState.tsx | 2 |
| `preview-run-start` | packages/ui/src/features/preview/PreviewRunControl.tsx | 2 |
| `review-close` | packages/ui/src/features/review/ReviewPanelHeader.tsx | 2 |
| `review-commit-done` | packages/ui/src/features/review/ReviewCommitRail.tsx | 2 |
| `review-commit-input` | packages/ui/src/features/review/ReviewCommitRail.tsx | 2 |
| `review-viewed-counter` | packages/ui/src/features/review/ReviewPanelHeader.tsx | 2 |
| `review-viewed-toggle` | packages/ui/src/features/review/ReviewFileToolbar.tsx | 2 |
| `run-pane-close-*` | packages/ui/src/layout/RunTabStrip.tsx | 2 |
| `run-pane-new-terminal-*` | packages/ui/src/layout/RunTabStrip.tsx | 2 |
| `sessions-archive-confirm` | packages/ui/src/features/sessions/sidebar/ArchiveWorktreeDialog.tsx | 2 |
| `sessions-archive-delete-worktree` | packages/ui/src/features/sessions/sidebar/ArchiveWorktreeDialog.tsx | 2 |
| `sessions-ctx-copy-id` | packages/ui/src/features/sessions/sidebar/SessionContextMenu.tsx | 2 |
| `sessions-ctx-pin` | packages/ui/src/features/sessions/sidebar/SessionContextMenu.tsx | 2 |
| `sessions-draft-row-discard` | packages/ui/src/features/sessions/sidebar/DraftSessionRow.tsx | 2 |
| `sessions-empty-state` | packages/ui/src/features/sessions/sidebar/SessionSidebar.tsx | 2 |
| `sessions-group-header-*` | packages/ui/src/features/sessions/sidebar/SessionGroupHeader.tsx | 2 |
| `sessions-import-load-more` | packages/ui/src/features/sessions/sidebar/ImportSessionsDialog.tsx | 2 |
| `sessions-project-remove-*` | packages/ui/src/features/sessions/sidebar/ProjectPillContextMenu.tsx | 2 |
| `sessions-row-action-rename` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 2 |
| `sessions-tag-delete-confirm` | packages/ui/src/features/sessions/tags/TagDeleteConfirm.tsx | 2 |
| `sessions-tag-popover-create` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 2 |
| `sessions-tag-registry-delete` | packages/ui/src/features/sessions/tags/TagRegistryItemMenu.tsx | 2 |
| `sessions-welcome-suggestion-*` | packages/ui/src/features/sessions/new-thread/SuggestionRow.tsx | 2 |
| `settings-*-model-dropdown-trigger` | packages/ui/src/features/settings/panes/providers/ModelDropdown.tsx | 2 |
| `settings-*-model-option-*` | packages/ui/src/features/settings/panes/providers/ModelDropdown.tsx | 2 |
| `sidebar-attachment-*` | packages/ui/src/features/context-panel/SessionAttachmentsGrid.tsx | 2 |
| `sidebar-footer-count-*` | packages/ui/src/layout/SidebarFooter.tsx | 2 |
| `sidebar-settings-button` | packages/ui/src/layout/SidebarHeader.tsx | 2 |
| `sidebar-tasks-button` | packages/ui/src/layout/SidebarHeader.tsx | 2 |
| `surf-divider-*` | packages/ui/src/layout/SurfDivider.tsx | 2 |
| `tasks-board-new` | packages/ui/src/features/tasks/TasksBoard.tsx | 2 |
| `tasks-card-*` | packages/ui/src/features/tasks/TaskCard.tsx | 2 |
| `tasks-column-*` | packages/ui/src/features/tasks/TaskColumn.tsx | 2 |
| `tasks-edit-delete` | packages/ui/src/features/tasks/TaskEditModal.tsx | 2 |
| `tasks-list-group-*` | packages/ui/src/features/tasks/TaskListView.tsx | 2 |
| `tasks-list-row-start-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 2 |
| `tasks-list-row-type-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 2 |
| `tasks-quick-create` | packages/ui/src/features/tasks/QuickTaskDialog.tsx | 2 |
| `tasks-quick-dialog` | packages/ui/src/features/tasks/QuickTaskDialog.tsx | 2 |
| `tasks-quick-title` | packages/ui/src/features/tasks/QuickTaskDialog.tsx | 2 |
| `tasks-view-board` | packages/ui/src/features/tasks/TasksBoard.tsx | 2 |
| `tasks-view-list` | packages/ui/src/features/tasks/TasksBoard.tsx | 2 |
| `tour-label-card` | packages/ui/src/features/tour/WsTourLabel.tsx | 2 |
| `viewer-csv-filter` | packages/ui/src/features/viewers/CsvViewer.tsx | 2 |
| `viewer-csv-header-*` | packages/ui/src/features/viewers/CsvViewer.tsx | 2 |
| `viewer-image-zoom-in` | packages/ui/src/features/viewers/ImageViewer.tsx | 2 |
| `viewer-image-zoom-out` | packages/ui/src/features/viewers/ImageViewer.tsx | 2 |
| `viewer-shell-reveal` | packages/ui/src/features/viewers/ViewerShell.tsx | 2 |
| `workflows-builder-add-step` | packages/ui/src/features/workflows/editor/WfBuilderPane.tsx; packages/ui/src/features/workflows/editor/WfbDropdowns.tsx | 2 |
| `workflows-builder-description` | packages/ui/src/features/workflows/editor/WfBuilderPane.tsx | 2 |
| `workflows-builder-scope-*` | packages/ui/src/features/workflows/editor/WfBuilderPane.tsx | 2 |
| `workflows-editor-mode-*` | packages/ui/src/features/workflows/editor/WfEditorChrome.tsx | 2 |
| `workflows-editor-validation-error` | packages/ui/src/features/workflows/editor/WfEditorChrome.tsx | 2 |
| `workflows-field-*` | packages/ui/src/features/workflows/WfField.tsx | 2 |
| `workflows-library` | packages/ui/src/features/workflows/WfLibrary.tsx | 2 |
| `workflows-modal` | packages/ui/src/features/workflows/WorkflowsModalHost.tsx | 2 |
| `workflows-needsyou` | packages/ui/src/features/workflows/WfNeedsYou.tsx | 2 |
| `workflows-runs-filter-*` | packages/ui/src/features/workflows/WfRunsList.tsx | 2 |
| `workflows-steplib` | packages/ui/src/features/workflows/editor/WfStepLibrary.tsx | 2 |
| `workflows-steplib-*` | packages/ui/src/features/workflows/editor/WfStepLibrary.tsx | 2 |
| `chat-bash-output` | packages/ui/src/features/chat/tools/cards/BashCard.tsx | 3 |
| `chat-bash-trigger` | packages/ui/src/features/chat/tools/cards/BashCard.tsx | 3 |
| `chat-composer-send` | packages/ui/src/features/chat/composer/Composer.tsx | 3 |
| `chat-header` | packages/ui/src/features/chat/thread/ChatCardHeader.tsx | 3 |
| `chat-permission-always-allow` | packages/ui/src/features/chat/gates/PermissionGate.tsx | 3 |
| `chat-plan-approve` | packages/ui/src/features/chat/gates/PlanGate.tsx | 3 |
| `chat-question-submit` | packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx | 3 |
| `chat-user-message` | packages/ui/src/features/chat/messages/UserMessage.tsx | 3 |
| `composer-attachment-tile` | packages/ui/src/components/ui/assistant-ui/attachment.tsx | 3 |
| `composer-features-trigger` | packages/ui/src/features/chat/composer/config-toolbar/FeaturesPopover.tsx | 3 |
| `composer-quote-preview` | packages/ui/src/components/ui/assistant-ui/quote.tsx | 3 |
| `composer-trigger-popover` | packages/ui/src/features/chat/composer/triggers/ComposerTriggers.tsx | 3 |
| `composer-worktree-cancel` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeNewForm.tsx | 3 |
| `composer-worktree-tab-new` | packages/ui/src/features/chat/composer/config-toolbar/WorktreeExistingTab.tsx | 3 |
| `daemon-add-device` | packages/ui/src/features/daemon/pairing-steps.tsx | 3 |
| `daemon-pair-code` | packages/ui/src/features/daemon/PairCodeInput.tsx | 3 |
| `daemon-row-*` | packages/ui/src/features/daemon/DaemonRow.tsx | 3 |
| `diff-prev-change` | packages/ui/src/features/editor/DiffHeader.tsx | 3 |
| `drop-zone-*` | packages/ui/src/layout/SurfaceDragLayer.tsx | 3 |
| `editor-comment-widget-close` | packages/ui/src/features/editor/inline-comments/InlineCommentWidget.tsx | 3 |
| `file-picker-input` | packages/ui/src/features/files/FilePickerDialog.tsx | 3 |
| `file-tree-reveal` | packages/ui/src/features/files/FileTreeRowMenu.tsx | 3 |
| `inspector-tab-files` | packages/ui/src/features/files/InspectorPane.tsx | 3 |
| `markdown-preview` | packages/ui/src/features/editor/MarkdownPreview.tsx | 3 |
| `preview-body-running` | packages/ui/src/features/preview/PreviewBodyState.tsx | 3 |
| `preview-capture-cluster` | packages/ui/src/features/preview/PreviewCaptureCluster.tsx | 3 |
| `preview-run-stop` | packages/ui/src/features/preview/PreviewRunControl.tsx | 3 |
| `review-commit-submit` | packages/ui/src/features/review/ReviewCommitRail.tsx | 3 |
| `run-pane-launch-*-*` | packages/ui/src/layout/RunTabStrip.tsx | 3 |
| `search-palette-mode-chip` | packages/ui/src/features/palette/SpotlightPalette.tsx | 3 |
| `sessions-archive-confirm-dialog` | packages/ui/src/features/sessions/sidebar/ArchiveWorktreeDialog.tsx | 3 |
| `sessions-row-action-tags` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 3 |
| `sessions-row-title` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 3 |
| `sessions-tag-popover` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 3 |
| `sessions-welcome` | packages/ui/src/features/sessions/new-thread/WelcomeState.tsx | 3 |
| `settings-nav-provider-*` | packages/ui/src/features/settings/SettingsSidebar.tsx | 3 |
| `settings-pane-provider-*` | packages/ui/src/features/settings/panes/providers/ProviderConfigForm.tsx | 3 |
| `sidebar-context-item-*` | packages/ui/src/features/context-panel/ContextFileItem.tsx | 3 |
| `sidebar-workflows-button` | packages/ui/src/layout/SidebarHeader.tsx | 3 |
| `tasks-drawer` | packages/ui/src/features/tasks/TasksDrawer.tsx | 3 |
| `tool-card-file-path` | packages/ui/src/features/chat/tools/shared/chrome.tsx | 3 |
| `tour-overlay` | packages/ui/src/features/tour/TutorialOverlay.tsx | 3 |
| `workflows-editor-cancel` | packages/ui/src/features/workflows/editor/WorkflowEditor.tsx | 3 |
| `workflows-editor-save` | packages/ui/src/features/workflows/editor/WorkflowEditor.tsx | 3 |
| `workflows-run-back` | packages/ui/src/features/workflows/WfRunDetail.tsx | 3 |
| `workflows-run-row-*` | packages/ui/src/features/workflows/WfRunsList.tsx | 3 |
| `workflows-step-*` | packages/ui/src/features/workflows/WfStepNode.tsx | 3 |
| `chat-header-hide` | packages/ui/src/features/chat/thread/ChatCardHeader.tsx | 4 |
| `chat-question-gate` | packages/ui/src/features/chat/gates/AskUserQuestionGate.tsx | 4 |
| `composer-effort-select-option-*` | packages/ui/src/features/chat/composer/config-toolbar/EffortPicker.tsx | 4 |
| `composer-worktree-popover` | packages/ui/src/features/chat/composer/config-toolbar/WorktreePopover.tsx | 4 |
| `composer-worktree-trigger` | packages/ui/src/features/chat/composer/config-toolbar/WorktreePopover.tsx | 4 |
| `daemon-add-continue` | packages/ui/src/features/daemon/pairing-steps.tsx | 4 |
| `daemon-add-url` | packages/ui/src/features/daemon/pairing-steps.tsx | 4 |
| `daemon-add-verify` | packages/ui/src/features/daemon/pairing-steps.tsx | 4 |
| `daemon-picker-add` | packages/ui/src/features/daemon/DaemonPicker.tsx | 4 |
| `directory-picker-cancel` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 4 |
| `directory-picker-row-*` | packages/ui/src/components/overlays/directory-picker/PickerTree.tsx | 4 |
| `editor-context-menu-content` | packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx | 4 |
| `editor-save-status` | packages/ui/src/features/editor/EditorTab.tsx | 4 |
| `file-picker-dialog` | packages/ui/src/features/files/FilePickerDialog.tsx | 4 |
| `preview-url-input` | packages/ui/src/features/preview/PreviewUrlBar.tsx | 4 |
| `review-file-row-*` | packages/ui/src/features/review/ReviewFileTree.tsx | 4 |
| `run-pane-*` | packages/ui/src/layout/surfaces/RunSurface.tsx | 4 |
| `sessions-new-picker-project-*` | packages/ui/src/features/sessions/sidebar/NewSessionPickerPopover.tsx | 4 |
| `sessions-row-action-archive` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 4 |
| `sessions-row-status-dot` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 4 |
| `settings-dialog` | packages/ui/src/features/settings/SettingsDialog.tsx | 4 |
| `tasks-edit-cancel` | packages/ui/src/features/tasks/TaskEditModal.tsx | 4 |
| `viewer-csv` | packages/ui/src/features/viewers/CsvViewer.tsx | 4 |
| `workflows-editor-yaml` | packages/ui/src/features/workflows/editor/WfYamlPane.tsx | 4 |
| `workflows-nav-*` | packages/ui/src/features/workflows/WorkflowsView.tsx | 4 |
| `*-surface-picker` | packages/ui/src/layout/SurfacePicker.tsx | 5 |
| `changes-row-*` | packages/ui/src/features/files/ChangesPanel.tsx | 5 |
| `chat-permission-allow-once` | packages/ui/src/features/chat/gates/PermissionGate.tsx | 5 |
| `chat-plan-gate` | packages/ui/src/features/chat/gates/PlanGate.tsx | 5 |
| `chat-queued-message` | packages/ui/src/features/chat/messages/QueuedUserTurn.tsx | 5 |
| `files-tab-strip-add` | packages/ui/src/layout/FilesTabStrip.tsx | 5 |
| `find-in-path-result-*:*:*` | packages/ui/src/components/overlays/FindInPathModal.tsx | 5 |
| `inspector-tab-changes` | packages/ui/src/features/files/InspectorPane.tsx | 5 |
| `main-toolbar-inspector` | packages/ui/src/layout/MainToolbar.tsx | 5 |
| `sessions-import-dialog` | packages/ui/src/features/sessions/sidebar/ImportSessionsDialog.tsx | 5 |
| `sessions-import-project-*` | packages/ui/src/features/sessions/sidebar/ImportSessionsDialog.tsx | 5 |
| `sessions-new-picker` | packages/ui/src/features/sessions/sidebar/NewSessionPickerPopover.tsx | 5 |
| `sessions-tag-filter-more` | packages/ui/src/features/sessions/filter/TagFilterBar.tsx | 5 |
| `sessions-tag-filter-synthetic-*` | packages/ui/src/features/sessions/filter/TagFilterBar.tsx | 5 |
| `sessions-tag-registry-row-*` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 5 |
| `sessions-tag-toggle-*` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 5 |
| `sidebar-context-section-*` | packages/ui/src/features/context-panel/ContextSection.tsx | 5 |
| `tasks-edit-save` | packages/ui/src/features/tasks/TaskEditModal.tsx | 5 |
| `tasks-list-row-edit-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 5 |
| `workflows-builder-name` | packages/ui/src/features/workflows/editor/WfBuilderPane.tsx | 5 |
| `workflows-library-row-*` | packages/ui/src/features/workflows/WfLibrary.tsx | 5 |
| `chat-assistant-message` | packages/ui/src/features/chat/messages/AssistantMessage.tsx | 6 |
| `composer-effort-select` | packages/ui/src/features/chat/composer/config-toolbar/EffortPicker.tsx | 6 |
| `daemon-footer-trigger` | packages/ui/src/features/daemon/DaemonFooterStatus.tsx | 6 |
| `editor-comment-widget-input` | packages/ui/src/features/editor/inline-comments/InlineCommentWidget.tsx | 6 |
| `external-session-item` | packages/ui/src/features/sessions/sidebar/ExternalSessionRow.tsx | 6 |
| `git-branch-row-*` | packages/ui/src/features/git/BranchRow.tsx | 6 |
| `run-tab-close-*` | packages/ui/src/layout/RunTabStrip.tsx | 6 |
| `run-tab-strip-split-down` | packages/ui/src/layout/RunTabStrip.tsx | 6 |
| `sessions-draft-row` | packages/ui/src/features/sessions/sidebar/DraftSessionRow.tsx | 6 |
| `sessions-more-import` | packages/ui/src/features/sessions/sidebar/SessionsMoreMenu.tsx | 6 |
| `sessions-tag-filter-*` | packages/ui/src/features/sessions/filter/TagFilterBar.tsx | 6 |
| `sessions-tag-filter-bar` | packages/ui/src/features/sessions/filter/TagFilterBar.tsx | 6 |
| `tasks-board-modal` | packages/ui/src/features/tasks/TasksBoard.tsx | 6 |
| `tasks-edit-title` | packages/ui/src/features/tasks/TaskEditModal.tsx | 6 |
| `workflows-library-new` | packages/ui/src/features/workflows/WfLibrary.tsx | 6 |
| `chat-bash-card` | packages/ui/src/features/chat/tools/cards/BashCard.tsx | 7 |
| `directory-picker-path-input` | packages/ui/src/components/overlays/directory-picker/PathCrumbInput.tsx | 7 |
| `file-tree-find-in-file` | packages/ui/src/features/files/FileTreeRowMenu.tsx | 7 |
| `file-tree-find-in-folder` | packages/ui/src/features/files/FileTreeRowMenu.tsx | 7 |
| `review-modal` | packages/ui/src/features/review/ReviewPanel.tsx | 7 |
| `run-tab-strip-add-*` | packages/ui/src/layout/RunTabStrip.tsx | 7 |
| `run-tab-strip-split-right` | packages/ui/src/layout/RunTabStrip.tsx | 7 |
| `sessions-more-button` | packages/ui/src/features/sessions/sidebar/SessionsMoreMenu.tsx | 7 |
| `sessions-new-button` | packages/ui/src/features/sessions/sidebar/SessionsNewButton.tsx | 7 |
| `toast-root` | packages/ui/src/components/ui/ws-toast.tsx | 7 |
| `viewer-shell-status` | packages/ui/src/features/viewers/ViewerShell.tsx | 7 |
| `workflows-editor` | packages/ui/src/features/workflows/editor/WorkflowEditor.tsx | 7 |
| `diff-tab` | packages/ui/src/features/editor/DiffTab.tsx | 8 |
| `editor-diff` | packages/ui/src/features/editor/CmDiffEditor.tsx | 8 |
| `find-in-path-input` | packages/ui/src/components/overlays/FindInPathModal.tsx | 8 |
| `run-tab-*` | packages/ui/src/layout/RunTabStrip.tsx | 8 |
| `search-palette` | packages/ui/src/features/palette/SpotlightPalette.tsx | 8 |
| `sessions-add-project` | packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx | 8 |
| `sessions-row-meta-tag-dot-*` | packages/ui/src/features/sessions/sidebar/SessionRowMeta.tsx | 8 |
| `sessions-tag-popover-search` | packages/ui/src/features/sessions/tags/TagPopover.tsx | 8 |
| `sidebar-bottom-tab-*` | packages/ui/src/features/context-panel/BottomPanel.tsx | 8 |
| `composer-model-select-option-*` | packages/ui/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx | 9 |
| `find-in-path` | packages/ui/src/components/overlays/FindInPathModal.tsx | 9 |
| `search-palette-input` | packages/ui/src/features/palette/SpotlightPalette.tsx | 9 |
| `surface-rail-*` | packages/ui/src/layout/SurfaceRail.tsx | 9 |
| `chat-permission-deny` | packages/ui/src/features/chat/gates/PermissionGate.tsx | 10 |
| `run-surface` | packages/ui/src/layout/surfaces/RunSurface.tsx | 10 |
| `sessions-filter-pill-*-wrap` | packages/ui/src/features/sessions/sidebar/ProjectPillContextMenu.tsx | 10 |
| `*-confirm` | packages/ui/src/components/ui/confirm-dialog.tsx | 11 |
| `composer-model-select` | packages/ui/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx | 11 |
| `directory-picker` | packages/ui/src/components/overlays/DirectoryPickerModal.tsx | 11 |
| `sessions-filter-pill-*` | packages/ui/src/features/sessions/sidebar/ProjectPillContextMenu.tsx | 11 |
| `files-surface` | packages/ui/src/layout/surfaces/FilesSurface.tsx | 12 |
| `chat-permission-gate` | packages/ui/src/features/chat/gates/PermissionGate.tsx | 13 |
| `tasks-list-row-*` | packages/ui/src/features/tasks/TaskListRow.tsx | 14 |
| `chat-composer-input` | packages/ui/src/features/chat/composer/Composer.tsx | 17 |
| `files-tab-strip` | packages/ui/src/layout/FilesTabStrip.tsx | 17 |
| `*-cancel` | packages/ui/src/components/ui/confirm-dialog.tsx | 18 |
| `*-option-*` | packages/ui/src/features/settings/panes/providers/CodexTuningDefaults.tsx | 19 |
| `editor-code` | packages/ui/src/features/editor/CmEditor.tsx | 20 |
| `files-tab-*` | packages/ui/src/layout/FilesTabStrip.tsx | 24 |
| `file-tree-row-*` | packages/ui/src/features/files/FileTree.tsx | 32 |
| `sessions-row` | packages/ui/src/features/sessions/sidebar/SessionRow.tsx | 47 |
