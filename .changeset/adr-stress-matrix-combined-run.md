---
"@qlan-ro/mainframe-e2e": patch
---

Add the combined ADR stress-matrix e2e run: one chat, one flow covering a long
chat, a nested subagent with a mid-turn permission (including gate restore
across a WebSocket drop), a reconnect mid-stream (convergence plus open tool
card, composer draft, and scroll survival across the history re-seed), and
optimistic send + echo dedup through a reconnect. Adds a `page.routeWebSocket`
drop lever (`helpers/tauri/ws-control.ts`) and the `stress-matrix` recording.
