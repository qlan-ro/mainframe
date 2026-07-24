---
---

chore(core-rs): run `cargo fmt` across the Rust port and add a pre-commit `rustfmt` hook so unformatted Rust can't be committed. Also update the one `apply_tool_grouping` characterization test that #507 missed, so it expects the intended empty `task_group` for a childless Task (matching the rest of #507). Turns the (non-required) rust-port CI check green. Test/tooling-only — no product behavior change.
