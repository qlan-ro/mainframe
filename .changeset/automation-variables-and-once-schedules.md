---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-app-tauri': patch
'@qlan-ro/mainframe-ui': patch
---

Teach automations three things the editor will need: a `set_variable` step that names a value once and reuses it downstream, `once` schedules that fire at a single moment instead of on a repeating pattern, and webhook triggers that carry their registration. Variables resolve by scope, so a name set inside a repeat belongs to that repeat and does not leak to later steps. The engine, the scheduler, and the shared types all understand them; the editor UI for authoring them lands separately.
