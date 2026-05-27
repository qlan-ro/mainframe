---
'@qlan-ro/mainframe-core': patch
---

Send `message.queued.snapshot` on `chat.resume` so the composer banner
reconverges on the daemon's truth whenever the client re-opens a chat.

Previously only the (rarely-used) `subscribe` WS handler emitted this
snapshot; `chat.resume` (which the desktop fires every time a chat view
mounts) just added the chat to the subscription set without seeding the
queue state. The result: a queued message that the CLI processed while
the client was unsubscribed (because the user had switched chats) would
stay stranded in the composer banner forever, even though the daemon
had already pruned the ref. The bubble's `metadata.queued` flag silently
cleared on re-entry — `useChatSession` HTTP-refetches messages from
JSONL, which never carries that transient flag — so the user saw a
stuck composer entry alongside a clean message bubble.

The two WS handlers now share a private `sendQueuedSnapshot` helper.
