---
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-app-tauri': patch
---

Fix the Review panel's change scopes. Branch now diffs each file against the branch's merge base instead of HEAD, so changes already committed on the branch show up, and renamed files read their original from the old path. Session lists the files the session wrote or edited that still have uncommitted changes, with repo-relative paths, status badges and line counts. Uncommitted now lists new files inside new directories. Scopes that report no line counts no longer show `+0 −0`.
