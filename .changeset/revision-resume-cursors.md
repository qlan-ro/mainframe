---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Resuming a chat after a reconnect now recovers changes to messages the client already held — a late turn-duration update, an edited item, or a deletion — instead of only items created after the last one it saw. The client negotiates this with the daemon automatically; older daemons keep working exactly as before.
