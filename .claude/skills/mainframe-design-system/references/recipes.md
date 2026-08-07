# Component recipes

Every recipe below is extracted from shipped code. Open the named file before building the equivalent —
these summaries exist to tell you *which* file to open, not to replace reading it.

## How this differs from stock shadcn

Paste a component from the shadcn docs and these six things will be wrong. They are systematic, so it is
worth knowing them as a set rather than rediscovering them one review comment at a time.

1. **Tighter radii.** Stock `--radius` is 10px; ours is 8px. `rounded-md` dominates (227 uses), then
   `rounded-full` (120) and `rounded-sm` (55). Note that ~130 sites use arbitrary radii instead —
   `rounded-[6px]` (45), `[8px]`, `[11px]`, `[4px]` are just the scale spelled out, but `[3px]`,
   `[5px]`, `[7px]` are genuinely off-scale. Prefer the named step.
2. **Denser.** Explicit control heights run **18–30px**, clustered at 30/28/24/22/20 — icon buttons
   22–28, chips 20. Chrome type runs 11–13px against shadcn's 14px default. Cut the default padding;
   don't keep it and shrink the font.
3. **Hairline borders.** `--border` is a low-alpha hairline (0.06–0.10), not a gray. The 0.5px treatment
   (`border-[0.5px]`, `[border-right:0.5px_solid_var(--border)]`) has ~118 uses — but plain `border-t`/
   `border-b` has ~134. Both are live. Use 0.5px for panel and pane edges; a plain `border-b` on a dialog
   header is normal. Follow the neighbouring component.
4. **Shadows are token-first, not tier-strict.** There are ~12 `--mf-shadow-*` tokens, not two —
   `-pop` for popovers and menus, `-modal` for dialogs, plus panel/card/rail/segment/keycap variants.
   Stock `shadow-sm` also has 23 legitimate uses on small raised elements. What to avoid is the heavy end:
   `shadow-lg` / `shadow-xl` appear 4 times total and are not the house style.
5. **Frosted chrome.** Translucent panels are `bg-background/85` + `backdrop-blur-xl`, not a solid fill —
   and the shell applies that, not you. (`mf-glass` was retired 2026-08-07.)
6. **Accent discipline.** `primary` is for primary actions, selection, and focus. shadcn's `accent` is the
   muted *hover* surface. This one is unambiguous in the code: 165 `hover:bg-accent` against 5
   `hover:bg-primary`.

## Dialogs

`components/ui/dialog.tsx` already supplies the material: `rounded-xl`, `border border-border`,
`bg-popover`, `shadow-[var(--mf-shadow-modal)]`, the `bg-mf-scrim backdrop-blur-sm` overlay, centering, and
the zoom/fade animation. Restating those classes is dead weight; replacing them with raw Tailwind
(`shadow-2xl`, `bg-card`) breaks the app's material language.

### Large panel — `features/tasks/TaskEditModal.tsx`

```
<DialogContent hideClose className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0">
  <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
    <DialogTitle className="flex items-center gap-2 text-heading font-bold">
      <Icon size={14} className="text-primary shrink-0" aria-hidden />
      Title
    </DialogTitle>
  </DialogHeader>
  <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0"> … </div>
  <footer className="… border-t border-border shrink-0"> … </footer>
</DialogContent>
```

The load-bearing parts: `flex flex-col` (DialogContent defaults to `grid`), `max-h-[90vh]` so the shell —
not an inner magic number — bounds the height, `flex-1 min-h-0 overflow-y-auto` on the one scrolling
region, `shrink-0` on header and footer. Header icon is `size={14}` and `text-primary`.

### Simple list — `features/sessions/sidebar/ArchivedSessionsDialog.tsx`

Keep DialogContent's default `p-6 gap-4 grid`, a visible `DialogHeader`/`DialogTitle`, a `ScrollArea` with
`max-h-[340px]`, a centered `py-8 text-body text-muted-foreground` empty state. `max-w-sm`.

### Confirm — `components/ui/confirm-dialog.tsx`

Also: `features/sessions/tags/TagDeleteConfirm.tsx`, `features/sessions/sidebar/ArchiveWorktreeDialog.tsx`.

### Small fixed-size — `features/daemon/DaemonSmallDialog.tsx`

`className="p-[20px] max-w-[400px]" hideClose` — arbitrary padding, own action row.

### `hideClose`

Legitimate, and used by 8 dialogs — but every one of them supplies its own exit (a footer action row, or a
close button in a custom header). A `hideClose` dialog with neither leaves Escape as the only way out.
`data-testid` belongs on `DialogContent` (`sessions-archived-dialog`, `sessions-import-dialog`).

## Menus and popovers

`components/ui/menu-variants.ts` is the single source of geometry:

