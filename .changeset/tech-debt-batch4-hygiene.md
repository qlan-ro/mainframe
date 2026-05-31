---
'@qlan-ro/mainframe-core': patch
---

Core hygiene pass (behavior-preserving):

- Codex plan-mode handler: drop the four `as unknown as { ... }` casts of `ctx.active.session` and use the typed `AdapterSession` directly, matching the castless Claude sibling.
