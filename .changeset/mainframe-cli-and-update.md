---
"@qlan-ro/mainframe-core": minor
---

Rename the daemon CLI to `mainframe` and add a `mainframe update` command.

The standalone binary is now `mainframe` (the old `mainframe-daemon` name still
ships as an alias, so existing systemd units keep working). `mainframe update`
upgrades a standalone install in place: it downloads the matching release tarball
for the host platform and unpacks it over `~/.mainframe/bin`. Supports
`--pre` (include pre-releases), `--version <tag>`, and `--dir <path>`; the daemon
keeps serving until you restart it.