- `MENU_CONTENT_PADDING = 'p-[5px]'` on every popover/menu content surface.
- `menuItemVariants` — `flex items-center gap-[9px] rounded-sm px-[8px] py-[7px] text-label`, icons forced
  to `size-[13px]` and `text-muted-foreground` unless the call site sets its own. Tones:
  `default` / `muted` / `destructive`.

Compose it — both the Radix `DropdownMenu`/`ContextMenu` items and the Popover-side `MenuRow` do. See
`components/ui/menu.tsx` (`MenuRow`, `MenuDivider`, `MenuEmpty`) and a full example in
`features/run/ToolbarLaunchControls.tsx`.

⚠️ `Hint` self-wraps a `TooltipProvider` and must **wrap** a Popover/Dropdown trigger, never sit inside it —
a non-forwarding component inside an `asChild` clone drops the ref Popper needs, and the trigger goes inert.

## Toolbar chrome — `layout/MainToolbar.tsx`

```
ICON_BTN  = h-[24px] w-[28px] rounded-[6px] border-none bg-transparent
            text-muted-foreground transition-[background] duration-[120ms] hover:bg-accent
```

Toolbar height is 40px; groups are separated by `<span className="mx-[4px] h-[16px] w-px bg-border" />`.
Separators mark *group boundaries* — one per boundary, not one per control.

## Buttons — `components/ui/button.tsx`

Variants `default` / `destructive` / `outline` / `secondary` / `ghost` / `link`; sizes `sm` (h-7) /
`default` (h-8) / `lg` (h-9) / `icon` (7×7) / `icon-sm` (6×6) / `icon-lg` (8×8). Base is `rounded-md
text-body font-medium`, SVGs auto-sized to `size-3.5`, disabled at `opacity-[0.45]`.

Raw `<button>` with hand-written classes is common in dense list rows (see `ArchivedSessionRow`) — that's
accepted for row-scale affordances. Anything that reads as a *button* (primary action, retry, footer
action) should use the primitive.

## Section headers and counts

Two primitives exist because the hand-rolled versions were app-wide legibility bugs. Use them.

- **`components/ui/section-header.tsx`** — `<SectionHeader trailing={…}>Favorites</SectionHeader>`. Sentence
  case, `text-xs font-medium text-muted-foreground`. It replaced the
  `text-micro font-bold uppercase tracking-wide` muted-ink eyebrow, which was 10px, low-contrast, and
  letter-spaced. That stack has already crept back into newer surfaces (daemon picker, quota, automations
  step options, spotlight) — don't add to them.
- **`components/ui/count-badge.tsx`** — `<CountBadge count={n} />`. The default is a capsule-*less* gray
  numeral, Finder/Mail style; `unread` tints it `primary`; `alert` is the only filled capsule and takes
  `tone="destructive"`. `showZero` is for section sizes only. Never hand-roll `bg-white/25` + `text-white`
  on an accent pill — white-on-translucent at 10px was the original reported bug.

## Scrolling

The thin warm scrollbar is **global** (`@layer base`, `scrollbar-width: thin` + hover-revealed
`scrollbar-color`) — a plain `overflow-y-auto` div already gets it. The old opt-in `.mf-thin-scrollbar`
class is gone.

Use `components/ui/scroll-area.tsx` when you want the Radix viewport (custom scrollbar rendering, corner).
It already patches Radix's `display:table` wrapper to `block!` — without that, `min-w-0`/`truncate` on rows
inside it silently stop working.

Standards path only: setting `scrollbar-width`/`scrollbar-color` makes engines ignore `::-webkit-scrollbar`
rules. Never mix the two.

## Layout traps

1. **`truncate` in a flex row needs `min-w-0`** on the shrinking item. Without it the item won't go below
   its content width and pushes trailing controls out of the container.
2. **A scrolling child of a flex column needs `min-h-0`**, or it grows past its parent instead of scrolling.
3. **`text-<size>` before `text-<color>`** is safe *only* through `cn()`, which registers the custom
   font-size group with tailwind-merge. Raw template-string class concatenation is not protected.
4. **Border-on-border**: an active-tab `border-b-2` and its container's `border-b` are two separate rules;
   pull the indicator onto the container line (`-mb-px`) or they read as a stack.
5. **WKWebView**: setting scrollbar props disables `::-webkit` rules; `backdrop-filter` won't blur under a
   sticky element; Virtuoso's rest-spread can override `data-testid`.

## Feedback

Toasts go through `mfToast` from `@/lib/toast`, not sonner directly — window-state toasts need to raise
above the overlays.

## Empty, loading, error

Look at how the neighbouring surface does all three before inventing one. Loading is usually
`animate-pulse rounded-md bg-muted` blocks matching the real content's shape; empty is centred
`text-body text-muted-foreground`; error states name what failed and offer one action.
