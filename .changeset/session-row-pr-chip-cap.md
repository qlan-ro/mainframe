---
'@qlan-ro/mainframe-ui': patch
---

Fix a session row's PR chip vanishing under width pressure: at most one PR ever renders inline (the most recent, created preferred over merely-mentioned), a count indicator always stands in above one PR, and hover no longer reflows the row — only the purely decorative worktree glyph and tag dots yield width, one at a time, and only ever at their own natural size.
