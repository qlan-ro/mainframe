---
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-core': patch
---

Fix plan-mode approval on the Rust daemon: approving a plan now applies the execution mode you chose, and "clear context and implement" restarts the session with the plan instead of leaving it stuck in plan mode.
