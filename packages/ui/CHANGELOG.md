# @qlan-ro/mainframe-ui

## 2.0.0-rc.29

### Patch Changes

- [#660](https://github.com/qlan-ro/mainframe/pull/660) [`4ae8393`](https://github.com/qlan-ro/mainframe/commit/4ae8393e69c93c2f2eabbaf75f7d19531089e0af) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the zero-projects first-run screen never appearing: `reloadProjects` now shares one in-flight request across concurrently-mounted `useProjects()` consumers instead of firing a redundant fetch per mount, and `loading` now reflects only the initial load rather than flipping true on every reload — the latter previously caused an infinite mount/unmount loop between the first-run hero and the welcome screen on a fresh, project-less workspace.

- [#663](https://github.com/qlan-ro/mainframe/pull/663) [`6429c50`](https://github.com/qlan-ro/mainframe/commit/6429c50fe1a04eeaec25386afed93083a6518219) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Centre the macOS traffic lights on the sidebar header row, and move the Update pill to sit beside them. The lights sat 5px below the row's 24px midline in packaged builds: macOS 26 renders the classic button metrics for binaries linked against SDK ≤ 15 (every release build — the CI runner is macos-14), where the cluster centre lands at y + 2, while a locally built dev app links SDK 26 and centres at y − 2. Tuning by eye against a dev window therefore misaligned every release. tauri.conf.json now carries the packaged-correct y (22) and tauri:dev patches it to 26, so both builds centre on the same midline.

- [#661](https://github.com/qlan-ro/mainframe/pull/661) [`d34ba53`](https://github.com/qlan-ro/mainframe/commit/d34ba5327db55bed792a9feb2d117ee8dc98ab53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The macOS traffic lights no longer vanish when the window loses focus in a
  theme that differs from the system appearance. macOS draws the inactive
  buttons for the window's appearance, and with the overlay title bar their
  backdrop is the app content — dark-appearance inactive buttons are white,
  invisible on the light theme. The native window theme now tracks the app
  theme (`setWindowTheme` on the host bridge; System follows the OS).
- Updated dependencies [[`d34ba53`](https://github.com/qlan-ro/mainframe/commit/d34ba5327db55bed792a9feb2d117ee8dc98ab53)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.29
