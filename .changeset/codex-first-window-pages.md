---
"@qlan-ro/mainframe-app-tauri": patch
---

Open an uncached Codex chat faster: the first transcript window now comes from the newest turns (`thread/turns/list`) instead of waiting for the whole thread to load. CLIs without that method keep the full read.
