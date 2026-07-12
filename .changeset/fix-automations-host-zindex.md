---
"@qlan-ro/mainframe-app-tauri": patch
---

Fix Automations panel popovers (add trigger, add step, token picker) rendering invisibly behind the panel's own backdrop. `AutomationsHost`'s overlay used `z-[4600]`, well above the `z-50` tier every Radix popover/dropdown in the app defaults to — so clicking "+ Add a trigger" or "+ Add step" opened the menu, just painted underneath the modal. Overlay now uses `z-50`, matching every other full-screen dialog in the app.
