# @qlan-ro/mainframe-desktop

## 0.15.0

### Minor Changes

- [#249](https://github.com/qlan-ro/mainframe/pull/249) [`4b546c4`](https://github.com/qlan-ro/mainframe/commit/4b546c49de3e6d370f44b8a74eef79619118307c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Chat quote support: highlight any text in the chat thread to surface a floating "Quote" button that prepends `> ` to each line and appends it to the composer. Find-in-path dialog widened to match the command palette width.

- [#253](https://github.com/qlan-ro/mainframe/pull/253) [`d85984e`](https://github.com/qlan-ro/mainframe/commit/d85984e4671e79ad429d1c0ffc21a5ac3a181b9d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show a spinner while messages load on app startup and session switch. The chat panel now displays a centered Loader2 indicator instead of a blank area whenever `getChatMessages` is in flight, and the app-level center panel shows a loading state during the initial data fetch.

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.

- [#250](https://github.com/qlan-ro/mainframe/pull/250) [`de23db7`](https://github.com/qlan-ro/mainframe/commit/de23db741b0168e01fb40bda6f1e1c9fe321cca2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add drag-to-capture region selection in the sandbox preview tab. Users can activate "Region capture" mode (Frame icon in the toolbar), drag a rectangle over the webview, and optionally annotate the capture before adding it to the composer. The annotation appears in the capture preamble when the message is sent.

### Patch Changes

- [#255](https://github.com/qlan-ro/mainframe/pull/255) [`57c867b`](https://github.com/qlan-ro/mainframe/commit/57c867b54ec6a715e60b0ccddf529f4cb8b794dc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pin action button bars in Quick and Full todo dialogs to the bottom so they stay visible while scrolling long forms.

- Updated dependencies [[`cc78f1a`](https://github.com/qlan-ro/mainframe/commit/cc78f1a1159d9c8c3f0fce9d95279c50515be80b), [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163)]:
  - @qlan-ro/mainframe-core@0.15.0
  - @qlan-ro/mainframe-types@0.15.0
