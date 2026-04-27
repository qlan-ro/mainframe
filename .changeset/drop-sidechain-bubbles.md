---
'@qlan-ro/mainframe-core': patch
---

fix(claude): drop sidechain entries from history loader so subagent dispatch prompts no longer render as ghost user bubbles in the parent thread. Skill-loaded synthesis still runs first, so user-typed `/skill` invocations are preserved.
