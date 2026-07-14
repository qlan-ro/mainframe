---
'@qlan-ro/mainframe-core': patch
---

Fix `mainframe update` self-update gaps: unrecognized CLI subcommands now print an error instead of silently falling through to booting the daemon (previously crashed with a confusing `EADDRINUSE`), add `mainframe help`/`-h`/`--help`, and `mainframe update` now refuses to install a release that isn't newer than the running version unless `--force` is passed.
