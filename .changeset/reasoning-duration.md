---
"@qlan-ro/mainframe-ui": patch
---

Show "Thought for Ns" on the assistant reasoning block. The duration is measured
live in the client (the window during which the reasoning group is running), so
there's no daemon change; history-loaded turns and sub-second thinks keep showing
"Reasoning".
