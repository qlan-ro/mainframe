---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-desktop': patch
---

Backport daemon/core bug fixes from the 2.0 line to 1.0:

- **Cross-project path guard**: `getEffectivePath` now rejects a `chatId` that belongs to a different project, preventing file/git reads and writes from being re-based onto another project's worktree.
- **Stuck "working" chats**: reset orphaned `processState: 'working'` chats to `idle` on daemon boot, so chats left mid-run by a restart/crash no longer appear running and queue new messages forever.
- **Tunnel timeout race**: clear the pre-connection start timeout the moment a tunnel connects, so a tunnel that takes longer than the start window to verify DNS is no longer torn down while healthy.
- **Codex history ids**: derive message ids from stable Codex thread-item ids instead of `nanoid()`, so reloading a Codex chat emits incremental display deltas instead of re-broadcasting the whole transcript.
- **AskUserQuestion parsing**: accept the newer Claude CLI result wording ("Your questions have been answered: …") so answers keep parsing across CLI versions.
- **Title generation**: pass `--no-session-persistence` so throwaway title prompts no longer leave ghost sessions in the CLI session list / external-session scan.
- **Codex external sessions**: honor `excludeSessionIds` so already-active sessions no longer appear as duplicates in the resume picker.
- **Deleted worktree path**: `ChatManager.getEffectivePath` returns `null` when the chat's worktree is missing instead of a stale path.
