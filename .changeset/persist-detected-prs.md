---
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-desktop": patch
---

Persist detected PRs to the database. Previously they lived only in the renderer's in-memory `detectedPrs` Map, which was rebuilt by replaying events from the daemon's per-`loadChat` history scan — so PR badges only appeared on sessions the user had opened during the current daemon lifetime. PRs are now stored on the chat row (new `detected_prs` column) by both the live `onPrDetected` sink and the history-replay scan, with URL-based dedup and `mentioned → created` source upgrades. The renderer seeds its Map from `chat.detectedPrs` on chat list load, so badges show on the sidebar immediately on app start.
