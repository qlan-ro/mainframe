---
'@qlan-ro/mainframe-app-tauri': patch
---

Consolidate daemon process handling into one module: Codex app-server shutdown now asks politely (SIGTERM, 800 ms) before SIGKILL, CLI exits are reported only after their last output was delivered, and writes to a CLI that stopped reading its stdin fail instead of buffering without limit (a Codex approval reply that cannot be delivered now shows as an error). Restarting a launch config right after it exits no longer marks the new process stopped or closes its preview tunnel, and an LSP server that stopped reading its input is still shut down.
