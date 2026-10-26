# @qlan-ro/mainframe-types

## 2.12.5

### Patch Changes

- [#877](https://github.com/qlan-ro/mainframe/pull/877) [`b9f32b3`](https://github.com/qlan-ro/mainframe/commit/b9f32b3581f9e15dd4be8af5e6aca6124b20f4c7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The status line above the composer now says what the turn is doing ("Reading src/app.ts", "Thinking", "Needs your input"). Its timer counts from when the turn really started, so it survives reopening a chat. It stays visible while background tasks run after the turn, showing "N running tasks", which opens the Activity panel.
