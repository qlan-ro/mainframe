---
'@qlan-ro/mainframe-ui': minor
---

Rebuild the sessions sidebar: compact single-line rows, a hover detail card, a one-click project switcher list, and an opt-in "Sort by Project" grouping mode.

Session rows collapse from two lines to one — the status indicator, title, and time now share a single row, with worktree/PR/tag info reduced to small trailing glyphs. Hovering a row raises a floating detail card with the full project, worktree/branch, PR, tag, and branch-safety information the row no longer shows inline. The Projects filter bar becomes a vertical switcher list ("All projects" plus one row per project with a colored initial avatar and attention badge) instead of a wrapping pill cloud, and selecting a project is now a plain single-select switch rather than a toggle. The sessions Sort By menu gains a "Project" option that groups the list into one section per project; the time-based default is unchanged. Relative timestamps for same-day sessions now read as a short duration ("5m", "2h") instead of a clock time. The worktree glyph switches from `GitFork` to `FolderGit2` everywhere it represents a worktree (composer, toolbar, git panel, session rows), leaving the unrelated branch glyph untouched.
