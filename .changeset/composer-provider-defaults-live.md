---
"@qlan-ro/mainframe-ui": patch
---

Fix the composer's provider-defaults staleness: the effort/features toolbar read a private once-fetched copy of provider settings, so a default-effort or default-model change made in Settings didn't reflect in the composer until an app reload. `useProviderDefaults` now reads the shared settings store the Settings pane writes optimistically, seeding it with one fetch when nothing has loaded it yet.
