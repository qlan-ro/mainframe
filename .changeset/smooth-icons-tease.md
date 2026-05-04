---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Stop the desktop from auto-switching its active chat when another client (e.g. mobile) creates a new session. The daemon now stamps `chat.created` events with an `originClientId` derived from the originating WebSocket connection, and the desktop only opens/selects the new chat when the event originated locally. Each client receives its own id via a new `connection.ready` event sent on WS open.
