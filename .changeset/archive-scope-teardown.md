---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-ui": patch
---

Release a session's launch scope when it's archived. When archiving a chat that
is the last active (non-archived) chat using its launch scope
(`projectId:effectivePath`), the daemon now stops that scope's dev-server
processes — even when the worktree is kept (`deleteWorktree=false`) — and emits a
new additive `launch.scopeReleased` event. The client reacts by pruning that
scope's Run tabs and disposing their terminal PTYs. Scopes still shared by another
active chat are left untouched, so sibling sessions keep their dev servers and
tabs. Worktree-deletion semantics are unchanged.
