---
"@qlan-ro/mainframe-app-tauri": patch
---

Stop a port tunnel request that the client abandons mid-start from blocking that port's tunnels until the daemon restarts. Stop a launch configuration from staying "starting" forever when its start request is dropped while the port is awaited, and stop opening a preview tunnel for a launch that was stopped or crashed before its port came up. Keep reading cloudflared's output after a non-UTF-8 log line instead of losing the tunnel. Reject a `launch.json` port outside 1–65535 instead of waiting on a truncated port, and stop a fast-exiting launch process from leaving a stale entry in the crash-recovery pidfile.
