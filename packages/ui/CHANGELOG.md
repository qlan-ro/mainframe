# @qlan-ro/mainframe-ui

## 2.0.0-rc.13

### Patch Changes

- [#492](https://github.com/qlan-ro/mainframe/pull/492) [`f2b0314`](https://github.com/qlan-ro/mainframe/commit/f2b0314f0586174d098b058c242be60a1e19f61b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Capture full diagnostics when a render error is caught. The error boundary now
  logs the error stack and React component stack durably through the host (so
  packaged builds record crashes without devtools), and "Copy details" copies the
  full stack bundle instead of just the one-line message.
