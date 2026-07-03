---
"@qlan-ro/mainframe-ui": patch
---

Directory picker UX pass: the "Add project" picker can now reach folders outside
`~`. The home crumb is an editable path input (type or paste any absolute path
and press Enter to jump there), and a persisted "Recent" section offers one-click
re-pick of recently-chosen project directories. Client-only — the daemon browse
endpoint already accepted arbitrary paths.
