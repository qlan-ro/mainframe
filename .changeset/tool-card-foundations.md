---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Tool card foundations: daemon adapter is now single source of truth for hidden tools. Desktop drops two hardcoded HIDDEN lists, filters via toolCall.category. CollapsibleToolCard gains hideToggle prop and renders subHeader in both open and closed states.
