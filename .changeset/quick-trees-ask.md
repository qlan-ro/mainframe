---
'@qlan-ro/mainframe-core': patch
---

Fix AskUserQuestion answered-question rendering losing the question and answer text. The result parser used a blind regex that broke whenever a question or answer contained a double quote (the question text was truncated/dropped) and split every answer on commas (mangling free-text answers). It now anchors on the exact known question strings from the tool input, preserves free-text answers verbatim, and only comma-splits multi-select answers.
