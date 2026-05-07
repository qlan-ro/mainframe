---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Add session row tagging.

Sessions can now be tagged with user-defined tags via right-click → Tags or by clicking the tag row on hover. The sessions panel header gains a tag filter row with synthetic `has-pr` and `has-worktree` chips alongside user tags; multiple selected chips combine with strict AND. The session row layout moves the worktree pill and PR badge into the title row and replaces the project · branch · time metadata line with a dedicated tag row.
