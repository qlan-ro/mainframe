---
'@qlan-ro/mainframe-ui': patch
---

Fix the session archive flow. Archiving a session with no git worktree no longer raises a confirm dialog — there was nothing to decide, since the dialog exists only to ask what should happen to the worktree.

Sessions with a worktree are now asked before anything moves, not after. assistant-ui switches the active thread away the moment `archive()` is called, so prompting from inside the adapter changed the selected session while the dialog was still open, and cancelling stranded the user on an empty draft instead of returning them to the session they had just chosen to keep. The row now settles the question first and only then archives, so a cancel leaves both the session and the selection untouched.

Project rows offer a remove button on hover, alongside the existing right-click menu item. The session row's archive action uses an archive icon instead of an X.
