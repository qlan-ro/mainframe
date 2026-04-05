# @qlan-ro/mainframe-types

## 0.8.0

### Minor Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

### Patch Changes

- [#172](https://github.com/qlan-ro/mainframe/pull/172) [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service
