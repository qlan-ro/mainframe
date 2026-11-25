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
| Defined | 1149 |
| Referenced | 612 |
| Unused | 537 |
| Dead selectors | 20 |

## Dead selectors

- `advisor-project-${…}` — referenced by: sidebar-chrome.spec.ts
- `ask-question-card` — referenced by: wait.ts
- `changes-panel` — referenced by: files-tree.spec.ts
- `chat-composer-worktree-missing` — referenced by: composer.spec.ts
- `composer-adapter-locked-codex` — referenced by: composer-providers.spec.ts
- `inspector-tab-changes` — referenced by: files-tree.spec.ts
- `inspector-tab-files` — referenced by: files-tree.spec.ts
- `message-image-thumb` — referenced by: composer.spec.ts
- `permission-card` — referenced by: wait.ts
- `plan-approval-card` — referenced by: wait.ts
- `probe-input` — referenced by: windowed-history-measurement.spec.ts
- `probe-row` — referenced by: windowed-history-measurement.spec.ts
- `session-bar-status` — referenced by: wait.ts
- `session-panel-section-toggle-context` — referenced by: session-panel.spec.ts
- `tasks-board-project-${…}` — referenced by: sidebar-chrome.spec.ts
- `tasks-surface-pick` — referenced by: sidebar-chrome.spec.ts
- `tool-card` — referenced by: wait.ts
- `workspace-surface-close` — referenced by: workspace-surface.spec.ts
- `zone-button-tab-dropdown` — referenced by: zones.ts
- `zone-tab-dropdown-option-${…}` — referenced by: zones.ts

## Per-spec health

| Spec | Live | Dead |
|---|---|---|
| app-tauri.ts | 0 | 0 |
| automations-library.spec.ts | 28 | 0 |
| background-client.ts | 0 | 0 |
| chat.spec.ts | 29 | 0 |
| compact-transcript.spec.ts | 21 | 0 |
| composer-advanced.spec.ts | 87 | 0 |
| composer-catalog.spec.ts | 3 | 0 |
| composer-providers.spec.ts | 17 | 2 |
| composer.spec.ts | 39 | 2 |
| daemon-picker.spec.ts | 66 | 0 |
| daemon.ts | 0 | 0 |
| directory-picker.spec.ts | 42 | 0 |
| editor-comments-review.spec.ts | 45 | 0 |
| editor-diff.spec.ts | 33 | 0 |
| editor.spec.ts | 45 | 0 |
| facade-protocol-partial.spec.ts | 0 | 0 |
| facade-protocol-streaming.spec.ts | 0 | 0 |
| facade-protocol-support.ts | 0 | 0 |
| facade-protocol.spec.ts | 0 | 0 |
| facade-queued-prompt.spec.ts | 0 | 0 |
| facade-reconnect-mid-stream.spec.ts | 1 | 0 |
| facade-streaming-segments.spec.ts | 1 | 0 |
| files-tree.spec.ts | 49 | 3 |
| find-in-path.spec.ts | 55 | 0 |
| focus-line.spec.ts | 6 | 0 |
| fork-from-message.spec.ts | 21 | 0 |
| gates.spec.ts | 81 | 0 |
| git-branch.spec.ts | 75 | 0 |
| global-setup.ts | 0 | 0 |
| headless-chat.ts | 0 | 0 |
| history-paint.ts | 6 | 0 |
| history-performance-wire.ts | 0 | 0 |
| history-performance.ts | 13 | 0 |
| layout.spec.ts | 44 | 0 |
| live-adapter.spec.ts | 1 | 0 |
| mcp-delegate.spec.ts | 22 | 0 |
| menus.ts | 0 | 0 |
| new-session-prefill.spec.ts | 15 | 0 |
| overlay-scrollbars.spec.ts | 10 | 0 |
| page-objects.ts | 20 | 0 |
| plan-clear-context.spec.ts | 6 | 0 |
| port-guard.ts | 0 | 0 |
| preview.spec.ts | 49 | 0 |
| provider-switch.spec.ts | 8 | 0 |
| raw-ws-client.ts | 0 | 0 |
| review-panel.spec.ts | 65 | 0 |
| selection-hold.spec.ts | 11 | 0 |
| session-panel-jumps.spec.ts | 10 | 0 |
| session-panel.spec.ts | 122 | 1 |
| session-tabs.spec.ts | 22 | 0 |
| sessions-draft.spec.ts | 70 | 0 |
| sessions-filters.spec.ts | 37 | 0 |
| sessions-list.spec.ts | 26 | 0 |
| sessions-rows.spec.ts | 36 | 0 |
| sessions-tags.spec.ts | 49 | 0 |
| sessions.spec.ts | 51 | 0 |
| settings.spec.ts | 72 | 0 |
| setup.ts | 1 | 0 |
| sidebar-chrome.spec.ts | 20 | 3 |
| spotlight.spec.ts | 40 | 0 |
| stress-matrix.spec.ts | 15 | 0 |
| tasks.spec.ts | 171 | 0 |
| testids.ts | 3 | 0 |
| title-bar.spec.ts | 25 | 0 |
| tool-cards-history.spec.ts | 20 | 0 |
| tool-cards.spec.ts | 95 | 0 |
| transcript.spec.ts | 20 | 0 |
| viewers.spec.ts | 55 | 0 |
| wait.ts | 3 | 0 |
| wait.ts | 0 | 7 |
| window-states.spec.ts | 34 | 0 |
| windowed-history-lifecycle.spec.ts | 30 | 0 |
| windowed-history-measurement.spec.ts | 4 | 7 |
| windowed-history-performance.spec.ts | 0 | 0 |
| windowed-history-protocol.spec.ts | 0 | 0 |
| windowed-history-virtualization.spec.ts | 27 | 0 |
| windowed-history.spec.ts | 22 | 0 |
| windowed-history.ts | 0 | 0 |
| windowed-history.ts | 0 | 0 |
| workspace-chats.spec.ts | 40 | 0 |
| workspace-surface.spec.ts | 50 | 1 |
| ws-control.ts | 0 | 0 |
| zones.ts | 0 | 2 |

