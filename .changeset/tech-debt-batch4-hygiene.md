---
'@qlan-ro/mainframe-core': patch
---

Core hygiene pass (behavior-preserving):

- Codex plan-mode handler: drop the four `as unknown as { ... }` casts of `ctx.active.session` and use the typed `AdapterSession` directly, matching the castless Claude sibling.
- `AttachmentStore.deleteChat`: log the swallowed error instead of discarding it silently (a failure there means an invalid chatId segment, not a missing dir).
- `git-write` route: narrow the two `catch (err: any)` handlers to `unknown` and extract the message via the codebase's standard `err instanceof Error ? err.message : String(err)` guard.
