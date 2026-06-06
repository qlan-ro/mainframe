---
"@qlan-ro/mainframe-app-tauri": patch
---

Recover gracefully from WS disconnects/reloads. The chat controller now (a) restores a
pending permission on load/reconnect via `GET /api/chats/:id/pending-permission` and seeds
the gate — the daemon does not re-emit `permission.requested` on subscribe/resume, so a
gate requested during a disconnect was previously lost; and (b) reconciles optimistic user
messages against re-seeded history on refetch, so a reconnect no longer drops the permission
gate or leaves a duplicate of the just-sent message.
