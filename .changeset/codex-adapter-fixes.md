---
"@qlan-ro/mainframe-core": minor
---

feat(codex): fix AskUserQuestion option selection and add sub-agent TaskGroup grouping

- fix(codex): extract selected option from `updatedInput.answers` when user clicks an option in AskUserQuestion (previously returned empty string, leaving Codex stuck)
- feat(codex): render Codex sub-agent delegations as a `CollabAgent` card by handling the `collabAgentToolCall` ThreadItem on `item/started` (opens the card) and `item/completed` (closes it). `CollabAgent` is registered as a subagent tool, so the desktop's `groupTaskChildren()` promotes it to a TaskGroup card when child commands emitted on the spawned thread arrive tagged with `parentToolUseId`. Both the live event-mapper path and the chat-reload `convertThreadItems()` path emit the card so it persists across daemon HMR. Verified against Codex 0.125 strings — the `collab_agent_spawn_*` notifications assumed by the earlier draft do not exist in the binary.
