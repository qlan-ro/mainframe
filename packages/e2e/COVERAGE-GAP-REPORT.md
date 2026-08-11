# e2e — test-id coverage gap report

_Generated 2026-08-11. Source: packages/ui/src data-testids and
packages/e2e/{tests-tauri,helpers,fixtures} references. Method: same diff as UNUSED-TESTIDS.md,
read in both directions._

> "Unused" means the test-id string isn't referenced in a Playwright locator or passed as a bare
> string to a helper. Some of these elements ARE exercised via role/text locators (e.g. permission
> buttons via getByRole), so this lists selector gaps, not necessarily untested behavior. `${…}`
> marks templated id families.

## Summary

| Metric | Count |
|---|---|
| Defined | 892 |
| Referenced | 366 |
| Unused | 526 |
| Dead selectors | 67 |

## Dead selectors

- `${T.sessionRow}` — referenced by: page-objects.ts
- `${contentTestid}` — referenced by: zones.ts
- `${railButtonTestid}` — referenced by: zones.ts
- `ask-question-card` — referenced by: wait.ts
- `changes-panel` — referenced by: files-tree.spec.ts
- `chat-composer-worktree-missing` — referenced by: composer.spec.ts
- `chat-queued-cancel` — referenced by: composer-advanced.spec.ts
- `chat-queued-edit` — referenced by: composer-advanced.spec.ts
- `chat-write-trigger` — referenced by: tool-cards.spec.ts
- `composer-file-item-index.ts` — referenced by: composer-advanced.spec.ts
- `composer-file-item-notes` — referenced by: composer-advanced.spec.ts
- `composer-file-item-notes/todo.md` — referenced by: composer-advanced.spec.ts
- `composer-skill-item-greet-user` — referenced by: composer-advanced.spec.ts
- `connection-overlay` — referenced by: window-states.spec.ts
- `file-tree-find-in-file` — referenced by: files-tree.spec.ts, find-in-path.spec.ts
- `file-tree-find-in-folder` — referenced by: files-tree.spec.ts, find-in-path.spec.ts
- `git-confirm-dialog` — referenced by: git-branch.spec.ts
- `git-confirm-dialog-confirm` — referenced by: git-branch.spec.ts
- `git-submenu-checkout` — referenced by: git-branch.spec.ts
- `git-submenu-delete` — referenced by: git-branch.spec.ts
- `git-submenu-delete-worktree` — referenced by: git-branch.spec.ts
- `git-submenu-merge` — referenced by: git-branch.spec.ts
- `git-submenu-new-branch-from` — referenced by: git-branch.spec.ts
- `git-submenu-new-session` — referenced by: git-branch.spec.ts
- `git-submenu-pull` — referenced by: git-branch.spec.ts
- `git-submenu-push` — referenced by: git-branch.spec.ts
- `git-submenu-rename` — referenced by: git-branch.spec.ts
- `inspector-tab-changes` — referenced by: files-tree.spec.ts
- `inspector-tab-files` — referenced by: files-tree.spec.ts
- `markdown-mode-edit` — referenced by: editor.spec.ts
- `markdown-mode-preview` — referenced by: editor.spec.ts, viewers.spec.ts
- `marker-body` — referenced by: tool-cards.spec.ts
- `message-image-thumb` — referenced by: composer.spec.ts
- `permission-card` — referenced by: wait.ts
- `plan-approval-card` — referenced by: wait.ts
- `read-card-trigger` — referenced by: tool-cards.spec.ts
- `search-palette-change-row-${…}` — referenced by: editor-diff.spec.ts, spotlight.spec.ts
- `search-palette-change-row-orphan.txt` — referenced by: editor-diff.spec.ts
- `search-palette-command-row-sidebar` — referenced by: spotlight.spec.ts
- `search-palette-empty` — referenced by: spotlight.spec.ts
- `search-palette-file-row-${…}` — referenced by: spotlight.spec.ts
- `search-palette-session-row-${…}` — referenced by: spotlight.spec.ts
- `session-bar-status` — referenced by: wait.ts
- `session-panel-rail-activity-dot` — referenced by: session-panel.spec.ts
- `session-panel-summary-branch` — referenced by: session-panel.spec.ts
- `session-panel-summary-changes` — referenced by: session-panel.spec.ts
- `session-panel-summary-context` — referenced by: session-panel.spec.ts
- `sessions-remove-project-dialog` — referenced by: sessions-filters.spec.ts
- `sessions-remove-project-dialog-confirm` — referenced by: sessions-filters.spec.ts
- `sessions-section-jump` — referenced by: sessions-filters.spec.ts, sessions-rows.spec.ts
- `tool-card` — referenced by: wait.ts
- `viewer-image-actual-toggle` — referenced by: viewers.spec.ts
- `viewer-image-fit-toggle` — referenced by: viewers.spec.ts
- `viewer-svg-preview-toggle` — referenced by: viewers.spec.ts
- `viewer-svg-source-toggle` — referenced by: viewers.spec.ts
- `web-fetch-card-trigger` — referenced by: tool-cards.spec.ts
- `workspace-files-panel` — referenced by: files-tree.spec.ts, page-objects.ts
- `workspace-picker-launch-${…}` — referenced by: preview.spec.ts
- `workspace-picker-launch-echo-once` — referenced by: workspace-surface.spec.ts
- `workspace-picker-launch-exit-immediately` — referenced by: workspace-surface.spec.ts
- `workspace-picker-launch-sleep-long` — referenced by: workspace-surface.spec.ts
- `workspace-picker-new-terminal` — referenced by: workspace-surface.spec.ts
- `workspace-picker-open-file` — referenced by: page-objects.ts, workspace-surface.spec.ts
- `workspace-picker-open-url` — referenced by: workspace-surface.spec.ts
- `workspace-picker-view-changes` — referenced by: workspace-surface.spec.ts
- `zone-button-tab-dropdown` — referenced by: zones.ts
- `zone-tab-dropdown-option-${mode}` — referenced by: zones.ts

