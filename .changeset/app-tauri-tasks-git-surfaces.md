---
"@qlan-ro/mainframe-app-tauri": minor
---

Port the Tasks/Todos and Git branches surfaces into app-tauri. Tasks ships an Inspector bottom drawer plus a fullview modal (List + Board, filter/sort, create/edit + quick-add, start-session) backed by the todos daemon plugin. Git ships a full-parity BranchPopover on the toolbar branch pill (list/switch/create, fetch/pull/push/merge/rebase/abort, delete/rename, worktree new-session/delete, conflict view) reusing the existing git/worktree daemon routes. Sandbox-side Tags were dropped (already covered by the shipped sessions tag system); Run/Sandbox launch/capture/preview is deferred with the preview-webview.
