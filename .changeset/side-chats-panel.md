---
'@qlan-ro/mainframe-ui': minor
---

Adds the side-chat panel (#344): a compact chat docked at the bottom of a parent's chat column (its zone in a split, or the single view), with its own header showing running/waiting status, collapse, and close. The composer offers model and permission controls but no adapter switch, worktree controls, or Temporary toggle, since a side chat's adapter is a one-time copy of its parent's. The panel shows a slim, parent-keyed notice — "Earlier context was not preserved" after a no-persistence restart, or "This provider keeps its own transcript for this chat" when the adapter resumes with history — never both, and never the full-size chat notice.
