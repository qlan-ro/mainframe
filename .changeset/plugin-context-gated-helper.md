---
'@qlan-ro/mainframe-core': patch
---

Collapse the four copy-pasted capability-guard Proxy blocks in `buildPluginContext` (db, attachments, events, ui) into a single `gated(enabled, capLabel, build)` helper. Same gating behavior — the real subsystem when its capability is declared, otherwise a Proxy whose methods throw the capability error.
