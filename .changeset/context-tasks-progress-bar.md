---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-core": patch
---

Add a Tasks section with a completion progress bar to the top of the Context
tab. It renders the active chat's session todos (the agent's TodoWrite list)
with a warm-chrome bar above prototype-aligned rows, shown only when todos
exist. Surfaces the data via an additive `todos?` field on `SessionContext`
(threaded through the daemon context endpoint from `chat.todos`); the Context
panel also refetches on the `todos.updated` event.
