# @qlan-ro/mainframe-core

## 0.15.2

### Patch Changes

- [#263](https://github.com/qlan-ro/mainframe/pull/263) [`951d249`](https://github.com/qlan-ro/mainframe/commit/951d24954be02a58d4abfec90368de98aea7d498) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop synthesizing duplicate "Using skill" cards from subagent JSONLs on history replay. Each subagent (Task/Agent tool) writes its own `Base directory for this skill: …` isMeta entry; live mode never surfaces those at the parent level, so promoting them on replay produced ghost SkillLoadedCards that never appeared during the live session. Skill synthesis now skips entries from subagent files and sidechain entries.

- [#264](https://github.com/qlan-ro/mainframe/pull/264) [`fad6ea5`](https://github.com/qlan-ro/mainframe/commit/fad6ea5b2fb6b063ab59eb56a8fc89d16c715e6a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the duplicate "subagent prompt" pill in live Claude sessions. CLI 2.1.118+ normalizes `agent_progress` events into top-level stream-json messages with `parent_tool_use_id` set; the subagent's first event is a string-content user message that just restates the dispatch prompt — the same text already rendered by the parent's Task card from `Agent.input.prompt`. The Claude event handler now drops just that one event (string content with `parent_tool_use_id` set and no CLI-internal tags). Subagent skill loads, text/thinking, tool_use and tool_result blocks all flow through unchanged.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.15.2
