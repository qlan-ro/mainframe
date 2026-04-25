# @qlan-ro/mainframe-core

## 0.15.0

### Minor Changes

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.

### Patch Changes

- [#254](https://github.com/qlan-ro/mainframe/pull/254) [`cc78f1a`](https://github.com/qlan-ro/mainframe/commit/cc78f1a1159d9c8c3f0fce9d95279c50515be80b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix spurious empty user bubble in Explore agent / Task tool subagent threads.

  Bare `<command-name>` CLI echoes (no accompanying `<command-message>` tag) are
  now suppressed in `convertUserContent` instead of being synthesized into a
  `/commandName` bubble. An additional guard in `convertGroupedToDisplay` drops
  user messages whose display content and metadata are both empty, preventing any
  residual empty bubble from reaching the client.

  User-typed `/skill-name` invocations are unaffected — they always carry a
  `<command-message>` tag alongside `<command-name>` and continue to render
  correctly.

- Updated dependencies [[`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163)]:
  - @qlan-ro/mainframe-types@0.15.0
