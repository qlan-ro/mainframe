---
---

PR 5 of the Rust-daemon cutover: the standalone distributable is now Node-free. `mainframe-daemon` gained `update`/`pair`/`status` argv subcommands (ported from `packages/core/src/cli`, self-update via the GitHub releases API + semver downgrade guard, pairing QR rendering, and a shared "Cannot reach daemon" connect-failure path), `scripts/build-standalone.sh` now stages the Rust binary plus a thin `mainframe` wrapper (`bin/mainframe` execs `bin/mainframe-daemon` directly — no symlink) instead of bundling Node, and `scripts/install.sh` chmods all three staged binaries. `packages/core/src/cli` stays in-tree as the ported logic's reference/parity oracle; no runtime change there.
