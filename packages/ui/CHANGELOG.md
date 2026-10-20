# @qlan-ro/mainframe-ui

## 2.12.1

### Patch Changes

- [#853](https://github.com/qlan-ro/mainframe/pull/853) [`3d14767`](https://github.com/qlan-ro/mainframe/commit/3d14767ea72127e3dee26eb74c0a7d48c4b8ae41) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The desktop UI now builds with the React Compiler, which memoizes components and hooks automatically so fewer of them re-render on each update. Relative times ("5m") in the session list, automation runs, archived sessions, webhook deliveries and GitHub sync now keep counting while the view sits idle.

- [#852](https://github.com/qlan-ro/mainframe/pull/852) [`eb3df82`](https://github.com/qlan-ro/mainframe/commit/eb3df82b5a00efc93a695e0ec39ee366c814124b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The app shell does less work while a chat streams. The title bar, rail, sidebar and dialog hosts no longer re-render on every streamed chunk or background chat update. A chat whose only change is cost or tokens no longer re-renders the session list. In compact mode, a streamed chunk now re-renders only the turn being written instead of every message above it.

- [#859](https://github.com/qlan-ro/mainframe/pull/859) [`38e20a9`](https://github.com/qlan-ro/mainframe/commit/38e20a97b30b1a8bd41b33cfac116695f82d1dcb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The usage capsule fills the title bar over the open sidebar and names each limit in full ("Claude · Weekly Fable") in place of the provider dot and the 5h/wk tag; a name that doesn't fit fades out at its end.

- [#856](https://github.com/qlan-ro/mainframe/pull/856) [`23991c6`](https://github.com/qlan-ro/mainframe/commit/23991c61d32b05a62b9865d8031ef963f545467b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open long chats at the newest messages and load earlier history on demand. Find searches the whole chat, and stepping to an older match loads through to it in one request.

- [#857](https://github.com/qlan-ro/mainframe/pull/857) [`257f7a0`](https://github.com/qlan-ro/mainframe/commit/257f7a01049ba757eb9b040d3df8c987c6719b32) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Virtualize long transcripts with lightweight rows during fast scrolling. Retain reading position, find navigation, selection and expanded tool output, reuse unchanged warm history projections, and keep virtual rows safe during draft replacement.

- Updated dependencies [[`fda17d7`](https://github.com/qlan-ro/mainframe/commit/fda17d782c50fd058e80dab9a5f2f01ac6f8b18c)]:
  - @qlan-ro/mainframe-types@2.12.1
