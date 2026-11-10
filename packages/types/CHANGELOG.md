# @qlan-ro/mainframe-types

## 2.15.0

### Minor Changes

- [#907](https://github.com/qlan-ro/mainframe/pull/907) [`49be5bb`](https://github.com/qlan-ro/mainframe/commit/49be5bb914500206ad90d3cb81caf40ebb0a1e7a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an opt-in setting to compact long idle Claude and Codex chats before the assumed prompt-cache expiry, with a quiet transcript marker.

### Patch Changes

- [#894](https://github.com/qlan-ro/mainframe/pull/894) [`17b6701`](https://github.com/qlan-ro/mainframe/commit/17b6701512fc0de0bb7afd2d7489b540ceab3cc1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Fable 5.1, Sonnet 5.5 and Haiku 5.5 to the Claude fallback catalog so probed aliases receive their 1M context windows.

- [#896](https://github.com/qlan-ro/mainframe/pull/896) [`5ccc00f`](https://github.com/qlan-ro/mainframe/commit/5ccc00fbc49f0fa76f339e8aaa2e5885f3f6d83d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Preserve multi-byte UTF-8 characters split across Claude stdout reads in the live transcript.

- [#903](https://github.com/qlan-ro/mainframe/pull/903) [`3b56cda`](https://github.com/qlan-ro/mainframe/commit/3b56cda55305bc431f970a6d4b753f96b02b64b3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - When Codex loses its connection to OpenAI, the chat now shows "Reconnecting…" instead of looking frozen, and a turn that finally fails gets a clear message with a next step.
