---
"@qlan-ro/mainframe-app-tauri": patch
---

Composer config chips now match the artboard geometry: a fixed 20px height (the
earlier `h-5` attempt resolved to 12px under the app's compressed spacing scale —
`h-[20px]` is exact), 8px/7px asymmetric padding, 11px (text-caption) labels, a 5px
gap, an always-on 0.5px hairline border (accent on open), and a 6px provider dot /
9px chevron. Verified live: all five chips compute to 20px.
