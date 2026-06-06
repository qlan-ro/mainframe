---
"@qlan-ro/mainframe-app-tauri": patch
---

Keep the composer config toolbar (Plan / Permission / Model / Effort / Features) in
sync with daemon-side changes. It previously read a one-shot REST snapshot of the
chat and never refreshed, so when the daemon changed config on its own — e.g. the
agent exiting plan mode (`planMode → false`) after a plan approval — the toolbar
showed stale values until a manual reload. The controller now mirrors `chat.updated`
into a `chatConfig` state slice that the composer adopts live, matching the desktop
client's WS-synced store.
