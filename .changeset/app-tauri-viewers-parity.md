---
"@qlan-ro/mainframe-app-tauri": patch
---

Viewer chrome artboard parity: ViewerShell footer status uses text-mf-text-3 (was
the over-faded text-4) and the breadcrumb tightens its trailing padding; the
Image/Svg Fit/Source segmented toggles sit in a bg-mf-chip pill with a raised
bg-background active segment; PdfViewer drops its bespoke toolbar for the matte
canvas + Open-externally in the ViewerShell actions slot; UnsupportedViewer names
the file inline in mono; CSV cells get the 14px horizontal padding.
