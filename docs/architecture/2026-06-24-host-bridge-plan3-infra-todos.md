# Plan 3 Infrastructure TODOs: Daemon Bundling Pipeline

**Status:** ✅ **DONE (2026-06-25)** — local pipeline implemented + verified end-to-end.
Only the per-platform CI matrix (TODO 6) + updater signing/release (TODOs 7–9) remain.
**Related:** `2026-06-24-host-bridge-tauri-parity-plan.md`, Task 6

---

## ✅ Implemented (2026-06-25)

- **`packages/app-tauri/scripts/bundle-daemon.mjs`** — builds core, esbuilds
  `resources/daemon/daemon.cjs` (externals = native + LSP + ripgrep), then a
  **dependency collector** walks each external's `package.json` deps and
  deref-copies the real (pnpm-symlinked) packages into a flat
  `resources/daemon/node_modules` SIBLING of `daemon.cjs`. Node's standard
  resolution finds them — no NODE_PATH/cwd. Pulls `better-sqlite3` (+`bindings`,
  `file-uri-to-path`, the `.node`), `node-pty`, both LSP servers, and
  `@vscode/ripgrep` **plus its platform sub-package** (`@vscode/ripgrep-darwin-arm64/bin/rg`).
- **`packages/app-tauri/scripts/provision-node.mjs`** — places the Node 24 sidecar
  at `binaries/node-<triple>`. Local = copy the running node (ABI-matched); CI =
  `--fetch --version=`. Pinned to `.nvmrc` (Node 24, ABI 137) so native modules
  match with **no rebuild step** on a host whose node is 24.
- **`sidecar.rs::find_bundled_node`** — packaged builds run under the bundled
  sidecar next to the exe (size-guarded against the zero-byte dev placeholders);
  dev falls back to system node. Wired into `lib.rs::boot_daemon`; unit-tested.
- **`tauri.conf.json`** — `resources` ships the whole `resources/daemon` dir;
  `beforeBuildCommand` runs the ui build + `app-tauri bundle` (provision + daemon).
- **`packages/core/tsconfig.build.json`** — exclude widened to `src/**/__tests__/**`
  (was `src/__tests__/**`, which missed nested test dirs and broke the build).
