---
"@qlan-ro/mainframe-app-tauri": minor
---

Select-to-quote in the chat. Selecting text in a message shows a floating "Quote"
button (assistant-ui SelectionToolbar); quoting adds a dismissable pill above the
composer (ComposerQuotePreview). On send, the controller prepends the quote to the
daemon message as a markdown blockquote (the AI-SDK injectQuoteContext path is inert
under our external-store runtime). Hand-ported from the assistant-ui shadcn registry
(not via `shadcn add`, which churns the lockfile on this branch).
