---
'@qlan-ro/mainframe-ui': patch
---

Stop showing two working indicators at once. While a tool call was the last part of a running turn, the message rendered a bare pulse dot on top of the thread's "Working… 12s" row, with the message timestamp between them. The per-message dot is now suppressed in the main thread and kept only in nested subagent transcripts, which have no thread-level indicator.
