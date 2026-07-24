---
---

PR 2 of the Rust-daemon cutover: `mainframe-lsp`'s registry now resolves every language server (including the formerly "bundled" `typescript-language-server` and `pyright-langserver`) bring-your-own — a project-local `node_modules/.bin`, then a Python venv, then a `command -v` probe on the resolved login-shell `PATH` — the way `jdtls` always did. No user-facing package change; ships behind `MAINFRAME_DAEMON_IMPL`. Drops the bundled-Node resolution path and the `MAINFRAME_BUNDLED_NODE`/`MAINFRAME_BUNDLED_LSP_ROOT` env wiring from `core-rs`; unresolved servers keep failing soft.