## Per-spec health

| Spec | Live | Dead |
|---|---|---|
| app-tauri.ts | 0 | 0 |
| background-client.ts | 0 | 0 |
| chat-header.spec.ts | 15 | 0 |
| chat.spec.ts | 29 | 0 |
| composer-advanced.spec.ts | 77 | 10 |
| composer.spec.ts | 47 | 2 |
| daemon-picker.spec.ts | 66 | 0 |
| daemon.ts | 0 | 0 |
| directory-picker.spec.ts | 42 | 0 |
| editor-comments-review.spec.ts | 46 | 0 |
| editor-diff.spec.ts | 31 | 2 |
| editor.spec.ts | 38 | 7 |
| files-tree.spec.ts | 42 | 10 |
| find-in-path.spec.ts | 46 | 9 |
| gates.spec.ts | 40 | 0 |
| git-branch.spec.ts | 64 | 16 |
| global-setup.ts | 0 | 0 |
| layout.spec.ts | 53 | 0 |
| menus.ts | 0 | 0 |
| page-objects.ts | 18 | 3 |
| preview.spec.ts | 46 | 3 |
| review-panel.spec.ts | 65 | 0 |
| session-panel.spec.ts | 94 | 6 |
| session-tabs.spec.ts | 11 | 0 |
| sessions-draft.spec.ts | 70 | 0 |
| sessions-filters.spec.ts | 37 | 3 |
| sessions-rows.spec.ts | 28 | 1 |
| sessions-tags.spec.ts | 54 | 0 |
| sessions.spec.ts | 49 | 0 |
| settings.spec.ts | 73 | 0 |
| setup.ts | 1 | 0 |
| sidebar-chrome.spec.ts | 16 | 0 |
| spotlight.spec.ts | 31 | 9 |
| stress-matrix.spec.ts | 11 | 0 |
| tasks.spec.ts | 182 | 0 |
| testids.ts | 0 | 0 |
| tool-cards.spec.ts | 105 | 12 |
| transcript.spec.ts | 18 | 0 |
| viewers.spec.ts | 44 | 11 |
| wait.ts | 3 | 0 |
| wait.ts | 0 | 8 |
| window-states.spec.ts | 30 | 4 |
| workspace-surface.spec.ts | 43 | 11 |
| ws-control.ts | 0 | 0 |
| zones.ts | 0 | 4 |

## Untested surfaces, ranked

| Surface | Defined | Unused |
|---|---|---|
| chat | 145 | 82 |
| automations | 76 | 74 |
| tasks | 90 | 71 |
| sessions | 78 | 31 |
| skills | 23 | 23 |
| settings | 30 | 20 |
| preview | 31 | 16 |
| review | 24 | 15 |
| viewer | 19 | 12 |
| daemon | 29 | 11 |
| url | 11 | 11 |
| composer | 39 | 10 |
| provider | 9 | 9 |
| session | 38 | 9 |
| tool | 8 | 8 |
| automation | 7 | 7 |
| image | 7 | 7 |
| run | 8 | 7 |
| editor | 27 | 6 |
| git | 24 | 6 |
| sidebar | 19 | 6 |
| smart | 6 | 6 |
| main | 7 | 5 |
| named | 5 | 5 |
| search | 8 | 5 |
| workspace | 20 | 5 |
| worktree | 5 | 5 |
| file | 11 | 4 |
| push | 4 | 4 |
| thread | 4 | 4 |
| toast | 4 | 4 |
| web | 4 | 4 |
| directory | 14 | 3 |
| error | 4 | 3 |
| external | 3 | 3 |
| pairing | 3 | 3 |
| read | 3 | 3 |
| tunnel | 3 | 3 |
| app | 2 | 2 |
| edit | 2 | 2 |
| find | 9 | 2 |
| remote | 2 | 2 |
| archived | 1 | 1 |
| gate | 1 | 1 |
| import | 1 | 1 |
| new | 1 | 1 |
| quick | 1 | 1 |
| restore | 1 | 1 |
| setup | 1 | 1 |
| surface | 3 | 1 |
| dialog | 1 | 0 |
| diff | 4 | 0 |
| drop | 1 | 0 |
| markdown | 1 | 0 |
| project | 1 | 0 |
| show | 1 | 0 |
| surf | 1 | 0 |
| tour | 7 | 0 |