## Untested surfaces, ranked

| Surface | Defined | Unused |
|---|---|---|
| chat | 191 | 83 |
| automations | 92 | 80 |
| tasks | 91 | 43 |
| sessions | 97 | 28 |
| settings | 41 | 24 |
| skills | 24 | 24 |
| session | 76 | 22 |
| composer | 50 | 17 |
| external | 15 | 14 |
| preview | 31 | 13 |
| url | 12 | 12 |
| workspace | 40 | 11 |
| daemon | 26 | 9 |
| shell | 13 | 9 |
| usage | 10 | 9 |
| viewer | 27 | 9 |
| editor | 28 | 7 |
| run | 8 | 7 |
| search | 16 | 7 |
| artifact | 6 | 6 |
| image | 8 | 6 |
| title | 9 | 6 |
| automation | 5 | 5 |
| git | 35 | 5 |
| push | 5 | 5 |
| review | 26 | 5 |
| smart | 5 | 5 |
| toast | 8 | 5 |
| worktree | 5 | 5 |
| error | 4 | 4 |
| html | 4 | 4 |
| pairing | 3 | 3 |
| shortcuts | 3 | 3 |
| tool | 10 | 3 |
| tunnel | 3 | 3 |
| app | 2 | 2 |
| csv | 2 | 2 |
| directory | 14 | 2 |
| edit | 2 | 2 |
| file | 14 | 2 |
| idle | 2 | 2 |
| md | 2 | 2 |
| named | 5 | 2 |
| project | 2 | 2 |
| remote | 2 | 2 |
| sidebar | 6 | 2 |
| web | 6 | 2 |
| confirm | 1 | 1 |
| content | 1 | 1 |
| dialog | 2 | 1 |
| find | 9 | 1 |
| gate | 1 | 1 |
| new | 1 | 1 |
| read | 4 | 1 |
| setup | 1 | 1 |
| thread | 3 | 1 |
| transcript | 1 | 1 |
| trigger | 1 | 1 |
| welcome | 5 | 1 |
| advisor | 2 | 0 |
| archived | 1 | 0 |
| connection | 1 | 0 |
| diff | 4 | 0 |
| import | 1 | 0 |
| main | 2 | 0 |
| markdown | 3 | 0 |
| marker | 1 | 0 |
| quick | 1 | 0 |
| restore | 1 | 0 |
| show | 1 | 0 |
| side | 4 | 0 |
| surf | 1 | 0 |
| surface | 2 | 0 |
| tour | 8 | 0 |
