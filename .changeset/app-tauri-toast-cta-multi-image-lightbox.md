---
"@qlan-ro/mainframe-app-tauri": patch
---

Wrap-up quick wins: make the toast "Open session →" CTA functional via a new
`lib/session-nav` seam (registered to `switchToThread` in the app shell), and add a
multi-image gallery lightbox (`ImageLightbox` with prev/next/counter/keyboard
nav) wired into inline message image rows and todo image attachments. Single-image
zoom (`ZoomableImage`) is retained for genuinely single-image sites.
