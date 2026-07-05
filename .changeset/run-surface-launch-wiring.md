---
'@qlan-ro/mainframe-ui': patch
---

Fix two Run-surface launch-wiring bugs found during e2e live verification: starting a config from the Run surface's own picker/add-menu never refetched launch status, so a fast subprocess's buffered console output was invisible unless the toolbar's launch popover happened to reopen afterward; and the toolbar/preview run control could get stuck showing "Stop" after a process had actually stopped. Both `handleLaunch` and `handleStop` now refetch launch status after their REST call settles, re-syncing from the daemon's authoritative state.
