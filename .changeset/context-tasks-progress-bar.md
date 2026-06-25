---
"@qlan-ro/mainframe-ui": patch
---

Add a Tasks section with a completion progress bar to the top of the Context
tab. It renders the active chat's session todos (the agent's TodoWrite list)
with a warm-chrome bar above prototype-aligned rows, shown only when todos
exist. Todos are sourced client-side from the daemon's existing `todos.updated`
event via a small global store — no daemon or contract change.
