---
"@qlan-ro/mainframe-core": patch
---

fix(core): deduplicate display messages by id to prevent assistant-ui crash

The Claude CLI can reuse UUIDs for compact_boundary entries, producing duplicate
message ids in the display pipeline. assistant-ui's MessageRepository throws when
it encounters the same id twice. Now `prepareMessagesForClient` skips messages
whose id was already emitted.
