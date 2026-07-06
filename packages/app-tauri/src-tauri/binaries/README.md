# binaries/

Tauri `externalBin` slot for the Node.js sidecar binary.

`tauri.conf.json` declares `"externalBin": ["binaries/node"]`. At `tauri build`
time Tauri appends the current target triple, producing e.g.
`node-aarch64-apple-darwin`. The resulting binary is copied next to the app
executable; `sidecar.rs::find_bundled_node` finds it there and runs the daemon
under it (see also `../resources/` for the daemon bundle itself).

## Provisioning (`scripts/provision-node.mjs`)

The real `node-<triple>` binaries are **not committed** — they are large and
platform-specific. `scripts/provision-node.mjs` places the right one here:

- **Local** (default): copies the running `node` for this machine's triple.
  It must be the pinned major (Node 24, `.nvmrc`) so its ABI matches the native
  modules `bundle-daemon.mjs` ships. Run via `pnpm --filter …app-tauri provision:node`.
- **CI / cross-target** (`--fetch --version=vX.Y.Z [--triple=…]`): downloads the
  official binary from `https://nodejs.org/dist/<version>/`.

`tauri build` runs this automatically via `beforeBuildCommand` (the `bundle`
script = `provision:node` + `bundle:daemon`). On a per-platform CI matrix each
runner provisions its own Node, so the local-copy default is correct there too.

| Triple | Platform |
|--------|----------|
| `node-aarch64-apple-darwin` | macOS Apple Silicon |
| `node-x86_64-apple-darwin` | macOS Intel |
| `node-x86_64-unknown-linux-gnu` | Linux x86_64 |
| `node-aarch64-unknown-linux-gnu` | Linux ARM64 |
| `node-x86_64-pc-windows-msvc.exe` | Windows x64 |

`cargo check` does not need these files; `cargo tauri build` does, so provision
first. Only `.gitignore` + this README are tracked.
