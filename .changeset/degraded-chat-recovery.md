---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-ui': minor
---

Detect deleted CLI transcripts and unify degraded-chat recovery: a persisted `transcriptMissing` flag (new `transcript_missing` column) reconciled on history load and on the periodic scan, a typed `{ messages, transcriptMissing }` history payload, recovery routes (recreate-worktree, continue-here, continue-in-project-root), and one degraded-chat card in the thread replacing the composer worktree banner, with a unified sidebar marker.
