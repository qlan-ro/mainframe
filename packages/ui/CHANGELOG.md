# @qlan-ro/mainframe-ui

## 2.15.0

### Minor Changes

- [#907](https://github.com/qlan-ro/mainframe/pull/907) [`49be5bb`](https://github.com/qlan-ro/mainframe/commit/49be5bb914500206ad90d3cb81caf40ebb0a1e7a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an opt-in setting to compact long idle Claude and Codex chats before the assumed prompt-cache expiry, with a quiet transcript marker.

### Patch Changes

- [#894](https://github.com/qlan-ro/mainframe/pull/894) [`17b6701`](https://github.com/qlan-ro/mainframe/commit/17b6701512fc0de0bb7afd2d7489b540ceab3cc1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Fable 5.1, Sonnet 5.5 and Haiku 5.5 to the Claude fallback catalog so probed aliases receive their 1M context windows.

- [#896](https://github.com/qlan-ro/mainframe/pull/896) [`5ccc00f`](https://github.com/qlan-ro/mainframe/commit/5ccc00fbc49f0fa76f339e8aaa2e5885f3f6d83d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Preserve multi-byte UTF-8 characters split across Claude stdout reads in the live transcript.

- [#903](https://github.com/qlan-ro/mainframe/pull/903) [`3b56cda`](https://github.com/qlan-ro/mainframe/commit/3b56cda55305bc431f970a6d4b753f96b02b64b3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - When Codex loses its connection to OpenAI, the chat now shows "Reconnecting…" instead of looking frozen, and a turn that finally fails gets a clear message with a next step.

- [#892](https://github.com/qlan-ro/mainframe/pull/892) [`9df004a`](https://github.com/qlan-ro/mainframe/commit/9df004adb8c3eda727f6b60f764be905da3f764e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Correct GPT-6.1 Terra catalog and fallback context windows to 500K.

- [#906](https://github.com/qlan-ro/mainframe/pull/906) [`3cbdb43`](https://github.com/qlan-ro/mainframe/commit/3cbdb4340d14160e26fe962b7268fbf813439722) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render Markdown images that point at a local file path or file:// URL inline, instead of a broken image.

- [#899](https://github.com/qlan-ro/mainframe/pull/899) [`b20f932`](https://github.com/qlan-ro/mainframe/commit/b20f932f77dab33b74637c0e01a19c8640475baa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Choosing Rename on a session now focuses the rename input with the title selected.

- [#900](https://github.com/qlan-ro/mainframe/pull/900) [`b9b257c`](https://github.com/qlan-ro/mainframe/commit/b9b257cf3dd2db3e454050e88e8bb9a9838f285d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Send file review comments from a draft session by creating the chat first; keep comments and show a toast when the send fails or no session is open.

- [#901](https://github.com/qlan-ro/mainframe/pull/901) [`57dd00a`](https://github.com/qlan-ro/mainframe/commit/57dd00a8f81f991acf562e41e0e437cf316f940d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show the command text, or "Running command", instead of the bare word "command" while an unparseable shell command runs in the compact transcript.

- [#904](https://github.com/qlan-ro/mainframe/pull/904) [`3921ca1`](https://github.com/qlan-ro/mainframe/commit/3921ca159f1392a5a0070e3be23e81878490c8a5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Toasts follow the resolved app theme, keep the close button inside the card, clamp long descriptions to three lines and offer a Details button for the full text.

- [#905](https://github.com/qlan-ro/mainframe/pull/905) [`fdac402`](https://github.com/qlan-ro/mainframe/commit/fdac402ee425172f8b074af9c35948972ee72acb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The chat transcript now fades at its top edge and just above the composer, and the left session sidebar labels fade out when they overflow instead of ending in an ellipsis.

- Updated dependencies [[`17b6701`](https://github.com/qlan-ro/mainframe/commit/17b6701512fc0de0bb7afd2d7489b540ceab3cc1), [`5ccc00f`](https://github.com/qlan-ro/mainframe/commit/5ccc00fbc49f0fa76f339e8aaa2e5885f3f6d83d), [`3b56cda`](https://github.com/qlan-ro/mainframe/commit/3b56cda55305bc431f970a6d4b753f96b02b64b3), [`49be5bb`](https://github.com/qlan-ro/mainframe/commit/49be5bb914500206ad90d3cb81caf40ebb0a1e7a)]:
  - @qlan-ro/mainframe-types@2.15.0
