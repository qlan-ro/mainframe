# @qlan-ro/mainframe-core

## 0.6.0

### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer draft preservation, kill launch processes on worktree archive, add copy relative path

- [#142](https://github.com/qlan-ro/mainframe/pull/142) [`511c44d`](https://github.com/qlan-ro/mainframe/commit/511c44d36cce05a9a4a8f40945b5751e7c5716f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: stop button now works when background subagents are running

  Send SIGINT to CLI child process on interrupt to bypass the blocked stdin
  message loop. Also prevent message loss from the interrupt race condition
  by waiting for the process to fully exit before respawning.

- [#149](https://github.com/qlan-ro/mainframe/pull/149) [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: branch manager bugfixes — pull safety, conflict detection, remote checkout, abort reporting, view transitions

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state

- [#144](https://github.com/qlan-ro/mainframe/pull/144) [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add image attachments, filtering, and improve start-session message in todos plugin

- Updated dependencies [[`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87)]:
  - @qlan-ro/mainframe-types@0.6.0
