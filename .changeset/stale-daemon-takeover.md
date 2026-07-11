---
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Replace stale daemons from previous installs instead of dying silently. An app update could orphan the old daemon on the port: the new daemon crashed on EADDRINUSE with no log line, its zombie went unnoticed, and the UI kept talking to the old, contract-skewed process ("Couldn't load this chat", wrong model catalogs). The daemon now probes the port's occupant before binding and terminates it when it is a Mainframe daemon of a different version (same-version duplicates and foreign processes are left alone), surfaces bind failures as logged fatal errors, and reports its pid via /health. The Tauri shell now reaps the sidecar on kill and watches for unexpected daemon exits, surfacing them through daemon:status instead of leaving a zombie.
