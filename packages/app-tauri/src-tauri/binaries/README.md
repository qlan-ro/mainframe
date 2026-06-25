# binaries/

Tauri `externalBin` slot for the Node.js sidecar binary.

`tauri.conf.json` declares `"externalBin": ["binaries/node"]`. At `tauri build`
time Tauri appends the current target triple, producing e.g.
`node-aarch64-apple-darwin`. The resulting binary is copied into the app bundle
as a sidecar that `sidecar.rs` invokes to run the daemon.

## Placeholder files

The `node-*` files checked in here are **zero-byte placeholders** so that
`cargo check` succeeds on a clean checkout without requiring the real binaries.
They are NOT executable and must be replaced before `tauri build` will produce
a working bundle.

| File | Platform |
|------|----------|
| `node-aarch64-apple-darwin` | macOS Apple Silicon |
| `node-x86_64-apple-darwin` | macOS Intel |
| `node-x86_64-unknown-linux-gnu` | Linux x86_64 |
| `node-aarch64-unknown-linux-gnu` | Linux ARM64 |
| `node-x86_64-pc-windows-msvc.exe` | Windows x64 |

## Real binaries (CI pipeline — DEFERRED)

The CI packaging pipeline (TODO #1 in
`docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md`) will:

1. Download the official Node.js LTS binary for each target triple from
   `https://nodejs.org/dist/<version>/`.
2. Strip it to just the `node` executable.
3. Rename it to the Tauri convention (`node-<triple>`).
4. Place it here, replacing the placeholder, before running `cargo tauri build`.

The `.gitignore` in this directory uses `!node-<triple>` negations to allow the
placeholders to be force-tracked while still ignoring any real (large) binaries
that a developer might download locally.
