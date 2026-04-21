---
"@qlan-ro/mainframe-desktop": patch
---

The composer now preserves newlines in sent messages and caps its growth at a max height with internal scroll.

The max-height cap is applied to an outer scroll wrapper rather than the textarea itself, so the textarea grows naturally and shares its wrapping width with the highlight overlay. With the cap on the textarea, its own scrollbar shaved the effective content width, causing the two layers to wrap at different widths and the caret to drift from the visible text. The overlay also emits a trailing zero-width marker so the caret stays aligned when the text ends with a newline.

The global text selection color is now a neutral blue instead of the orange accent, so mentions and other accent-colored text stay readable while selected.

The highlight overlay now seeds its text from the runtime's current state on mount instead of waiting for a subscribe event, so draft text stays visible after ancestors remount (for example, when a permission prompt closes).
