---
'@qlan-ro/mainframe-ui': patch
---

Keep the first user message visible after sending it in a new session. The draft controller that held the message was discarded when the session switched to its canonical id, and the blank replacement seeded itself from a history read the daemon had not written the message to yet.
