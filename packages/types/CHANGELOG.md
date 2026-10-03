# @qlan-ro/mainframe-types

## 2.6.0

### Minor Changes

- [#751](https://github.com/qlan-ro/mainframe/pull/751) [`d1b5d72`](https://github.com/qlan-ro/mainframe/commit/d1b5d721f19eab8f0e8356d6b75b749984d672cc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Resuming a chat after a reconnect now recovers changes to messages the client already held — a late turn-duration update, an edited item, or a deletion — instead of only items created after the last one it saw. The client negotiates this with the daemon automatically; older daemons keep working exactly as before.

- [#743](https://github.com/qlan-ro/mainframe/pull/743) [`4be487f`](https://github.com/qlan-ro/mainframe/commit/4be487f95e41ab0d59d9d890461626f2289016b8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add optional daemon-observed start and completion timestamps for individual tool calls, including nested calls. ACP and native chat tool parts preserve those values across reconnects while the session cache is retained. Empty successful results, failures, and observed cancellation close timing without requiring output text.

  Daemon-only timing is lost after cache release, eviction, or restart unless trustworthy timestamps are present in loaded history. Legacy history remains untimed. Codex Bash currently reports tool use at completion, so its observed interval can be near zero and does not measure command execution duration.

### Patch Changes

- [#748](https://github.com/qlan-ro/mainframe/pull/748) [`88d633c`](https://github.com/qlan-ro/mainframe/commit/88d633cbb33e20b8da9a4d84dd8cff8c7b3d79f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix two paragraphs running together with no blank line when a hidden tool call (Claude's TodoWrite, AskUserQuestion, ...) separated them — the hidden call is still never shown, but the text on either side now keeps its paragraph break.

- [#735](https://github.com/qlan-ro/mainframe/pull/735) [`54a31fb`](https://github.com/qlan-ro/mainframe/commit/54a31fbbcdfdf26c78a377f1830affdf6cb416da) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix long chats (over 2000 messages) re-rendering old turns at the bottom of the transcript, showing raw tool-use ids as tool names, and reloading the whole history on every new message. Live replies now animate only the text that is actually streaming, and the final snippet no longer pops in at the end of a turn.

- [#742](https://github.com/qlan-ro/mainframe/pull/742) [`4f82774`](https://github.com/qlan-ro/mainframe/commit/4f82774d99c10f583ba28c44ccf73af116e0ca76) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Preserve Codex command actions and reported execution duration through live messages, restored history, and UI tool metadata.

- [#754](https://github.com/qlan-ro/mainframe/pull/754) [`08590a2`](https://github.com/qlan-ro/mainframe/commit/08590a2fc9125678f34b52a023ab798795c5e01b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep completed answers settled when a new turn starts on daemons that advertise authoritative item streaming. Preserve the running fallback for older daemons.

  Group routine activity in Compact transcripts and fold provider-identified work when an eligible final answer arrives. Keep final text stable, native actions and protected controls available, and expand work on cancellation, failure or invalid metadata. Codex can fold during final-answer streaming; Claude requires confirmed success. History without reliable provider metadata remains visible.
