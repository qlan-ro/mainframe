---
'@qlan-ro/mainframe-app-tauri': patch
---

Keep chat completion, send, and teardown events flowing when storage fails, and restart chats on failed worktree or configuration changes. Report a created worktree's path when attaching it fails; keep notifications ordered with the turn that produced them.

Stop launches and tunnels before deleting worktrees, including unbound path aliases, then publish status from the live chat. Imported chat creation and title updates now both include display status, running state, and missing-directory fields. Chat list/get requests return 500 on storage failure, failed creation returns an error instead of a stub, and fork snapshot cleanup stops on a database failure.
