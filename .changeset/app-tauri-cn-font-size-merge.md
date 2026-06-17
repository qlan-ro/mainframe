---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix `cn()` silently dropping the custom font-size scale. tailwind-merge was
unconfigured, so it treated the warm-chrome `text-micro/caption/label/body/...`
size utilities as the same conflict group as `text-<color>` utilities and dropped
the size whenever a colour followed it — e.g. composer config chips styled
`text-label text-muted-foreground` rendered at the inherited 13px instead of 12px.
`cn` now registers the custom sizes in tailwind-merge's font-size group, so size
and colour survive together across the ~600 call sites that pair them.
