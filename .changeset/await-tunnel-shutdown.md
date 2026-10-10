---
'@qlan-ro/mainframe-app-tauri': patch
---

Quitting the desktop app now gives the daemon up to 10 seconds to shut down cleanly instead of killing it at once. While shutting down, and whenever a tunnel or Run-panel preview is stopped, the daemon waits for the cloudflared process to exit, including tunnels still starting, and force-kills any that ignore the stop request after 2 seconds. Language servers get the same fallback.
