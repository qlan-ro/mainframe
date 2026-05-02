---
'@qlan-ro/mainframe-desktop': patch
---

Fix expandable cards/pills jumping off-screen when toggled near the chat bottom. Adds `useExpandable` hook that nudges the chat scroller up by 1px before `setOpen` when the user is at the bottom — defeats assistant-ui's `isAtBottom < 1` autoScroll check, so the browser keeps the pill anchored to its viewport position while the new body extends downward. No JS counter-scroll, single paint, no flash. Wired into `CollapsibleToolCard` (covers Bash/Edit/Write/Read/Plan/Default/AskUserQuestion), `MCPToolCard`, `SchedulePill`, `SkillLoadedCard`, and `TaskGroupCard`. Load-bearing detail: the 1px nudge is tied to assistant-ui's `isAtBottom` threshold — verify still works on future assistant-ui upgrades.
