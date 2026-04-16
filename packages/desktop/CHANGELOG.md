# @qlan-ro/mainframe-desktop

## 0.10.2

### Patch Changes

- [#209](https://github.com/qlan-ro/mainframe/pull/209) [`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.

- [#211](https://github.com/qlan-ro/mainframe/pull/211) [`e68cc02`](https://github.com/qlan-ro/mainframe/commit/e68cc0208812a6b308fee2d97d7859a443cdf323) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prevent `TurnFooter` crashes from bringing down the whole chat turn, and log renderer-process crashes so blank-screen bugs leave a trace.
  - `TurnFooter`: local error boundary. `assistant-ui`'s `tapClientLookup` can throw `"Index N out of bounds (length: N)"` during concurrent renders when the external messages array shrinks between a parent capturing its index and a descendant hook reading it. The boundary scopes the failure to the footer and auto-resets on the next render; the rest of the turn keeps rendering.
  - `main`: listen for `render-process-gone` and log `{ reason, exitCode }`. Renderer crashes (OOM, GPU, killed) previously left no trace because React `ErrorBoundary` only catches render errors, not process-level failures.

- Updated dependencies [[`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306)]:
  - @qlan-ro/mainframe-core@0.10.2
  - @qlan-ro/mainframe-types@0.10.2
