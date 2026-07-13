# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.8

### Minor Changes

- [#458](https://github.com/qlan-ro/mainframe/pull/458) [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.

### Patch Changes

- Updated dependencies [[`a679cb9`](https://github.com/qlan-ro/mainframe/commit/a679cb95b850796dec3498b5996a896ac5f73c39), [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.8

## 2.0.0-rc.7

### Patch Changes

- [#450](https://github.com/qlan-ro/mainframe/pull/450) [`acf8aa1`](https://github.com/qlan-ro/mainframe/commit/acf8aa1b2fb43467286c56395a921c7513402db7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Automations panel popovers (add trigger, add step, token picker) rendering invisibly behind the panel's own backdrop. `AutomationsHost`'s overlay used `z-[4600]`, well above the `z-50` tier every Radix popover/dropdown in the app defaults to — so clicking "+ Add a trigger" or "+ Add step" opened the menu, just painted underneath the modal. Overlay now uses `z-50`, matching every other full-screen dialog in the app.

- [#453](https://github.com/qlan-ro/mainframe/pull/453) [`cbb7673`](https://github.com/qlan-ro/mainframe/commit/cbb76730cadc6b1437e556e9698f5382fe9fa415) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix stale frontend assets surviving app updates (root cause behind the "still broken" scrollbar reports on [#438](https://github.com/qlan-ro/mainframe/issues/438)/[#443](https://github.com/qlan-ro/mainframe/issues/443)/[#446](https://github.com/qlan-ro/mainframe/issues/446)).

  Tauri's asset protocol sends no `Cache-Control`/`ETag`/`Last-Modified` headers, and since the `tauri://` origin never changes between app versions, WKWebView's disk cache could keep serving `index.html` and its referenced JS/CSS from a pre-update session after an in-place update — with no way to tell it was stale. Three separate scrollbar-CSS fixes shipped correctly but kept getting masked by this. The main window is now built manually (`"create": false` in config) with `on_web_resource_request` attaching `Cache-Control: no-store` to every asset response, so each request always hits the current bundle.

- Updated dependencies [[`f4c77d4`](https://github.com/qlan-ro/mainframe/commit/f4c77d47241645b41c70c32dcb0f1b9b0727d886)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.7
