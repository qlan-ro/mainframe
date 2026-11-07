---
"@qlan-ro/mainframe-app-tauri": patch
---

`~/.mainframe/config.json`, which holds the device auth secret and tunnel token, is now readable only by your user, and existing files are tightened at the next daemon start. Removing a named tunnel in Settings now deletes its saved token and URL. Saving settings no longer writes environment overrides such as `TUNNEL_TOKEN` to disk, keeps keys it does not recognise, and moves an unreadable config aside as `config.json.invalid.<timestamp>` instead of overwriting it. Trusting a workspace no longer widens the permissions of `~/.claude.json`. The daemon finds your `PATH` when shell start-up files print a banner and no longer hangs at start-up on a stuck shell. Automation `run_command` steps finish when a background job outlives the script, and the job keeps running, and Codex and CLI updates keep running after a non-UTF-8 output line.
