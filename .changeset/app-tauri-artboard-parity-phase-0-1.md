---
"@qlan-ro/mainframe-app-tauri": patch
---

Artboard-parity drift audit — foundation fixes (Phases 0–1). From a 14-surface
design-conformance sweep against the warm-chrome artboards
(`docs/architecture/2026-06-17-artboard-parity-drift-audit.md`):

- **Tokens** (`styles/globals.css`): restore the letter-spacing scale
  (`--tracking-tight` −0.02em / `--tracking-wide` +0.06em per the Design Tokens
  Report) and repoint uppercase caps labels to `tracking-wide`; close the
  `--mf-viewer-check-*` phantom-token by mapping it in `@theme inline`; add a
  per-scheme `--mf-scrim` token + mapping.
- **Primitives** (`components/ui`): command selected-row uses `bg-mf-selection`;
  context-menu uses `--mf-shadow-pop` + `rounded-lg` + a muted label; input/textarea
  use `bg-card` + a 0.5px hairline; dialog overlay uses `bg-mf-scrim`; button disabled
  opacity 0.45; scroll-area thumb uses `bg-mf-text-4`.
- **Blockers**: markdown fenced code blocks render one CSS-composed bordered/rounded
  container (CodeHeader top + shiki `<pre>` bottom); `ReviewPanel` shows a single
  close control via a new opt-in `hideClose` prop on `DialogContent`.

The `design-token-audit` typography lint now allows the three named tracking tokens,
a new guard test locks the token contract, and the xterm `terminal-cache` hex is
allowlisted (xterm `ITheme` requires literal hex).
