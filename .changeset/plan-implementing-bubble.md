---
"@qlan-ro/mainframe-ui": patch
---

Render an approved plan as an "Implementing plan" bubble instead of a plain
message or a raw "Updated plan" tool card. A shared `PlanBubble` (green
checklist chip + "Approved" pill + Markdown body, per the User Message States
artboard) now covers both approval paths: the clear-context user turn (the
daemon's `Implement the following plan:` prefix) and the no-clear-context
`ExitPlanMode` approval result. The non-approval "not in plan mode" card is
unchanged.
