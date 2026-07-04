---
"@qlan-ro/mainframe-ui": patch
---

Close three deferred design-parity items. The composer edit-mode card now shows
the amber glow ring from the artboard (new `--mf-shadow-edit-ring` token, derived
from the per-scheme warning colour) instead of a plain drop shadow. Tasks
priority and type tints move off one-off hex onto semantic `--mf-priority-*` /
`--mf-task-type-*` theme tokens (status tints stay on generic swatches — no
artboard ground truth). In the split window style the right Inspector now carries
a left hairline instead of borrowing the sidebar's right one. And the code editor
now hot-swaps its CodeMirror `dark` flag live when the app switches between light
and dark mode (the base theme moved into a reconfigurable compartment), so an open
editor no longer keeps stale dark/light selection and cursor defaults until remount.
