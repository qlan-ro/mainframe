# @qlan-ro/mainframe-desktop

## 0.17.2

### Patch Changes

- [#286](https://github.com/qlan-ro/mainframe/pull/286) [`789e72a`](https://github.com/qlan-ro/mainframe/commit/789e72a0d301ef3b318c334a3e5ccc98134fffc5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): scope terminal tabs per session, preserve output across switches, and stop auto-creating tabs

  Terminal panel now scopes tabs by active chat (session) instead of project — switching chats no longer leaks terminals between sessions. Output is preserved across project/session switches and panel minimize via a module-level xterm cache. The `+` icon now sits next to the tabs (not the far right), the close `×` is always visible, and an empty state prompts users to click `+` to start a session. No terminal is auto-created on mount — users open one explicitly.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.2
  - @qlan-ro/mainframe-core@0.17.2
