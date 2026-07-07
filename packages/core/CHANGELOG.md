# @qlan-ro/mainframe-core

## 2.0.0-rc.2

### Minor Changes

- [#408](https://github.com/qlan-ro/mainframe/pull/408) [`f3e63b6`](https://github.com/qlan-ro/mainframe/commit/f3e63b6e3151b2dcd76b0ed737a1e3734677369f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface the daemon version. `mainframe --version` (also `-v` / `version`) prints
  the installed binary's version, `mainframe status` shows the **running** daemon's
  version, and `GET /health` now returns a `version` field. The version is inlined
  into the bundle at build time (esbuild `define`), with a `package.json` fallback
  for dev and unbundled runs.

### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.2
