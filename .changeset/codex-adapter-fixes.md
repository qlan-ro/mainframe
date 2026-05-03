---
"@qlan-ro/mainframe-core": minor
---

feat(codex): fix AskUserQuestion option selection and add sub-agent TaskGroup grouping

- fix(codex): extract selected option from `updatedInput.answers` when user clicks an option in AskUserQuestion (previously returned empty string, leaving Codex stuck)
- feat(codex): group Codex sub-agent commands under a `_TaskGroup` card via `collab_agent_spawn_begin`/`collab_agent_spawn_end` notifications (protocol confirmed via binary reverse-engineering of Codex 0.125.0)
