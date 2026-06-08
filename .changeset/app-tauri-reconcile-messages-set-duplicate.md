---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix duplicate user-message bubble. The optimistic-send reconcile only cleared a
pending against a live `display.message.added`; but the daemon broadcasts a full
`display.messages.set` whenever it can't detect a pure append, which the client
routes as a `history.loaded` event — and that branch never reconciled, so the
optimistic copy lingered next to the server echo as a duplicate bubble. This is
frequent live, not a first-message edge case: the Codex adapter regenerates every
display id (`nanoid`) on each reconstruction, so the daemon re-sets on essentially
every turn. The live `history.loaded` path now runs the same count-aware reconcile
against the user messages in the set, matching the REST history-seed path.
