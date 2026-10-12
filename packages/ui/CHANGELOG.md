# @qlan-ro/mainframe-ui

## 2.9.0

### Minor Changes

- [#818](https://github.com/qlan-ro/mainframe/pull/818) [`5466ea6`](https://github.com/qlan-ro/mainframe/commit/5466ea6bcb38c809983aa3d3a44ee7a6ee377d1b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open native subagent transcripts beside their parent chat and make delegated task chats read-only while preserving approval gates.

### Patch Changes

- [#819](https://github.com/qlan-ro/mainframe/pull/819) [`8d026ac`](https://github.com/qlan-ro/mainframe/commit/8d026ac714f54b99072b2b4b16b64859afa5dc6e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Switching providers in an unsent chat now selects the new provider's default model, so a task started from the board no longer carries a Claude model into Codex.

- [#784](https://github.com/qlan-ro/mainframe/pull/784) [`4f0046b`](https://github.com/qlan-ro/mainframe/commit/4f0046b62124b8b859a3f06623d6eb76ca72dc3a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The delegated task card's ↗ button now opens the task's chat beside the parent in a split instead of replacing it. The parent stays visible; clicking again when the task chat is already in the split just focuses it, and an archived task is still restored before opening.

- [#786](https://github.com/qlan-ro/mainframe/pull/786) [`d3e4516`](https://github.com/qlan-ro/mainframe/commit/d3e4516eeebefcb98b82fbec3efd1375ee6b5743) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Asking an agent to "spawn a Codex agent" or "ask Claude to" do something now starts a Mainframe task you can see, instead of a Claude Code plugin's hidden subagent. Delegated task results and other messages from agents now show as full-width cards on the left, like assistant replies, not on the right like your own messages. Their headers show the chat's title instead of a raw chat id. A delegated task's "Delegated by" link no longer reads "Untitled session" for a parent chat started in the same app session.

- [#820](https://github.com/qlan-ro/mainframe/pull/820) [`6e0f573`](https://github.com/qlan-ro/mainframe/commit/6e0f5731bf4d349ce3d50736104dd2aef9dbb092) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Delegated tasks now appear in the parent chat's Activity panel with their current status and a link to the child chat. The parent session stays marked as working while a delegated task runs, including after the parent's own turn ends.

- [#815](https://github.com/qlan-ro/mainframe/pull/815) [`1fb8e87`](https://github.com/qlan-ro/mainframe/commit/1fb8e87fe1a32fa899b944aa6c0351c4de53f180) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Use a right-facing Lucide Split icon for thread fork actions and lineage markers. Move "Fork from here" from user messages to assistant turns so a fork keeps the selected answer and opens with an empty composer. Move the chat/workspace toggles to the title bar's right edge and the side chat action beside the chat header's session panel button.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.9.0
