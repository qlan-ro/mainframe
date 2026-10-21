---
"@qlan-ro/mainframe-app-tauri": patch
---

Aborting a merge or rebase from the branch menu now works in a project's main checkout, the branch list shows the merge or rebase in progress there, and a rebase that stops on conflicts reports them instead of failing. Committing with no changes now says "Nothing to commit". Branch and remote names that look like git options are passed to git as names, never as options.
