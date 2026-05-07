# @qlan-ro/mainframe-types

## 0.18.0

### Minor Changes

- [#297](https://github.com/qlan-ro/mainframe/pull/297) [`1bbb392`](https://github.com/qlan-ro/mainframe/commit/1bbb39297eefd6df50929b14631df719c3bcc850) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session row tagging.

  Sessions can now be tagged with user-defined tags via right-click → Tags or by clicking the tag row on hover. The sessions panel header gains a tag filter row with synthetic `has-pr` and `has-worktree` chips alongside user tags; multiple selected chips combine with strict AND. The session row layout moves the worktree pill and PR badge into the title row and replaces the project · branch · time metadata line with a dedicated tag row.
