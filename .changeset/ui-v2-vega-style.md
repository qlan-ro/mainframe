---
'@qlan-ro/mainframe-ui': patch
---

Switch the v2 UI clone from the `radix-luma` style to `radix-vega`. Luma's pill geometry was too round for this app; vega squares the controls, tightens the sidebar rows and returns inputs to outlined fields. The token sheet is unchanged — the two styles ship identical stylesheets.
