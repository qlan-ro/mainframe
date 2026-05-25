---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
'@qlan-ro/mainframe-types': minor
---

feat: surface Claude background tasks in chat session bar

Adds a chat-header pill showing running and completed-with-output
Claude background tasks (run_in_background Bash, Monitor). Kill via
the CLI's own `stop_task` control_request; View shows a bounded tail
of the spool file (terminal status only). MVP scope — persistence,
auto-reap on chat archive, live tailing, and Monitor inline streaming
are tracked as follow-up todos.
