---
"@qlan-ro/mainframe-core": patch
---

fix: stop button now works when background subagents are running

Send SIGINT to CLI child process on interrupt to bypass the blocked stdin
message loop. Also prevent message loss from the interrupt race condition
by waiting for the process to fully exit before respawning.
