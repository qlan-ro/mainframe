---
"@qlan-ro/mainframe-core": patch
---

Fix a bug where user projects launched from the headless standalone daemon could
resolve `node` to the daemon's own bundled Node instead of the user's real
toolchain. The standalone launcher now preserves the original `PATH` via
`MAINFRAME_ORIG_PATH`, and launch processes use it instead of the daemon's
bundled-Node-prefixed `PATH`.
