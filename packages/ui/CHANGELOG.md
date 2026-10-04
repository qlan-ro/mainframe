# @qlan-ro/mainframe-ui

## 2.6.2

### Patch Changes

- [#764](https://github.com/qlan-ro/mainframe/pull/764) [`f50f0d4`](https://github.com/qlan-ro/mainframe/commit/f50f0d40cb8ec3fffffb167468df85744a885c99) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep compact activity visible between tool calls, allow completed work with failed tools to collapse, and show compact nested details.

- [#762](https://github.com/qlan-ro/mainframe/pull/762) [`b9db838`](https://github.com/qlan-ro/mainframe/commit/b9db838926ebc3a2c63382db60cedbedef63f9f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Send chat replays compressed: a client that opts in receives a `session/resume` replay as a few zlib-deflated batches instead of one frame per item, which cuts the bytes on the wire five to ten times for a remote or tunnelled daemon. The desktop client opts in; other clients keep the plain replay.

- [#763](https://github.com/qlan-ro/mainframe/pull/763) [`59df276`](https://github.com/qlan-ro/mainframe/commit/59df27603b5bbdd4c4ead3ca58c78a5ea73c32ff) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open a cold chat without re-parsing its transcript: the daemon now keeps a per-chat snapshot of the parsed history under `<data_dir>/cache/history`, fingerprinted by the transcript files' size and mtime, and serves a cold open from it when the transcript has not changed. A changed transcript, a missing file, or a corrupt snapshot falls back to the normal parse.

- [#762](https://github.com/qlan-ro/mainframe/pull/762) [`b9db838`](https://github.com/qlan-ro/mainframe/commit/b9db838926ebc3a2c63382db60cedbedef63f9f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open long chats with far less data: a full `session/resume` replay now sends tool results older than the newest twenty messages as short previews that expand on demand (the desktop client opts in; other clients keep full results), and the full-result route now reads Codex rollouts too, so expanding a truncated Codex result works.

- [#761](https://github.com/qlan-ro/mainframe/pull/761) [`9932c25`](https://github.com/qlan-ro/mainframe/commit/9932c25e2fad32d128acc64d8179939401e072f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make the chat transcript responsive again: a streamed chunk now re-renders only the message it touched instead of every text part and tool card in the transcript, transcript-only updates no longer re-render the composer, gates and session panel, and a long chat mounts its newest messages first and reveals the rest in deferred batches instead of blocking until the whole history has rendered.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.6.2
