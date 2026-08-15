# @qlan-ro/mainframe-types

## 2.0.0-rc.29

### Patch Changes

- [#661](https://github.com/qlan-ro/mainframe/pull/661) [`d34ba53`](https://github.com/qlan-ro/mainframe/commit/d34ba5327db55bed792a9feb2d117ee8dc98ab53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The macOS traffic lights no longer vanish when the window loses focus in a
  theme that differs from the system appearance. macOS draws the inactive
  buttons for the window's appearance, and with the overlay title bar their
  backdrop is the app content — dark-appearance inactive buttons are white,
  invisible on the light theme. The native window theme now tracks the app
  theme (`setWindowTheme` on the host bridge; System follows the OS).
