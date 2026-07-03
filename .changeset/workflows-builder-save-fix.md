---
"@qlan-ro/mainframe-ui": patch
---

Fix the workflows visual builder so a new workflow can actually be saved. The
serializer no longer emits a top-level `scope:` key (the daemon's schema is
`.strict()` and rejects it), a failed validation request now surfaces an
inline error instead of hanging on "Validating…" forever, and a project-scoped
draft's id now resolves to the active session's project instead of always
writing to the global workflows directory.
