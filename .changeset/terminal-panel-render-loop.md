---
'@qlan-ro/mainframe-desktop': patch
---

Fix TerminalPanel infinite render loop on app startup. The `getTerminals` selector returned a fresh `[]` for any project without a stored entry, causing `useSyncExternalStore` to detect a new snapshot every render and crash the renderer with React error #185 (Maximum update depth exceeded). Returns a stable empty-array reference instead. Also adds the missing `getHomedir` field to the renderer's `MainframeAPI` type so the preload contract typechecks end-to-end.
