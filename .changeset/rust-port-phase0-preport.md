---
'@qlan-ro/mainframe-core': patch
---

Pre-port hardening for the daemon Rust migration: GitService now runs raw `git` subprocesses with in-repo porcelain parsers (simple-git removed), SQLite schema evolution moved to numbered `PRAGMA user_version` migrations, black-box HTTP oracle tests added for settings/launch/attachments/tags/todos, and the wire contract frozen as generated snapshots under `docs/rust-port/`.
