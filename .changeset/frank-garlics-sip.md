---
---

fix(core-rs): a childless `Task` subagent now renders as its original bare tool_call instead of an empty `task_group`, matching the Node/TS daemon (`groupTaskChildren`). The Rust port had dropped the "no children → bare call" collapse. Also runs `cargo fmt` across the Rust port and adds a pre-commit `rustfmt` hook so unformatted Rust can't be committed — turning the (non-required) rust-port CI check green.
