---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
"@qlan-ro/mainframe-ui": patch
---

Show the Claude "workspace not trusted" advisory as an actionable permission toast with a one-click Trust action, instead of a false "Agent run failed" error. The daemon now classifies the non-fatal stderr advisory as a dedicated `chat.trustRequired` event (no run-failure flip), a new `POST /api/chats/:id/trust-workspace` route writes `hasTrustDialogAccepted` into `~/.claude.json`, and the toast description reuses a newly-extracted shared `ReadMore` primitive.
