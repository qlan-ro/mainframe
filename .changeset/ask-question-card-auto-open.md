---
"@qlan-ro/mainframe-ui": patch
---

Fix AskUserQuestionCard (and PlanCard) so the answer body auto-opens when a
pending tool-call card transitions to answered on an already-mounted
instance, instead of relying on `defaultOpen` (which only applies at mount
and never re-fires on rerender). Manual collapses on an already-answered
card are still preserved.
