# @qlan-ro/mainframe-ui

## 2.12.5

### Patch Changes

- [#875](https://github.com/qlan-ro/mainframe/pull/875) [`208ca81`](https://github.com/qlan-ro/mainframe/commit/208ca81bf1a0f3d0955d3e27f34aa524ba2836d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Compact mode's activity groups now read like a status line. Live work shimmers, settled groups give counts and failures ("Read 3 files, ran 2 commands (1 failed)"), a lone finished call shows as its own row, and unfamiliar tools join the group instead of splitting it.

- [#877](https://github.com/qlan-ro/mainframe/pull/877) [`b9f32b3`](https://github.com/qlan-ro/mainframe/commit/b9f32b3581f9e15dd4be8af5e6aca6124b20f4c7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The status line above the composer now says what the turn is doing ("Reading src/app.ts", "Thinking", "Needs your input"). Its timer counts from when the turn really started, so it survives reopening a chat. It stays visible while background tasks run after the turn, showing "N running tasks", which opens the Activity panel.

- [#878](https://github.com/qlan-ro/mainframe/pull/878) [`6ea55df`](https://github.com/qlan-ro/mainframe/commit/6ea55dfeb584a181fc7ac0dd5970e7f14fae9e6d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The turn's live status moved from above the composer into the transcript, as in the Claude and Codex desktop apps. A status row at the end of the turn shows the phase (Thinking, Writing, Working, Needs your input, Stopping, Compacting), the elapsed time and running background tasks. When an activity group or a running tool ends the transcript, its header shows the time and tasks instead, so each turn has a single live indicator. The separate "Compacting…" pill is gone.

- Updated dependencies [[`b9f32b3`](https://github.com/qlan-ro/mainframe/commit/b9f32b3581f9e15dd4be8af5e6aca6124b20f4c7)]:
  - @qlan-ro/mainframe-types@2.12.5
