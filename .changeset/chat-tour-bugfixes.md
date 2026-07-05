---
'@qlan-ro/mainframe-ui': patch
---

Fix chat and tour bugs found during e2e verification: the header model chip now falls back to the adapter's default model so it renders before any turn; the `/` and `@` composer triggers no longer insert a doubled trailing space; approving a plan gate keeps its "Executing in…" footer mounted instead of it vanishing the instant the gate is optimistically dropped from the queue; and the first-run tour now skips gracefully past a step whose anchor never mounts (e.g. "Pick your model" on an empty workspace) instead of leaving its spotlight pointing at nothing.
