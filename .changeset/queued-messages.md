---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-desktop": minor
---

Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).
