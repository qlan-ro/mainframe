---
"@qlan-ro/mainframe-ui": patch
---

Add a composer worktree control: isolate the active chat into a new or existing
git worktree directly from the composer toolbar. Ported from the desktop
WorktreePopover (active-info / new-worktree / attach-existing states with
branch-name validation and a mid-session warning), built on shadcn Popover and
the shared menu primitives, backed by new `enableWorktree`/`attachWorktree` REST
wrappers.
