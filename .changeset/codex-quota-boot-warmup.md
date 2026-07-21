---
'@qlan-ro/mainframe-core': patch
---

Codex quota now warms up with one automatic pull at daemon boot (both Node and Rust daemons), so the ambient indicator is populated on app start instead of waiting for a manual refresh. Codex still has no polling timer — beyond boot it stays manual refresh + session pushes.
