---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

Offer the older Claude models the CLI's own picker hides. The probed catalog is now merged with a curated list of models the API still serves — Opus 4.8/4.7/4.6/4.5/4.1 and Sonnet 4.6/4.5 — deduped against the probe by id and resolved alias. They appear under an "Older models" label in the composer's provider/model picker, and the static fallback catalog drops every retired id.
