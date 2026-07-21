---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix the Rust daemon killing its own cloudflared tunnel moments after it connects. The tunnel manager stopped reading the child's stdout/stderr once the tunnel registered, closing the pipes; cloudflared died on SIGPIPE at its next log write (~100ms after "ready"). A drain task now keeps reading for the child's whole life, matching the Node daemon's persistent data handlers.
