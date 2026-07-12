# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.6

### Patch Changes

- [#445](https://github.com/qlan-ro/mainframe/pull/445) [`d83749e`](https://github.com/qlan-ro/mainframe/commit/d83749e76ac48d5e87fbe1eaf539dea2908b084d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tauri shell gains the `MAINFRAME_DAEMON_IMPL` canary flag: `rust` spawns the ported Rust daemon as an externalBin sidecar (with login-shell PATH, bundled-LSP env, identical supervision); `node` (default) keeps the existing Node sidecar untouched. The Rust binary is opt-in at build time — default `bundle`/`tauri:build` stays Node-only, and `bundle:canary`/`tauri:build:canary` (via the `tauri.rust-canary.conf.json` overlay) produces the dual-daemon build. See `docs/rust-port/CUTOVER.md` for the signing/notarization gate before shipping the canary publicly.

- Updated dependencies [[`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911), [`aa2dce6`](https://github.com/qlan-ro/mainframe/commit/aa2dce69b38621395466777eabb5e9d0088fd17a)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.6
