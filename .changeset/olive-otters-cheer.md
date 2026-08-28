---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

The daemon now speaks the Agent Client Protocol (ACP v2) for chat. A new `/acp/{adapter-profile}` WebSocket endpoint serves the full facade: version-negotiated handshake, prompt acceptance and cancellation against live sessions, delta-only streaming with stable item IDs (a growing message is never re-sent whole), provider-retry markers instead of silently dropped `api_retry` events, resume-from-cursor replay that replaces the four separate reconnect mechanisms, and permission gates that stay consistent across the new and the existing chat surface. The existing WebSocket dialect is unchanged and frozen; desktop and mobile keep using it until each cuts over.
