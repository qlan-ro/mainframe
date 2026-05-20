---
"@qlan-ro/mainframe-desktop": patch
---

Sandbox captures now render through the standard attachment renderers (composer thumb + user-bubble `ImageThumbs`) with a name caption beneath each thumbnail. `SandboxCaptureContext` is reduced to a consolidated metadata sidecar (name → selector breadcrumb → annotation), and `SelectorBreadcrumb`'s chevron seams are now visible via a last-segment-primary contrast (`bg-mf-accent` target, `bg-mf-hover` ancestors).
