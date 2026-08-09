---
'@qlan-ro/mainframe-app-tauri': patch
---

The daemon no longer discards a chat's events for the client that sent the
message. A client that sends a message and only then subscribes to the chat
used to lose its own message's events for that connection — there was no
replay. The sending connection is now a subscriber of the chat it sends to,
released as usual on unsubscribe or disconnect.
