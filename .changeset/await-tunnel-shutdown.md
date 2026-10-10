---
'@qlan-ro/mainframe-app-tauri': patch
---

Quitting Mainframe now waits for cloudflared tunnels to stop, including tunnels still starting. Servers that ignore graceful shutdown are forcefully stopped after a short grace period.
