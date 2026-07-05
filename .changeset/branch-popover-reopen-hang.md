---
'@qlan-ro/mainframe-ui': patch
---

Fix the git BranchPopover hanging on reopen: closing the popover mid-fetch and reopening it could let a stale, late-arriving branch/status response overwrite the fresh reopen's data, in the worst case stranding the reopened popover on the conflict view.
