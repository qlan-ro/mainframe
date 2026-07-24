---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix a stop→restart race in the launch manager: restarting a config while its previous process was still being torn down (SIGTERM grace window) was silently ignored, leaving the preview stuck on the stopped CTA. `start` now waits for the dying process to exit and then spawns fresh; only genuinely starting/running processes still skip the duplicate start.
