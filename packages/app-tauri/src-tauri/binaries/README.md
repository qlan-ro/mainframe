# binaries/

Tauri `externalBin` slot for the daemon sidecar binary.

`tauri.conf.json` declares `"externalBin": ["binaries/mainframe-daemon"]`. At
`tauri build` time Tauri appends the current target triple, producing e.g.
`mainframe-daemon-aarch64-apple-darwin`, and copies it next to the app
executable.

- **`mainframe-daemon-<triple>`** — the Rust daemon (`packages/core-rs`).
  `sidecar.rs::find_bundled_rust_daemon` finds it and runs it directly.

## Provisioning

The real per-triple binary is **not committed** — it is large and
platform-specific. `scripts/provision-rust-daemon.mjs` places it here:

- **Default**: `cargo build --release -p mainframe-daemon` in `packages/core-rs`
  for the host triple, then copy the binary here.
- **Cross-target** (`--target=<rust-triple>`): builds with `cargo build --target`
  and reads from `target/<triple>/release/`.
- **`--no-build`**: skip the build and copy an already-built binary.

The Tauri target triple is identical to the Rust target triple, so no mapping is
needed.

## Build pipeline

`tauri build` runs the provisioner automatically via `beforeBuildCommand` (the
`bundle` script = `provision:rust-daemon`). On a per-platform CI matrix each
runner provisions for its own host, so the local defaults are correct there
too. Tauri's own bundler signs the resulting `externalBin` — no separate
codesign pass is needed.

| Triple | Platform |
|--------|----------|
| `mainframe-daemon-aarch64-apple-darwin` | macOS Apple Silicon |
| `mainframe-daemon-x86_64-apple-darwin` | macOS Intel |
| `mainframe-daemon-x86_64-unknown-linux-gnu` | Linux x86_64 |
| `mainframe-daemon-aarch64-unknown-linux-gnu` | Linux ARM64 |
| `mainframe-daemon-x86_64-pc-windows-msvc.exe` | Windows x64 |

`cargo check` does not need this file; `cargo tauri build` does, so provision
first. Only `.gitignore` + this README are tracked.
