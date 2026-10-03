# @qlan-ro/mainframe-ui

## 2.6.0

### Minor Changes

- [#746](https://github.com/qlan-ro/mainframe/pull/746) [`e6af2bf`](https://github.com/qlan-ro/mainframe/commit/e6af2bfa381750702f750605c95f3d4dbbbb44eb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a Compact transcript option in Appearance settings, with grouped tool summaries and expandable details. Verbose remains the default.

- [#732](https://github.com/qlan-ro/mainframe/pull/732) [`f60b797`](https://github.com/qlan-ro/mainframe/commit/f60b797c0130dde91c15b673089e219120c137c3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Forking a chat now opens the fork in a split and focuses it, the same pair ⌘-click opens: beside its parent when the parent is on screen, otherwise beside the chat you're looking at. In a window too narrow for a split, the fork opens on its own until the window widens.

- [#751](https://github.com/qlan-ro/mainframe/pull/751) [`d1b5d72`](https://github.com/qlan-ro/mainframe/commit/d1b5d721f19eab8f0e8356d6b75b749984d672cc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Resuming a chat after a reconnect now recovers changes to messages the client already held — a late turn-duration update, an edited item, or a deletion — instead of only items created after the last one it saw. The client negotiates this with the daemon automatically; older daemons keep working exactly as before.

- [#754](https://github.com/qlan-ro/mainframe/pull/754) [`08590a2`](https://github.com/qlan-ro/mainframe/commit/08590a2fc9125678f34b52a023ab798795c5e01b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep completed answers settled when a new turn starts on daemons that advertise authoritative item streaming. Preserve the running fallback for older daemons.

  Group routine activity in Compact transcripts and fold provider-identified work when an eligible final answer arrives. Keep final text stable, native actions and protected controls available, and expand work on cancellation, failure or invalid metadata. Codex can fold during final-answer streaming; Claude requires confirmed success. History without reliable provider metadata remains visible.

- [#731](https://github.com/qlan-ro/mainframe/pull/731) [`0ea3eb8`](https://github.com/qlan-ro/mainframe/commit/0ea3eb85d956abb2e126561970ee54337a8f918e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Side chats now open beside their parent chat, with a draggable divider to resize them, and each chat keeps its own session rail, as in split view. In a narrow window or a split view the side chat still docks below its parent.

- [#743](https://github.com/qlan-ro/mainframe/pull/743) [`4be487f`](https://github.com/qlan-ro/mainframe/commit/4be487f95e41ab0d59d9d890461626f2289016b8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add optional daemon-observed start and completion timestamps for individual tool calls, including nested calls. ACP and native chat tool parts preserve those values across reconnects while the session cache is retained. Empty successful results, failures, and observed cancellation close timing without requiring output text.

  Daemon-only timing is lost after cache release, eviction, or restart unless trustworthy timestamps are present in loaded history. Legacy history remains untimed. Codex Bash currently reports tool use at completion, so its observed interval can be near zero and does not measure command execution duration.

### Patch Changes

- [#740](https://github.com/qlan-ro/mainframe/pull/740) [`e128085`](https://github.com/qlan-ro/mainframe/commit/e12808556ac959912fa162bf0382a1be3db49947) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make task editors and Quick Task resizable, and cap long descriptions with internal scrolling.

- [#754](https://github.com/qlan-ro/mainframe/pull/754) [`08590a2`](https://github.com/qlan-ro/mainframe/commit/08590a2fc9125678f34b52a023ab798795c5e01b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex replies now stream into the transcript as the agent writes them, instead of appearing all at once when the reply finishes. The final text still lands once, under the same message, with no duplication.

- [#741](https://github.com/qlan-ro/mainframe/pull/741) [`3aef705`](https://github.com/qlan-ro/mainframe/commit/3aef70599f909b529eae5394287e4dda1a047fef) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Delay file explorer path hints by 500ms and keep them from intercepting clicks on nearby rows.

- [#737](https://github.com/qlan-ro/mainframe/pull/737) [`f6cf803`](https://github.com/qlan-ro/mainframe/commit/f6cf803d2aa8e5213042af7d4352e4c0168c0113) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prevent first-send session creation from being mistaken for draft abandonment when thread identity changes before draft configuration clears.

- [#748](https://github.com/qlan-ro/mainframe/pull/748) [`88d633c`](https://github.com/qlan-ro/mainframe/commit/88d633cbb33e20b8da9a4d84dd8cff8c7b3d79f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix two paragraphs running together with no blank line when a hidden tool call (Claude's TodoWrite, AskUserQuestion, ...) separated them — the hidden call is still never shown, but the text on either side now keeps its paragraph break.

- [#735](https://github.com/qlan-ro/mainframe/pull/735) [`54a31fb`](https://github.com/qlan-ro/mainframe/commit/54a31fbbcdfdf26c78a377f1830affdf6cb416da) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix long chats (over 2000 messages) re-rendering old turns at the bottom of the transcript, showing raw tool-use ids as tool names, and reloading the whole history on every new message. Live replies now animate only the text that is actually streaming, and the final snippet no longer pops in at the end of a turn.

- [#742](https://github.com/qlan-ro/mainframe/pull/742) [`4f82774`](https://github.com/qlan-ro/mainframe/commit/4f82774d99c10f583ba28c44ccf73af116e0ca76) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Preserve Codex command actions and reported execution duration through live messages, restored history, and UI tool metadata.

- [#744](https://github.com/qlan-ro/mainframe/pull/744) [`8145d30`](https://github.com/qlan-ro/mainframe/commit/8145d3051b656a7fe5df7bc3fcb02ba3052376f9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix New sometimes failing with "Couldn't open a new session" — New no longer fails when a just-sent session finishes saving at the same moment.

- [#745](https://github.com/qlan-ro/mainframe/pull/745) [`3831add`](https://github.com/qlan-ro/mainframe/commit/3831add8548e86b1872ecacff5f1527bde24b439) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Overlapping transcript reloads no longer interfere with each other.

- [#738](https://github.com/qlan-ro/mainframe/pull/738) [`8326219`](https://github.com/qlan-ro/mainframe/commit/83262198f29e426ccd408ca3f879371b001e8437) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow wide markdown tables to scroll horizontally within transcript messages.

- [#747](https://github.com/qlan-ro/mainframe/pull/747) [`e3730c8`](https://github.com/qlan-ro/mainframe/commit/e3730c8e51bffb0249938010d67f86ac0f3181d8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a resume (reconnect mid-stream) briefly dropping the in-flight reply's text until the next partial arrived. A `session/resume` snapshot now includes the same in-flight overlay and streaming attribution a live update would show at that moment, so the replayed text matches what was already on screen.

- [#739](https://github.com/qlan-ro/mainframe/pull/739) [`ba53b7b`](https://github.com/qlan-ro/mainframe/commit/ba53b7b4363ae48ff8c36d0e9adc4f7a3d0b9c7b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix losing a text selection in a streaming reply: the selected part now holds the text shown on screen, keeps it through the end of the turn, and continues forward instead of retyping when released.

- [#752](https://github.com/qlan-ro/mainframe/pull/752) [`488b79c`](https://github.com/qlan-ro/mainframe/commit/488b79cbcc31a0f1e29aff5210d4583baefe3a02) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Smooth live reasoning text in Verbose and Compact transcripts, while keeping completed history immediate and preserving the final text when streaming ends.

- Updated dependencies [[`88d633c`](https://github.com/qlan-ro/mainframe/commit/88d633cbb33e20b8da9a4d84dd8cff8c7b3d79f3), [`54a31fb`](https://github.com/qlan-ro/mainframe/commit/54a31fbbcdfdf26c78a377f1830affdf6cb416da), [`4f82774`](https://github.com/qlan-ro/mainframe/commit/4f82774d99c10f583ba28c44ccf73af116e0ca76), [`d1b5d72`](https://github.com/qlan-ro/mainframe/commit/d1b5d721f19eab8f0e8356d6b75b749984d672cc), [`08590a2`](https://github.com/qlan-ro/mainframe/commit/08590a2fc9125678f34b52a023ab798795c5e01b), [`4be487f`](https://github.com/qlan-ro/mainframe/commit/4be487f95e41ab0d59d9d890461626f2289016b8)]:
  - @qlan-ro/mainframe-types@2.6.0
