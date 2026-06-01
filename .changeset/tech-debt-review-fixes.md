---
'@qlan-ro/mainframe-core': patch
---

Address thermo-nuclear review of the tech-debt branch: remove the dangling `removeWithChats` test references left after the cascade collapse (a vacuous, type-erroring assertion); delete the now-unreachable `else` branch in the git diff handler (the Zod `source` enum already rejects non-git sources); route the git/tunnel handlers through the shared `validate()` helper instead of hand-rolling identical Zod error formatting; align the todos attachment 400 with the plugin's local convention; and import `ExecutionMode` at the top of the Claude session module instead of inline.
