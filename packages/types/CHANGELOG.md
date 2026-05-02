# @qlan-ro/mainframe-types

## 0.16.0

### Minor Changes

- [#270](https://github.com/qlan-ro/mainframe/pull/270) [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.

- [#268](https://github.com/qlan-ro/mainframe/pull/268) [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Nest subagent activity inside the parent's Task card on both live stream and history reload.

  Replaces the prompt-suppression patches in PRs [#264](https://github.com/qlan-ro/mainframe/issues/264) and [#267](https://github.com/qlan-ro/mainframe/issues/267) with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

  History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

  New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.

### Patch Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pill family of tool cards: U12 mobile SkillLoadedCard port + adds `skill_loaded` content type. U14 WorktreeStatusPill (EnterWorktree, ExitWorktree). U15 MCPToolCard (wildcard for `mcp__*`). U16 SchedulePill (ScheduleWakeup, CronCreate, CronDelete, CronList, Monitor). All share the centered rounded-full pill shape from SkillLoadedCard.
