# @qlan-ro/mainframe-ui

## 2.12.0

### Minor Changes

- [#850](https://github.com/qlan-ro/mainframe/pull/850) [`e35d109`](https://github.com/qlan-ro/mainframe/commit/e35d109ed9b9f46df6e105ca37eb6f5a2b96d859) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The transcript column can now be resized: hover either edge of the conversation and drag. The width is remembered across sessions, and double-clicking an edge returns it to the default 680px. Vertical scrollbars across the app now sit a few pixels in from the edge, so the transcript's no longer touches the session panel's border.

- [#847](https://github.com/qlan-ro/mainframe/pull/847) [`851d617`](https://github.com/qlan-ro/mainframe/commit/851d61787f5fb6915328e8f8a538bf28bc5c953a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan usage moves from the sidebar footer to a capsule beside the traffic lights. It cycles through every Claude and Codex limit every 4 seconds, pins a limit at 75% or more in warning (90% or more in destructive), and opens every limit at once on hover or click.

### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.12.0
