---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix the Tauri shell ignoring the `DAEMON_PORT` env var. `daemon_port()` read an
env variable with a malformed name (the function name had leaked into the string
literal), so it always fell back to 31500 regardless of what the dev launch
configs set — leaving the dev shell unable to reach the configured daemon
(`DAEMON_PORT`, default 31416). It now reads `DAEMON_PORT` correctly, with the
parse/fallback logic extracted into a tested pure helper.
