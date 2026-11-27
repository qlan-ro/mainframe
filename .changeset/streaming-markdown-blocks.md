---
'@qlan-ro/mainframe-ui': patch
---

Replies render through a streaming markdown renderer that keeps finished blocks: while an answer streams, only its last block is parsed and drawn again, so the cost of each update no longer grows with the length of the answer. An unfinished tail (an open code fence, half-written bold, a link cut mid-address) renders as what it is becoming. Code blocks in replies use the shared Code Block component and no longer end in an empty numbered line, and fenced code in user messages, the plan card, review comments and sub-agent text now renders as a code block instead of one inline run.
