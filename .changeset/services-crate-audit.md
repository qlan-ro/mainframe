---
"@qlan-ro/mainframe-app-tauri": patch
---

Stop disabling or archiving a chat's worktree from deleting a directory that is not a linked worktree, such as the project checkout itself. Fix a file-watch race that could hang the daemon or silently stop file change events when a watch was shared or closed mid-change. Stop sending mobile pushes to tokens Expo reports as unregistered, give each push request a deadline, and stop the worktree backfill from making two projects each other's parent.
