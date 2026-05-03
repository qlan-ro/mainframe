---
"@qlan-ro/mainframe-core": minor
---

feat(codex): fix AskUserQuestion option selection and add sub-agent TaskGroup grouping

- fix(codex): extract selected option from `updatedInput.answers` when user clicks an option in AskUserQuestion (previously returned empty string, leaving Codex stuck)
- feat(codex): render Codex sub-agent delegations as a `CollabAgent` card by handling the `collabAgentToolCall` ThreadItem on `item/started` (opens the card) and `item/completed` (closes it). `CollabAgent` is registered as a subagent tool, so the desktop's `groupTaskChildren()` promotes it to a TaskGroup card when child commands emitted on the spawned thread arrive tagged with `parentToolUseId`. Both the live event-mapper path and the chat-reload `convertThreadItems()` path emit the card so it persists across daemon HMR. Verified against Codex 0.125 strings — the `collab_agent_spawn_*` notifications assumed by the earlier draft do not exist in the binary.
- feat(codex): use the agent's `nickname` (e.g. "Maxwell") and `role` (e.g. "explorer") from Codex's own `~/.codex/state_5.sqlite` thread registry as the TaskGroup card title and subtitle, instead of falling back to the raw spawn prompt.
- feat(codex): pass `persistFullHistory: true` to `thread/start`/`thread/resume` (requires the existing `experimentalApi: true` capability) so spawned sub-agents stream their `commandExecution` items to the parent's notification stream.
- feat(codex): on history reload, recover sub-agent `commandExecution` items by reading each child thread's rollout JSONL directly (`~/.codex/sessions/.../<threadId>.jsonl`). The JSON-RPC `thread/read` API filters function_call records out of child threads, so without this the reloaded TaskGroup cards lacked their nested bash commands.
- fix(codex): on chat reload, extract `userMessage.content[0].text` from `thread/read` results — Codex stores the prompt under the nested `content` array, not the top-level `text` field. Without this fix, every reloaded chat was missing all user-typed messages.
