---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-ui": minor
---

Add optional daemon-observed start and completion timestamps for individual tool calls, including nested calls. ACP and native chat tool parts preserve those values across reconnects while the session cache is retained. Empty successful results, failures, and observed cancellation close timing without requiring output text.

Daemon-only timing is lost after cache release, eviction, or restart unless trustworthy timestamps are present in loaded history. Legacy history remains untimed. Codex Bash currently reports tool use at completion, so its observed interval can be near zero and does not measure command execution duration.
