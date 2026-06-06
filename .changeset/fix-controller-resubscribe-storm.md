---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix a resume/`chat.updated` storm that drowned live message rendering. `useControllerState`
passed an inline `subscribe` closure to `useSyncExternalStore`, so React re-subscribed to the
controller on every render. Because `controller.subscribe()` runs `ensureWsSubscription()`
(→ a `resumeChat` POST) on subscribe and `detachWs()` when listeners hit zero, every render
fired a resume; on a chat whose `chat.updated` maps to a run-state change this self-sustained
into hundreds of `resume` calls per second. Stabilize the `subscribe`/`getSnapshot` callbacks
with `useCallback([controller])` so the store is subscribed once per controller.
