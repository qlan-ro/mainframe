---
"@qlan-ro/mainframe-core": patch
---

Plugin discovery now honors `MAINFRAME_DATA_DIR` — the daemon scans `<dataDir>/plugins` instead of a hardcoded `~/.mainframe/plugins`, aligning user-plugin loading with the rest of the data-dir convention (the todos builtin already used `<dataDir>/plugins`). No change in the default install, where `<dataDir>` is `~/.mainframe`.
