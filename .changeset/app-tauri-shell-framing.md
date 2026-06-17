---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix the workspace shell framing (composition drift the per-component audit missed): the
rounded white card was drawn around the whole main pane — so it enclosed the
`mainframe | branch` toolbar and whitened the title area. Per the prototype
(`04-engine.jsx` `surfCard`), each **surface** owns the rounded card and the toolbar is a
transparent band on the window background. `window-style.ts` now splits geometry into a
transparent `pane` + a per-`surface` card; `SurfaceHost` applies the card per surface.
