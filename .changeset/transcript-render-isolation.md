---
'@qlan-ro/mainframe-ui': patch
---

Make the chat transcript responsive again: a streamed chunk now re-renders only the message it touched instead of every text part and tool card in the transcript, transcript-only updates no longer re-render the composer, gates and session panel, and a long chat mounts its newest messages first and reveals the rest in deferred batches instead of blocking until the whole history has rendered.
