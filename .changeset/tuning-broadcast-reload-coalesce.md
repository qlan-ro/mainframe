---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Two fixes surfaced by the app-tauri e2e harness:

- **core: broadcast `chat.updated` on tuning PATCH.** `PATCH /api/chats/:id/tuning`
  (effort/features) persisted to the DB but never emitted `chat.updated`, so
  server-authoritative clients never reflected the change — the app-tauri composer
  effort/feature chip stayed stale until an unrelated broadcast. `applyChatTuning`
  now calls a new `ChatManager.emitChatUpdated` (enriched re-emit) after persisting,
  matching the `/config` path that already broadcast.
- **app-tauri: coalesce session-list reloads.** The sessions list ran a full
  `runtime.threads.reload()` on every `chat.updated` — high-frequency during a run
  (cost/token churn) and now on every tuning PATCH. A leading-edge debounce collapses
  the burst into one reload (the first still fires immediately), removing the refetch
  storm and a nav-race where a mid-run reload reverted the active thread.
