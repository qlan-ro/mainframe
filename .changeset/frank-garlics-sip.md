---
---

chore(core-rs): run `cargo fmt` across the Rust port and add a pre-commit `rustfmt` hook so unformatted Rust can't be committed. Unblocks the (non-required) rust-port CI fmt step for all core-rs PRs. Tooling-only — no product code changes.
