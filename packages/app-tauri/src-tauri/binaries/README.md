# binaries/

Tauri `externalBin` slot for the sidecar binaries.

`tauri.conf.json` declares
`"externalBin": ["binaries/mainframe-daemon", "binaries/mainframe-intelligence"]`.
At `tauri build` time Tauri appends the current target triple, producing e.g.
`mainframe-daemon-aarch64-apple-darwin`, and copies each next to the app
executable.

- **`mainframe-daemon-<triple>`** — the Rust daemon (`packages/core-rs`).
  `sidecar.rs::find_bundled_rust_daemon` finds it and runs it directly.
- **`mainframe-intelligence-<triple>`** — the Apple on-device helper
  (`packages/apple-intelligence`), which generates chat titles through the
  FoundationModels framework. `sidecar.rs::find_bundled_local_intelligence`
  finds it and passes its path to the daemon as
  `MAINFRAME_LOCAL_INTELLIGENCE_BIN`.

## Provisioning

The real per-triple binaries are **not committed** — they are large and
platform-specific. `scripts/provision-rust-daemon.mjs` places the daemon here:

- **Default**: `cargo build --release -p mainframe-daemon` in `packages/core-rs`
  for the host triple, then copy the binary here.
- **Cross-target** (`--target=<rust-triple>`): builds with `cargo build --target`
  and reads from `target/<triple>/release/`.
- **`--no-build`**: skip the build and copy an already-built binary.

The Tauri target triple is identical to the Rust target triple, so no mapping is
needed.

`scripts/provision-apple-intelligence.mjs` places the on-device helper here. It
needs the macOS 26 SDK to compile, which not every build machine has, and an
`externalBin` entry that is missing fails `tauri build` outright — so where
Swift can't build it the script writes a **zero-byte placeholder** instead and
says why. `find_bundled_local_intelligence` rejects anything under 1 KB, so a
placeholder simply leaves the daemon titling chats through the CLI adapters,
which is also what happens on a Mac with Apple Intelligence switched off.

## Build pipeline

`tauri build` runs the provisioners automatically via `beforeBuildCommand` (the
`bundle` script = `provision:rust-daemon` + `provision:apple-intelligence`). On a per-platform CI matrix each
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
