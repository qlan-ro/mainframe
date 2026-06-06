---
"@qlan-ro/mainframe-app-tauri": patch
---

Harden permission reply + resume against a flaky socket (review #2/#3/#5, patterned
on the desktop client). `replyToPermission` re-checks delivery 3s later and restores
the gate if the answer was dropped while the socket was closed; the subscribe-ack
fallback no longer resumes while disconnected (it would address a dead subscription);
and `restorePendingPermission` no longer resurrects a permission you just answered
while the reply is still in flight.
