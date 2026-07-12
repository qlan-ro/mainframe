---
"@qlan-ro/mainframe-ui": patch
---

Style scrollbars globally instead of per-element. The warm thin scrollbar was an opt-in class covering 9 of 66 scroll containers; every other surface (markdown preview, diff viewers, workflows, tab panels, …) painted the native track — near-white under light themes and permanently visible with a mouse attached. Two @layer base rules now give every scroller the thin, hover-revealed, transparent-track treatment across all themes and schemes; [scrollbar-width:none] opt-outs still win, and the mf-thin-scrollbar class is removed.
