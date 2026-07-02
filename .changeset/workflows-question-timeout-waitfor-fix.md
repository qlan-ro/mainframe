---
"@qlan-ro/mainframe-core": patch
---

Fix three backend bugs from the workflows-parity review. The `question.timeout`
Zod schema still validated a bare number, so any workflow saved with the editor's
object-form timeout (`{ afterMinutes, onTimeout }`) failed validation — the
schema now matches the DSL type. The question executor now sets
`scratch.waitFor` to a human phrase (the question title) on its waiting
outcome, so the run tree's "blocked on" indicator is actually populated.
The unused `RunTreeNode.sub` field, which no executor ever wrote, is removed.
