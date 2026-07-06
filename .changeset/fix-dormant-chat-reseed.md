---
'@qlan-ro/mainframe-ui': patch
---

Fix background sessions losing messages while another chat is open.

A chat's live WS subscription is gated to the active thread, so a backgrounded
chat receives no message events while dormant — the daemon still persists them,
but the transcript stayed frozen at the pre-dormancy snapshot. On `subscribe:ack`
the catch-up re-seed only fired for a socket reconnect or an unreconciled
optimistic send, so simply switching back to a chat never healed the gap and the
messages that arrived while it was backgrounded stayed invisible until a full
reconnect.

The controller now tracks when a live sub is torn down and treats the next
attach as a post-dormancy reattach, re-seeding history from REST on the reattach
ack (like a reconnect). Row-level unread notifications were unaffected — they run
on a separate always-on session-list subscription — so this only restores the
missed transcript content on switch-back.
