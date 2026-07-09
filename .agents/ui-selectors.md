# UI Selector Catalog

Resolved selectors for test-worktree. Entries are HINTS for the cascade's
step-2 matching — every entry still passes step-3 DOM-verify on use; a stale
entry found wrong is corrected here in the same run.

Refreshed 2026-07-09 from a 7-branch fleet run (tauri build). The pre-refresh
catalog was electron-era and most rows no longer existed.

| NL target | Selector | Source | Confidence | Last verified |
|---|---|---|---|---|
| chat › composer input | `[data-testid="chat-composer-input"]` | dom-verify | 0.95 | 2026-07-09 |
| chat › composer send button | `[data-testid="chat-composer-send"]` | dom-verify | 0.95 | 2026-07-09 |
| chat › context percentage | `[data-testid="chat-header-context-pct"]` | dom-verify | 0.95 | 2026-07-09 |
| sessions › session row | `[data-testid="sessions-row"]` | dom-verify | 0.95 | 2026-07-09 |
| sessions › archive row action | `sessions-row` node → `.querySelector('[data-testid="sessions-row-action-archive"]')` (no aria-label) | dom-verify | 0.95 | 2026-07-09 |
| sessions › degraded marker | `[data-testid="sessions-row-meta-degraded"]` (aria-label names the cause) | dom-verify | 0.95 | 2026-07-09 |
| titlebar › branch chip | `[data-testid="main-toolbar-branch"]` (`data-worktree` reflects isolation; `main-toolbar-branch-wt` = "wt" badge) | dom-verify | 0.95 | 2026-07-09 |
| composer › worktree trigger | `[data-testid="composer-worktree-trigger"]` | dom-verify | 0.95 | 2026-07-09 |
| composer › background-activity chip | `[data-testid="composer-background-activity"]`; popover rows `composer-background-activity-item-<taskId>` | dom-verify | 0.95 | 2026-07-09 |
| chat › degraded card | `[data-testid="chat-degraded-card"]` (+ `chat-degraded-continue/-delete/-project-root/-error`) | dom-verify | 0.95 | 2026-07-09 |
| surface rail › run toggle | `[data-testid="surface-rail-run"]` | dom-verify | 0.90 | 2026-07-09 |

## Interaction techniques (this app, tauri build)

- **Hover-revealed row actions** (archive, rename, tags): the button has a
  zero-size rect until real CSS `:hover`; synthetic hovers don't reveal it.
  Click via `row.querySelector('[data-testid="..."]').click()` scoped to the
  specific row's DOM node — never by screen coordinates.
- **Session-row navigation**: text-strategy clicks and bare JS `.click()`
  don't fire the SPA router — use a real pointer event at the
  `getBoundingClientRect()` center, re-read the rect immediately before each
  click (coordinates drift as the chat streams).
- **Text-strategy clicks match substrings** ("mainframe" hits
  "mainframe-web") — prefer `data-testid` lookups via `webview_execute_js`.
- **New-session draft slot**: a draft's project cannot be reassigned via the
  project picker once the draft exists — select the project (filter pill or
  project group) BEFORE clicking "+". If a picker item click doesn't switch
  the active thread after 2 attempts, fall back to an existing idle session
  row instead of retrying.
