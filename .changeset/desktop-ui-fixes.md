---
"@qlan-ro/mainframe-desktop": patch
---

Fix three HIGH priority desktop UI bugs:
- #149: Remove overflow-hidden clipping that prevented worktree dialog and "/" popover from displaying
- #150: Reorder SystemMessage rendering logic to prioritize compaction pills and suppress unwanted artifacts
- #151: Preserve Monaco editor scroll position when external file modifications trigger value updates
