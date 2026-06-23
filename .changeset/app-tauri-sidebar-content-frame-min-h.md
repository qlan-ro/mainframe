---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix the sidebar's Context/Skills/Agents panel and footer disappearing when the
session list is long. The sidebar content frame was missing `min-h-0`, so with
many sessions it grew past the sidebar instead of letting the inner list scroll,
pushing the bottom panel + footer below the `overflow-hidden` clip and out of view.
