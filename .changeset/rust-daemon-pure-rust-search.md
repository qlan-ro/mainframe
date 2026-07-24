---
---

PR 1 of the Rust-daemon cutover: `mainframe-server`'s content/file-name search now runs in-process on ripgrep's own crates (`ignore` + `grep-searcher` + `grep-regex`, pinned to the versions ripgrep 14.1.1 vendors) instead of shelling out to a resolved `rg` binary — no user-facing package change; ships behind `MAINFRAME_DAEMON_IMPL`. Drops the `@vscode/ripgrep`/`MAINFRAME_RG_PATH` binary-resolution seam and the "ripgrep unavailable" JS-walk fallbacks entirely; search always works now.
