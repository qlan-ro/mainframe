---
'@qlan-ro/mainframe-core': patch
---

Stop synthesizing duplicate "Using skill" cards from subagent JSONLs on history replay. Each subagent (Task/Agent tool) writes its own `Base directory for this skill: …` isMeta entry; live mode never surfaces those at the parent level, so promoting them on replay produced ghost SkillLoadedCards that never appeared during the live session. Skill synthesis now skips entries from subagent files and sidechain entries.
