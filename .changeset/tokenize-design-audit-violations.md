---
"@qlan-ro/mainframe-ui": patch
---

Tokenize the raw color literals and arbitrary/framework-default typography left
in the workflows editor, the daemon-pairing surfaces, and the new-thread empty
states. Adds five design-constant `--mf-wf-*` step-kind colors and two
`--mf-shadow-card*` elevation tokens to `mainframe-theme.css` for values with
no existing token equivalent; every other literal maps onto the existing
`text-*`/`tracking-*`/`leading-*` scale. No visual change except the
workflow-builder step-library modal scrim, which now matches the app-wide
`mf-scrim` used by every other modal overlay (was a very slightly lighter
one-off value).
