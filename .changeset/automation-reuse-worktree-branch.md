---
"@qlan-ro/mainframe-app-tauri": patch
---

An automation's Ask agent step with a fixed worktree branch now runs again after its first run instead of failing with "a branch named … already exists". It continues in the worktree that has the branch checked out, or checks the existing branch out into a new worktree.
