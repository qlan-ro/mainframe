# @qlan-ro/mainframe-ui

## 2.8.1

### Patch Changes

- [#784](https://github.com/qlan-ro/mainframe/pull/784) [`4f0046b`](https://github.com/qlan-ro/mainframe/commit/4f0046b62124b8b859a3f06623d6eb76ca72dc3a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The delegated task card's ↗ button now opens the task's chat beside the parent in a split instead of replacing it. The parent stays visible; clicking again when the task chat is already in the split just focuses it, and an archived task is still restored before opening.

- [#786](https://github.com/qlan-ro/mainframe/pull/786) [`d3e4516`](https://github.com/qlan-ro/mainframe/commit/d3e4516eeebefcb98b82fbec3efd1375ee6b5743) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Asking an agent to "spawn a Codex agent" or "ask Claude to" do something now starts a Mainframe task you can see, instead of a Claude Code plugin's hidden subagent. Delegated task results and other messages from agents now show as full-width cards on the left, like assistant replies, not on the right like your own messages. Their headers show the chat's title instead of a raw chat id. A delegated task's "Delegated by" link no longer reads "Untitled session" for a parent chat started in the same app session.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.8.1
