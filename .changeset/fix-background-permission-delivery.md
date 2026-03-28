---
'@qlan-ro/mainframe-desktop': patch
'@qlan-ro/mainframe-core': patch
---

Keep WebSocket subscriptions alive for background chats so permission requests and status updates are not silently dropped when the user switches tabs. Emit chat.updated when permissions are enqueued/resolved so displayStatus correctly reflects 'waiting' state.
