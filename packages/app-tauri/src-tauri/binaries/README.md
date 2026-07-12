# binaries/

Tauri `externalBin` slots for the daemon sidecar binaries.

`tauri.conf.json` declares
`"externalBin": ["binaries/node", "binaries/mainframe-daemon"]`. At `tauri build`
time Tauri appends the current target triple, producing e.g.
`node-aarch64-apple-darwin` / `mainframe-daemon-aarch64-apple-darwin`. Each is
copied next to the app executable.

- **`node-<triple>`** — the Node.js runtime. `sidecar.rs::find_bundled_node`
  finds it and runs the legacy Node daemon under it (the DEFAULT). Under the
  `MAINFRAME_DAEMON_IMPL=rust` canary it stays in the bundle to serve the LSP
  servers only.
- **`mainframe-daemon-<triple>`** — the Rust daemon (packages/core-rs).
  `sidecar.rs::find_bundled_rust_daemon` finds it and runs it directly when the
  `rust` canary is set.

See also `../resources/` for the Node daemon bundle itself.

## Provisioning

The real per-triple binaries are **not committed** — they are large and
platform-specific. Two scripts place them here:

### Node (`scripts/provision-node.mjs`)

- **Local** (default): copies the running `node` for this machine's triple.
  It must be the pinned major (Node 24, `.nvmrc`) so its ABI matches the native
  modules `bundle-daemon.mjs` ships. Run via `pnpm --filter …app-tauri provision:node`.
- **CI / cross-target** (`--fetch --version=vX.Y.Z [--triple=…]`): downloads the
  official binary from `https://nodejs.org/dist/<version>/`.

### Rust daemon (`scripts/provision-rust-daemon.mjs`)

- **Default**: `cargo build --release -p mainframe-daemon` in `packages/core-rs`
  for the host triple, then copy the binary here.
- **Cross-target** (`--target=<rust-triple>`): builds with `cargo build --target`
  and reads from `target/<triple>/release/`.
- **`--no-build`**: skip the build and copy an already-built binary.

The Tauri target triple is identical to the Rust target triple, so no mapping is
needed. `cargo build` runs automatically via `bundle` (see below).

## Build pipeline

`tauri build` runs both provisioners automatically via `beforeBuildCommand` (the
`bundle` script = `provision:node` + `provision:rust-daemon` + `bundle:daemon`).
On a per-platform CI matrix each runner provisions for its own host, so the
local defaults are correct there too. `bundle:daemon`'s final codesign pass signs
every Mach-O under `binaries/` — including the Rust daemon.

| Triple | Platform |
|--------|----------|
| `node-aarch64-apple-darwin` / `mainframe-daemon-aarch64-apple-darwin` | macOS Apple Silicon |
| `node-x86_64-apple-darwin` / `mainframe-daemon-x86_64-apple-darwin` | macOS Intel |
| `node-x86_64-unknown-linux-gnu` / `mainframe-daemon-x86_64-unknown-linux-gnu` | Linux x86_64 |
| `node-aarch64-unknown-linux-gnu` / `mainframe-daemon-aarch64-unknown-linux-gnu` | Linux ARM64 |
| `node-x86_64-pc-windows-msvc.exe` / `mainframe-daemon-x86_64-pc-windows-msvc.exe` | Windows x64 |

`cargo check` does not need these files; `cargo tauri build` does, so provision
first. Only `.gitignore` + this README are tracked.
