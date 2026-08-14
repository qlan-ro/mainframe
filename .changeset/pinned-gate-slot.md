---
"@qlan-ro/mainframe-ui": patch
---

A permission request, a question, or a plan awaiting your answer now sits above
the composer instead of at the end of the transcript, so it stays in view while
you scroll back through the run it is blocking. The pinned slot caps itself at
45% of the thread pane and scrolls inside itself, so a long plan never pushes
the composer off screen — and, symmetrically, a long queued draft in the
composer can no longer starve the slot down to nothing. Answering the gate
returns the space to the transcript.
