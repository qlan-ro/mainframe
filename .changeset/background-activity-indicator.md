---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-ui': minor
---

Surface background work (subagents, background bash tasks, workflows) in the working indicator: the tracker registers every CLI task kind, `enrichChat` broadens the sidebar 'working' state and attaches a `backgroundActivity` payload, drain turns re-enter 'working', and a new BackgroundActivityBar chip above the composer lists live tasks.
