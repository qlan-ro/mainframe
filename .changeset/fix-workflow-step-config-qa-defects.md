---
"@qlan-ro/mainframe-ui": patch
---

Fix three live-QA defects on the workflow step-config builder:

- The YAML preview pane's header chip only read `validation` (always `null` after a validate-request failure), never `validationError`, so it hung on "Validating…" forever whenever the daemon hard-rejected a validate call (e.g. a 400 for a schema violation) — even though the footer and step-row badges settled correctly. It now settles to the same "N issue(s)" state.
- The shared shiki highlighter singleton passed its supported-languages `Set` straight to `createHighlighter({ langs })` cast through `as unknown as`; real shiki calls `.map()` on `langs` during init and throws, so every code preview (workflow YAML, chat code blocks, markdown preview) silently fell back to unstyled plain text on every render. `langs` is now a real array.
- Clicking an existing `${...}` chip in a workflow expression field could leave the magic-variable picker open alongside the raw-edit box if the picker happened to already be open. A chip click now always closes the picker.
