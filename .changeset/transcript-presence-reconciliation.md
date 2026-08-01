---
'@qlan-ro/mainframe-app-tauri': patch
---

Fix the degraded-chat recovery card never appearing when a session's CLI
transcript was deleted from disk. The daemon never checked whether a
transcript actually existed, so a chat pointing at a missing transcript kept
showing as healthy: no recovery card, and sending a message resumed the dead
session id instead of resetting it first.

Reconciliation now runs both when a chat's history loads and on the periodic
background sweep, so a chat you're not currently viewing also picks up the
"transcript deleted" state. Restoring the transcript file still clears the
flag on the next reconciliation.
