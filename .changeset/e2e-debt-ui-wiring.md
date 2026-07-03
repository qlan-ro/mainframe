---
"@qlan-ro/mainframe-ui": patch
---

Fix e2e-blocking UI wiring debt found while authoring the app-tauri Playwright suite:
wire `DiffTab` to pass `filePath` into `DiffHeader` so the diff-tab Reveal button can render;
refresh the toolbar branch chip after a `BranchPopover` checkout/merge/rebase/rename/delete by
re-reading the live branch instead of the stale persisted `chat.branchName`; and add missing
`data-testid`s (`tool-card-status-dot`, `marker-body`, `sidebar-bottom-panel`,
`sessions-tag-popover-name-error`, `data-queued-id` on `QueuedUserTurn`, `daemon-add-reachable`/
`daemon-add-unreachable`/`daemon-add-retry`) so e2e specs can assert these elements by testid
instead of class/text selectors.
