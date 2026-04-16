---
'@qlan-ro/mainframe-desktop': patch
---

Prevent `TurnFooter` crashes from bringing down the whole chat turn, and log renderer-process crashes so blank-screen bugs leave a trace.

- `TurnFooter`: local error boundary. `assistant-ui`'s `tapClientLookup` can throw `"Index N out of bounds (length: N)"` during concurrent renders when the external messages array shrinks between a parent capturing its index and a descendant hook reading it. The boundary scopes the failure to the footer and auto-resets on the next render; the rest of the turn keeps rendering.
- `main`: listen for `render-process-gone` and log `{ reason, exitCode }`. Renderer crashes (OOM, GPU, killed) previously left no trace because React `ErrorBoundary` only catches render errors, not process-level failures.
