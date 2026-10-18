---
"@qlan-ro/mainframe-app-tauri": patch
---

A Codex usage limit that Codex stops reporting (for example the 5-hour window after a plan change) no longer stays on screen at its last value. Codex snapshots now replace the stored limits, Refresh clears a dropped one, and limits from Codex's other metered buckets no longer overwrite the plan's.
