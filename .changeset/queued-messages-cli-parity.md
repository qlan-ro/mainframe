---
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-types": minor
---

Forward messages to the Claude CLI immediately instead of holding them in a
daemon queue, restoring CLI-native mid-turn drain and between-turn batching.
Queued bubbles move to the CLI's consumption point on each replay ack
(move-on-process), edit/cancel round-trip through cancel_async_message with
silent reconcile on a lost race (the message.queued.cancel_failed event is
removed), and mid-turn-drained messages now load from their queued_command
JSONL attachment entries on reload — previously they vanished from restored
history.
