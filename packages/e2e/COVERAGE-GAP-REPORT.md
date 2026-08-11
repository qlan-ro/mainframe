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
| Defined | 959 |
| Referenced | 547 |
| Unused | 412 |
| Dead selectors | 12 |

## Dead selectors

- `ask-question-card` — referenced by: wait.ts
- `changes-panel` — referenced by: files-tree.spec.ts
- `chat-composer-worktree-missing` — referenced by: composer.spec.ts
- `inspector-tab-changes` — referenced by: files-tree.spec.ts
- `inspector-tab-files` — referenced by: files-tree.spec.ts
- `message-image-thumb` — referenced by: composer.spec.ts
- `permission-card` — referenced by: wait.ts
- `plan-approval-card` — referenced by: wait.ts
- `session-bar-status` — referenced by: wait.ts
- `tool-card` — referenced by: wait.ts
- `zone-button-tab-dropdown` — referenced by: zones.ts
- `zone-tab-dropdown-option-${…}` — referenced by: zones.ts

## Per-spec health

| Spec | Live | Dead |
|---|---|---|
| app-tauri.ts | 0 | 0 |
| background-client.ts | 0 | 0 |
| chat-header.spec.ts | 15 | 0 |
| chat.spec.ts | 29 | 0 |
| composer-advanced.spec.ts | 87 | 0 |
| composer.spec.ts | 47 | 2 |
| daemon-picker.spec.ts | 66 | 0 |
| daemon.ts | 0 | 0 |
| directory-picker.spec.ts | 42 | 0 |
| editor-comments-review.spec.ts | 45 | 0 |
| editor-diff.spec.ts | 33 | 0 |
| editor.spec.ts | 45 | 0 |
| files-tree.spec.ts | 49 | 3 |
| find-in-path.spec.ts | 55 | 0 |
| gates.spec.ts | 40 | 0 |
| git-branch.spec.ts | 80 | 0 |
| global-setup.ts | 0 | 0 |
| layout.spec.ts | 53 | 0 |
| menus.ts | 0 | 0 |
| page-objects.ts | 20 | 0 |
| preview.spec.ts | 49 | 0 |
| review-panel.spec.ts | 65 | 0 |
| session-panel.spec.ts | 100 | 0 |
| session-tabs.spec.ts | 11 | 0 |
| sessions-draft.spec.ts | 70 | 0 |
| sessions-filters.spec.ts | 40 | 0 |
| sessions-rows.spec.ts | 29 | 0 |
| sessions-tags.spec.ts | 54 | 0 |
| sessions.spec.ts | 49 | 0 |
| settings.spec.ts | 73 | 0 |
| setup.ts | 1 | 0 |
| sidebar-chrome.spec.ts | 16 | 0 |
| spotlight.spec.ts | 40 | 0 |
| stress-matrix.spec.ts | 11 | 0 |
| tasks.spec.ts | 182 | 0 |
| testids.ts | 0 | 0 |
| tool-cards.spec.ts | 117 | 0 |
| transcript.spec.ts | 18 | 0 |
| viewers.spec.ts | 55 | 0 |
| wait.ts | 3 | 0 |
| wait.ts | 0 | 7 |
| window-states.spec.ts | 34 | 0 |
| workspace-surface.spec.ts | 54 | 0 |
| ws-control.ts | 0 | 0 |
| zones.ts | 0 | 2 |

## Untested surfaces, ranked

| Surface | Defined | Unused |
|---|---|---|
| automations | 81 | 79 |
| chat | 150 | 53 |
| tasks | 91 | 32 |
| skills | 24 | 24 |
| sessions | 80 | 21 |
| settings | 33 | 16 |
| composer | 44 | 13 |
| preview | 31 | 13 |
| url | 11 | 11 |
| daemon | 29 | 10 |
| provider | 9 | 9 |
| session | 40 | 8 |
| sidebar | 20 | 8 |
| automation | 7 | 7 |
| editor | 28 | 7 |
| run | 8 | 7 |
| search | 16 | 7 |
| image | 7 | 6 |
| smart | 6 | 6 |
| workspace | 27 | 6 |
| git | 35 | 5 |
| main | 7 | 5 |
| push | 5 | 5 |
| viewer | 23 | 5 |
| worktree | 5 | 5 |
| error | 4 | 4 |
| toast | 4 | 4 |
| pairing | 3 | 3 |
| review | 24 | 3 |
| thread | 4 | 3 |
| tunnel | 3 | 3 |
| app | 2 | 2 |
| directory | 14 | 2 |
| edit | 2 | 2 |
| external | 3 | 2 |
| named | 5 | 2 |
| remote | 2 | 2 |
| tool | 8 | 2 |
| confirm | 1 | 1 |
| file | 13 | 1 |
| find | 9 | 1 |
| gate | 1 | 1 |
| new | 1 | 1 |
| read | 4 | 1 |
| setup | 1 | 1 |
| surface | 3 | 1 |
| trigger | 1 | 1 |
| web | 5 | 1 |
| archived | 1 | 0 |
| connection | 1 | 0 |
| dialog | 1 | 0 |
| diff | 4 | 0 |
| drop | 1 | 0 |
| import | 1 | 0 |
| markdown | 3 | 0 |
| marker | 1 | 0 |
| project | 1 | 0 |
| quick | 1 | 0 |
| restore | 1 | 0 |
| show | 1 | 0 |
| surf | 1 | 0 |
| tour | 7 | 0 |
