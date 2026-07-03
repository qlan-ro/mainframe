---
"@qlan-ro/mainframe-ui": patch
---

Simplify the session-row status indicator to a single four-state dot: a spinning
circle while working, a pulsing coloured beacon when it's your turn (any pending
session, read or unread), a solid coloured dot for an unread response, and a
muted dot when idle. Replaces the separate "your turn" pill.
