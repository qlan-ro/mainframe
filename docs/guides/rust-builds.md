# Rust build constraints

Use this reference when changing Cargo configuration, launch/packaging paths, or reclaiming build artifacts.

The daemon (`packages/core-rs`) and Tauri shell (`packages/app-tauri/src-tauri`) are separate Cargo workspaces. Keep them separate: merging would change profile scope and feature unification, including the shell's release LTO and panic settings.

Keep the development debug-information caps in both manifests:

```toml
[profile.dev]
debug = "line-tables-only"

[profile.dev.package."*"]
debug = false
```

Do not set `CARGO_TARGET_DIR`. Daemon discovery and packaging use workspace-local `target/debug` and `target/release` paths, including `packages/core-rs/target`. Supporting a relocated target directory requires updating and validating those consumers first.

For disk cleanup, measure both workspace target directories. `cargo clean --profile dev` in the affected workspace removes development artifacts while retaining release artifacts. Run cleanup only when needed; builds in separate worktrees each create their own artifacts.
