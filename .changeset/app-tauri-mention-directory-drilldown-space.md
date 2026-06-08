---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix `@`-mention directory drill-down inserting a stray trailing space. The native
`Unstable_TriggerPopover` always appends a closing space when an item is accepted
(Tab/Enter), which ended the `@` token and forced the user to delete a character
to keep browsing into a folder. The `@` directive now drops that single trailing
space for DIRECTORY items via `TP.Directive`'s `onInserted` hook (only when the
`@<dir>/ ` directive is at the very end of the input, so trailing text is never
glued). Files and agents keep their closing space. The space-removal logic is a
pure, unit-tested helper.
