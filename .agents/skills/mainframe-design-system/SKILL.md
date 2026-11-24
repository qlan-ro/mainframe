---
name: mainframe-design-system
description: Use when building or restyling Mainframe UI components, or reviewing their design conformance. Follow the app's existing primitives and theme tokens.
---

# Mainframe design system

Mainframe uses React, Tailwind v4, and shadcn primitives in `packages/ui/src`.

## Visual source of truth

[`DESIGN.md`](../../../DESIGN.md) is the visual system: colours, type, layout, shape, components and rules. It is the target of the window redesign, whose decisions are rows in `design/redesign/DECISIONS.md`; a row marked "Implemented" is in the code, and the rest is not built yet. Where DESIGN.md and the code differ on something not built, keep the code's look unless your task builds it. `PRODUCT.md` says who the app is for.

Code sources, for the part you are changing:

- `packages/ui/src/components/ui/`: shared primitives. Match a nearby feature's composition; extend a primitive when it needs another prop rather than bypassing it with raw Radix in a feature.
- `packages/ui/src/styles/globals.css`: base theme, typography, radius, and Tailwind mappings.
- `packages/ui/src/styles/domain-tokens.css`: domain colors and app chrome.
- `packages/ui/src/styles/app.css`: stylesheet composition, scrollbars.

Use source values rather than copying token tables. A CSS variable only becomes a Tailwind utility when the theme maps it; check the mapping before using a domain token.

## Component conventions

- Reuse primitive variants and defaults. Put shared visual changes in the primitive or theme instead of repeating overrides across features.
- Use semantic tokens consistently for the same role. Check other uses before changing a token: `foreground` also fills tooltip backgrounds.
- Use `min-w-0` on shrinking flex children and `min-h-0` on scrolling flex children. Let the container bound panel height.
- Give dialogs a visible exit. Follow the current `DialogContent` and `DialogFooter` APIs in `components/ui/dialog.tsx`.
- Interactive elements have stable `<surface>-<element>` data-testids, keyed by domain id rather than array index; primitives pass them through.
- Represent the actual data contract and relevant empty, loading, error, populated, disabled, and running states.

- Give every scroll area plain `overflow: auto`. Scrollbars are overlay thumbs drawn app-wide by `lib/overlay-scrollbars` (S3): don't style native scrollbars, reserve a gutter or wrap a container for its scrollbar. `data-scrollbar="none"` hides the thumb on a strip it would cover.
- Focus is the solid 2 px focus line (C3), never a translucent ring: `focus-visible:focus-line` on controls, `focus-visible:focus-line-inset` on fields, full-width rows and anything a scroll area clips. A bare element with no `data-slot` gets it from the base stylesheet.

## Status colours

Each status hue has one meaning; do not choose by appearance.

- `primary`: selected, or running/wants attention (working spinner, "your turn" dot, unread dot, Run/Launch glyph).
- `success`: connected, healthy, or done (daemon connection dot, healthy PR row, done check). Never "running".
- `warning`: needs the user or degraded (Unattended chip, missing worktree/transcript, automation awaiting an answer).
- `fail`: failed work and errors (S6): failed tools, tasks, runs and queued messages, error labels, invalid fields, an unreachable daemon. Muted rose, at regular weight: a failure is information to read later, not an alarm.
- `destructive`: an irreversible action (delete, discard, reject), Stop, the context ring and usage near their limit, red output in terminal text, and diff deletions. Never a failure.
- `focus`: keyboard focus only.

## Verification

- Render visual changes in the running app; mounting tests and typechecking do not establish visual conformance. Use computed styles or element bounds to resolve size, color, and alignment questions.
- Check narrow widths, long labels, the relevant state matrix, light and dark themes, and compact UI scale (`packages/ui/src/store/theme.ts`).
- For color-token changes, run `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/styles/__tests__/contrast.test.ts`.
- Typecheck with `pnpm --filter @qlan-ro/mainframe-ui typecheck`.
