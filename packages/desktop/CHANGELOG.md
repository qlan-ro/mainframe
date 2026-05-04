# @qlan-ro/mainframe-desktop

## 0.17.1

### Patch Changes

- [#284](https://github.com/qlan-ro/mainframe/pull/284) [`4269203`](https://github.com/qlan-ro/mainframe/commit/4269203f0b8e674c3539ab6da4b73d431ca26d2d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix TerminalPanel infinite render loop on app startup. The `getTerminals` selector returned a fresh `[]` for any project without a stored entry, causing `useSyncExternalStore` to detect a new snapshot every render and crash the renderer with React error [#185](https://github.com/qlan-ro/mainframe/issues/185) (Maximum update depth exceeded). Returns a stable empty-array reference instead. Also adds the missing `getHomedir` field to the renderer's `MainframeAPI` type so the preload contract typechecks end-to-end.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.1
  - @qlan-ro/mainframe-core@0.17.1