- **gitignore** — real binaries + bundle output are ignored (the old force-track
  placeholder negations were a footgun: they'd commit a 119MB node binary).

**Verified locally (macOS arm64):** `bundle:daemon` produces the bundle in ~26s
(no network); the daemon **boots under the bundled Node 24 sidecar** and answers
`/health` 200 (proves `better-sqlite3` ABI match + sibling-`node_modules`
resolution); the bundled `rg` runs (ripgrep 15.0.0); `cargo test sidecar` green.

**Remaining:** the per-platform CI matrix (TODO 6 below) that provisions + bundles
+ `cargo tauri build` on each runner, and the updater signing/release (TODOs 7–9,
needs the user's signing key). A full signed `tauri build` is gated on those.

---

## Original scaffold notes (historical)

## What is scaffolded (Task 6)

- `tauri.conf.json` `bundle.externalBin` declares `binaries/node` (Tauri will suffix the
  target triple at `tauri build` time, producing e.g. `node-aarch64-apple-darwin`).
- `tauri.conf.json` `bundle.resources` maps four source paths → in-bundle destination paths:
  `daemon/daemon.cjs`, `ripgrep/rg`, `lsp/typescript-language-server`, `lsp/pyright`.
- `resolve_daemon_entry(app)` consults `app.path().resource_dir()/daemon/daemon.cjs` first
  (packaged build), then `MAINFRAME_DAEMON_PATH` (CI/test override), then the monorepo-root
  walk (dev mode). The pure `pick_daemon_entry` helper is unit-tested.

The source files referenced by `bundle.resources` and `bundle.externalBin` do **not exist
yet** — `cargo tauri build` will fail until the pipeline below is completed.

---

## Daemon bundling pipeline (DEFERRED)

### TODO(plan3-infra): 1 — Per-platform Node sidecar

Tauri's `externalBin` requires a pre-built binary at
`src-tauri/binaries/node-<target-triple>` (e.g. `node-aarch64-apple-darwin`,
`node-x86_64-apple-darwin`, `node-x86_64-pc-windows-msvc`).

**SCAFFOLDED (2026-06-25):** Zero-byte placeholder files are now committed for
all common target triples so `cargo check` passes on any dev/CI platform without
requiring the real binaries:
- `node-aarch64-apple-darwin` (macOS Apple Silicon)
- `node-x86_64-apple-darwin` (macOS Intel)
- `node-x86_64-unknown-linux-gnu` (Linux x86_64)
- `node-aarch64-unknown-linux-gnu` (Linux ARM64)
- `node-x86_64-pc-windows-msvc.exe` (Windows x64 — `.exe` suffix required)

`binaries/.gitignore` uses `!node-<triple>` negations to allow these placeholders
to be force-tracked while still ignoring any real (large) binaries downloaded locally.
See `src-tauri/binaries/README.md` for details.

The CI packaging pipeline **replaces** these zero-byte placeholders with the real
binaries before running `cargo tauri build`. Steps:
1. Fetch the official Node.js binary for each target from `https://nodejs.org/dist/`.
   Pin to a specific LTS version (e.g. Node 20 LTS). Use the same major version the
   monorepo's `.nvmrc` / `package.json engines` field pins.
2. Strip the download to just the `node` binary (not the full tarball).
3. Rename to the Tauri triple convention: `node-aarch64-apple-darwin`, etc.
4. Place under `packages/app-tauri/src-tauri/binaries/` (replacing the placeholder).
5. In `sidecar.rs` `find_node`, add a packaged-build branch: when
   `app.path().resource_dir()` resolves, prefer the sidecar binary that Tauri
   copies to `<Contents/MacOS/node-*>` (use `std::env::current_exe().parent()`).
   `find_node` currently takes only a PATH string — it needs an `Option<&Path>`
   bundled-node override, analogous to how `resolve_daemon_entry` gained the
   `bundled` parameter. Mirror the same `pick_*` pattern.

### TODO(plan3-infra): 2 — daemon.cjs build

Electron ships `resources/daemon.cjs` built by
`packages/desktop/scripts/bundle-daemon.mjs` (esbuild CJS bundle of
`packages/core/src/index.ts`). The Tauri equivalent must:
1. Run the same esbuild bundle step (or a new `packages/core/scripts/bundle-tauri.mjs`)
   producing a single-file `daemon.cjs` with `platform:'node'`, `bundle:true`,
   `format:'cjs'`, `external:['better-sqlite3','node-pty','@vscode/ripgrep',...]`.
2. Output to `packages/app-tauri/src-tauri/resources/daemon/daemon.cjs`.
3. Wire as a `beforeBuildCommand` or a standalone `tauri:bundle` lifecycle script.

### TODO(plan3-infra): 3 — @vscode/ripgrep

Copy the platform-appropriate `rg` binary from
`node_modules/@vscode/ripgrep/bin/rg` to
`packages/app-tauri/src-tauri/resources/ripgrep/rg` as part of the bundle script.
The binary is already downloaded by the `@vscode/ripgrep` postinstall; no separate
fetch needed — just copy + `chmod +x`.

### TODO(plan3-infra): 4 — LSP servers

`typescript-language-server` and `pyright` are Node scripts (not standalone
binaries). Options:
- **Option A (preferred):** Bundle them as JS entry points under
  `resources/lsp/` and invoke them via the bundled Node sidecar (same binary as
  the daemon). Update the daemon's LSP launcher to resolve the bundled path via
  `MAINFRAME_RESOURCE_DIR` env var (injected by the Tauri shell before spawning
  the daemon sidecar).
- **Option B:** Ship them as SEA (Node Single Executable Applications) — more
  self-contained but larger bundles and more complex build step.

### TODO(plan3-infra): 5 — Native module ABI rebuild

`better-sqlite3` and `node-pty` are native addons compiled against a specific
Node ABI. The bundled Node binary's ABI **must match** what the addons were built
against.

Steps:
1. Identify the ABI version of the pinned Node binary (`node -p process.versions.modules`).
2. Rebuild both addons against that ABI:
   ```bash
   cd packages/core
   npm rebuild better-sqlite3 --runtime=node --target=<NODE_VERSION> --dist-url=https://nodejs.org/dist
   npm rebuild node-pty    --runtime=node --target=<NODE_VERSION> --dist-url=https://nodejs.org/dist
   ```
3. Copy the resulting `.node` files into the daemon resource bundle (adjacent to
   `daemon.cjs`) so the daemon's `require('better-sqlite3')` resolves them.
4. This step is **per-platform** and must run on each CI runner (macOS arm64,
   macOS x86_64, Windows x64) — cross-compiled `.node` files are not valid.

### TODO(plan3-infra): 6 — CI matrix

Add a GitHub Actions matrix job:
```yaml
strategy:
  matrix:
    os: [macos-14, macos-13, windows-latest]
```
Each job must:
- Download the correct Node binary for its triple.
- Run the daemon esbuild bundle.
- Copy ripgrep + LSP assets.
- Rebuild native addons.
- Run `cargo tauri build`.
- Upload the resulting `.app`/`.dmg`/`.exe`/`.msi` as artifacts.

---

## Verification gate (NOT yet passable)

```bash
# This WILL fail until the pipeline is complete — expected.
cd packages/app-tauri/src-tauri && cargo tauri build
```

The scaffold is verified only by `cargo check` (resolver compiles) and
`node -e "JSON.parse(...)"` (tauri.conf.json is valid JSON).

---

## Updater signing + CI

**Status:** ✅ **DONE (2026-06-25)** — signing keypair generated (by the maintainer; private
key stored as the `qlan-ro/mainframe` Actions secret `TAURI_SIGNING_PRIVATE_KEY`), the real
public key is in `tauri.conf.json` `plugins.updater.pubkey`, `bundle.createUpdaterArtifacts`
is enabled, and the `build-app-tauri` `tauri-action` job is wired into `.github/workflows/release.yml`
(per-platform matrix: macOS arm64 + Intel, Linux x64 + arm64, Windows; runs the app-tauri
`beforeBuildCommand` = ui build + provision-node + bundle-daemon, then `cargo tauri build`,
signs, and uploads installers + a merged `latest.json` to the tag's draft release, coexisting
with the existing Electron/daemon `release` job). Owner/repo confirmed = `qlan-ro/mainframe`
(the `archive`/doruchiulan remote was removed).

**Remaining (maintainer action, not code):** push a `v*` tag to trigger the first release and
confirm the draft contains the signed Tauri installers + `latest.json`. The workflow is
validated structurally (parses, jobs/needs/matrix correct) but only runs live on a tag.

The three custom commands (`updater_check`, `updater_download`, `updater_install`) and the
10s-then-4h background scheduler compile and the error classifier passes 5 unit tests.

<details><summary>Original deferred steps (now done — historical)</summary>

### TODO(plan3-infra): 7 — Generate and store the signing keypair

```bash
# Run locally; the private key MUST NOT be committed.
cargo tauri signer generate -w ~/.tauri/mainframe.key
```

- The **private key** (`~/.tauri/mainframe.key`) goes into GitHub Actions as the CI secret
  `TAURI_SIGNING_PRIVATE_KEY` (+ optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
- The **public key** (printed by the command) replaces the placeholder in
  `packages/app-tauri/src-tauri/tauri.conf.json`:
  ```json
  "plugins": {
    "updater": {
      "pubkey": "<PASTE_REAL_PUBLIC_KEY_HERE>"
    }
  }
  ```

### TODO(plan3-infra): 8 — Add the tauri-action release workflow

Add `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    strategy:
      matrix:
        os: [macos-14, macos-13, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: tauri-apps/tauri-action@v0
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: packages/app-tauri
          tagName: v__VERSION__
          releaseName: Mainframe v__VERSION__
          releaseBody: See the changelog.
          releaseDraft: true
          prerelease: false
```

This publishes `latest.json` + signed update artifacts to GitHub Releases, which the
updater endpoint resolves at runtime.

### TODO(plan3-infra): 9 — Confirm owner/repo and cut the first signed release

- Confirm `qlan-ro/mainframe` is the correct GitHub owner/repo for releases.
- Ensure the release tag matches `v<semver>` so `latest.json` is generated correctly.
- The first `cargo tauri build` with the real pubkey in place will also require completing
  the daemon bundling pipeline (TODOs 1–6 above).

</details>

---

## Webview permission policy: deny camera/mic, allow clipboard/notify

**Status:** DONE (Task 12, 2026-06-25)

Tauri's capabilities model grants an explicit allowlist — anything not listed is denied. The
`capabilities/main.json` grants only:

- `core:default` — standard window/FS/etc primitives (no media device access)
- `core:window:allow-start-dragging` — window drag handle
- `opener:default` — shell open for external URLs
- `notification:default` + `notification:allow-notify` — OS notifications (parity: allowed)
- `mcp-bridge:default` — internal MCP bridge
- `updater:default` — auto-update checks

There is **no** `camera`, `microphone`, `geolocation`, or any other media permission in this
list. Camera and microphone are denied by the capability allowlist (deny-by-default posture),
matching Electron's `setPermissionRequestHandler` allowlist of clipboard + notifications only.

On macOS, WKWebView media access is additionally gated by the app bundle's
`NSCameraUsageDescription` / `NSMicrophoneUsageDescription` Info.plist keys. If those keys
are **absent**, the OS denies access without prompting — the desired UX. The `bundle.macOS`
block in `tauri.conf.json` intentionally omits these keys (no `customProtocol` or Info.plist
additions); `entitlements: null` means no entitlements file is injected that could add them.
This mirrors Electron's `denyUnneededPermissions` approach (nulling those mac.extendInfo keys).

---

## WKWebView crash signal (DEFERRED / best-effort)

// TODO(plan3-infra): WKWebView crash signal

Electron's `render-process-gone` event surfaces webview process termination (OOM kill,
renderer crash, GPU process crash) as a structured event with `reason` and `exitCode`.
Tauri 2 has no equivalent event on the public API surface.

The closest WKWebView hook is `WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:)`,
which fires when the WebContent process is killed by the OS (typically memory pressure). To
wire this into Tauri would require:

1. A custom `objc2` (or `objc` crate) hook that installs a `WKNavigationDelegate` on the
   underlying `WKWebView` instance obtained via the Tauri `WebviewWindow` handle.
2. Emitting a Tauri event (e.g. `webview://crash`) to the frontend when the delegate fires.
3. The frontend `HostBridgeTauri` listening for the event and calling any registered
   `onCrash` handler in the `HostBridge` contract.

This is lower fidelity than Electron's version (no structured `reason`/`exitCode`) and
requires unsafe Objective-C interop. The RSS sampler (Task 10) covers memory diagnostics
without this hook. Deferred to post-V1.

