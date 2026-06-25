---
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-app-electron": minor
---

Migrate the stateless chat commands from WebSocket to REST. `chat.create`, `chat.updateConfig`, `chat.interrupt`, `chat.resume`, and the queued-message edit/cancel are now REST endpoints (`POST /api/chats`, `PATCH /api/chats/:id/config`, `POST /api/chats/:id/{interrupt,resume}`, `PATCH`/`DELETE /api/chats/:id/queue/:messageId`) returning the canonical envelope; the dead `chat.end` command is removed. The WebSocket is reserved for streaming and server-push — the 7 migrated inbound handlers and their `ClientEvent` variants are gone, so unsupported sends fail at compile time. A new `subscribe:ack` lets clients confirm a subscription is registered before resuming. `chat.created` is now a pure list-sync upsert (navigation is driven by the REST caller), and the `originClientId` attribution hack is removed. Hard cutover: the desktop client is migrated in this change; the mobile client ships the matching change in its own repo.
