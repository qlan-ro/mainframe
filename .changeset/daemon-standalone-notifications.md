---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Anything running on this machine can now raise a Mainframe notification, not just a step inside an automation run. Work that an automation launches — a todo lane, a script, a scheduled job — reaches the desktop and your phone the same way an automation's own `notify` step does.

This closes a gap that made scheduled work silent: a lane invoked from an automation runs as a CLI session, which has no notification tool of its own, so it had no way to say a stage had started or finished.
