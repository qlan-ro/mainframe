---
'@qlan-ro/mainframe-app-tauri': minor
'@qlan-ro/mainframe-ui': minor
---

Codex chats can now fork through the same Fork menu item, REST route and `parentChatId` lineage #343 built for Claude (#368). Forking calls the app-server's `thread/fork` RPC with the parent's thread id and its last completed turn, so the new chat inherits the parent's history up to the fork point while the parent's own thread and turns stay untouched; the new thread's `forkedFromId` records the lineage. The capability is version-gated on Codex CLI 0.143.0 or newer (the first release with `thread/fork`'s turn-level pinning) — on an older CLI the Fork menu item and the REST route's 422 both show a version-specific reason instead of the generic "isn't available" copy, and the adapter registry now recomputes capabilities after every refresh so the UI never gets stuck on a stale pre-refresh snapshot.
