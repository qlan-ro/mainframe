---
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-app-tauri': patch
---

Fix the Review panel's change scopes. Branch now diffs each file against the branch's merge base instead of HEAD, so changes already committed on the branch show up, and renamed files read their original from the old path. Session now lists every file the session wrote or edited, committed or not, marked added, modified or deleted, and diffs each one from the session's own edits. When later work stops those edits from replaying, the diff compares the file with the last commit before the session started and says so. Switching scopes no longer opens the previous scope's first file. Uncommitted now lists new files inside new directories. Scopes that report no line counts no longer show `+0 −0`.
