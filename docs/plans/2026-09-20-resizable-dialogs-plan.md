# Resizable window-class dialogs (todo #340)

**Size:** s — short form, one implementation group, TDD inline.

## Goal

Give the shared `DialogContent` primitive an opt-in corner-resize capability and turn it on for the four
window-class dialogs (Settings, Review, Automations, Tasks board). An always-visible diagonal grip in the
bottom-right corner resizes the dialog live while it stays centered; the committed size persists per dialog key
in the existing `mf:ui-prefs` store and is restored on the next open. Dialogs that do not opt in render exactly
as today — same DOM, no grip, no behavior change.

## Files touched

| File | Change |
| --- | --- |
| `packages/ui/src/components/ui/dialog-resize.tsx` | **new** — `clampDialogSize`, `DialogResizeGrabber`, `useDialogResize` |
| `packages/ui/src/components/ui/dialog.tsx` | `DialogContent` gains one optional prop (`resizeKey?: string`); applies inline size + renders the grabber when set |
| `packages/ui/src/store/ui-prefs.ts` | `dialogSizes: Record<string, DialogSize>`, `setDialogSize(key, size)`, `dialogSizeFor(sizes, key, fallback)` |
| `packages/ui/src/components/ui/__tests__/dialog-resize.test.ts` | **new** — clamp helper cases |
| `packages/ui/src/store/__tests__/ui-prefs.test.ts` | selector fallback + setter cases appended |
| `packages/ui/src/features/settings/SettingsDialog.tsx` | `resizeKey="settings"` |
| `packages/ui/src/features/review/ReviewPanel.tsx` | `resizeKey="review"` |
| `packages/ui/src/features/automations/AutomationsHost.tsx` | `resizeKey="automations"` |
| `packages/ui/src/features/tasks/TasksModalHost.tsx` | `resizeKey={boardProjectId !== null ? 'tasks' : undefined}` |
| `.changeset/*.md` | patch for `@qlan-ro/mainframe-ui` |

## Shape

- **Where measurement lives.** The wrapper `DialogContent` is mounted whenever its call site renders, open or
  closed — Radix unmounts only the `DialogPrimitive.Content` subtree (see Established facts). So a mount effect
  in the wrapper fires once with a null element and never again on open. Measurement therefore lives in
  `DialogResizeGrabber`, which renders *inside* `DialogPrimitive.Content` and finds the box with
  `closest('[data-slot="dialog-content"]')`, exactly as `SidebarRail` finds the sidebar panel
  (`sidebar/sidebar.tsx:109`). The grabber reports size up through a callback; the wrapper holds
  `size | null` and applies the inline style. On grabber unmount the wrapper resets to `null`, so the next open
  re-measures. This also sidesteps ref composition — the repo has no `composeRefs` helper.
- **Default / minimum.** Measured in the grabber's `useLayoutEffect` on mount, **before any inline size
  exists**, with `offsetWidth`/`offsetHeight` (not `getBoundingClientRect` — the open animation puts a scale
  transform on the box), and held in a ref for the whole open. It has to be mount-time, not first-pointerdown:
  once a stored size is applied, a later measurement reads the stored box and the floor would drift to
  "whatever you left it at", so the user could never shrink back toward the declared default.
- **Restore.** In that same layout effect, `dialogSizeFor(dialogSizes, key, measuredDefault)` → clamp against
  `[min, viewport - 32]` → apply. A key with no stored size returns the measured default and nothing is
  applied, so the dialog keeps its declared classes. Because the state update happens in a layout effect, the
  restored size is in place before the browser paints.
- **Drag and commit** clamp against the same ref, so the floor is the declared default on every drag of every
  open.
- **Drag math.** The primitive centers with `translate(-50%,-50%)`, so the corner moves half as far as the size
  grows: a pointer delta of N applies a size delta of **2N**, keeping the grip under the cursor.
- **Clamp.** `clampDialogSize(requested, min, max)` where `min` is the measured default and `max` is
  `window.innerWidth/innerHeight - 32` (the primitive's `max-w-[calc(100%-2rem)]`). Min wins when the two
  cross — `Math.max(min, Math.min(v, max))` — so a dialog wider than a small viewport is never squeezed below
  its own default.
- **Commit.** `pointerup` calls `setDialogSize(key, size)`. The store writes what it is given; the hook clamps
  before committing, because the store cannot know a dialog's measured minimum (unlike `setSidebarWidth`,
  which clamps against module constants).
- **While dragging.** The inline style lifts `max-w`/`max-h` (`maxWidth: 'none'`, `maxHeight: 'none'`) and the
  wrapper adds `transition-none`. That class must be merged **after** the caller's `className` —
  `cn(base, className, dragging && 'transition-none')` — or twMerge lets the Tasks board's
  `transition-[width] duration-[180ms]` win (same trap as the Separator self-stretch case).
- **Grip.** Three short diagonal strokes, `text-muted-foreground/70`, ~12px, `cursor-nwse-resize`, positioned
  `absolute right-1 bottom-1` (inside the box — three of the four dialogs are `overflow-hidden`, so negative
  offsets would clip), last child with a z-index above the ScrollArea content,
  `data-testid="dialog-resize-grabber-<key>"`, `aria-hidden`, not focusable.

## Established facts

- Radix unmounts dialog content on close: `DialogPrimitive.Content` is wrapped in `<Presence present={forceMount || context.open}>` — `node_modules/@radix-ui/react-dialog/dist/index.mjs:134`. No call site passes `forceMount`.
- `zoom-in-95` animates `transform: … scale3d(var(--tw-enter-scale) …)` in the `enter` keyframe — `node_modules/tw-animate-css/dist/tw-animate.css:1`. `getBoundingClientRect` returns the transformed box; `offsetWidth`/`offsetHeight` are untransformed layout metrics, hence the measurement choice.
- zustand `persist` merges shallowly by default (`merge: (persisted, current) => ({...current, ...persisted})` — `node_modules/zustand/middleware.js:337`, zustand 5.0.14), so an additive `dialogSizes` key hydrates to its initial `{}` from any older payload. **No `version` bump or migration entry is needed** (store is at v6).
- `ui-prefs` tests assert per key, never on a whole persisted payload (`ui-prefs-migration.test.ts` uses `toEqual` only on `sessionPanelOpen`/`sessionPanelSections`), so the additive key does not break them — but `ui-prefs.test.ts`'s `beforeEach` reset and its "documented defaults" test enumerate every key and must gain `dialogSizes: {}`.
- Existing clamp precedent: `clampSidebarWidth` in `packages/ui/src/components/ui/sidebar/context.tsx:12-14`, exported from `sidebar/index.ts`.
- Existing pointer-drag precedent: `SidebarRail.onPointerDown` measures the target from the DOM and binds `pointermove`/`pointerup` on `window` — `packages/ui/src/components/ui/sidebar/sidebar.tsx:105-131`.
- The 2N centering compensation is proven in the approved prototype (branch `prototype/design-walk-2026-09-20`, `packages/ui/src/prototype/dialog-resize.tsx`, variant A — the user's pick).
- `2rem = 32px` holds: the root font-size is deliberately never overridden (`packages/ui/src/styles/globals.css:250-263` — "On `body`, never `html`"), and the UI scale is applied as native window zoom (`packages/ui/src/app/ThemeEffect.tsx:37`), which scales CSS pixels and `window.innerWidth` together.
- The four opt-in sites and their current classes: `SettingsDialog.tsx:60` (`h-[600px] … sm:max-w-[760px]`), `ReviewPanel.tsx:133` (`h-[86vh] max-h-[880px] … sm:max-w-[1180px]`), `AutomationsHost.tsx:66` (`h-[88vh] max-h-[880px] … sm:max-w-[1040px]`), `TasksModalHost.tsx:87` (conditional; board branch `max-h-[85vh] min-h-[480px]`). The Tasks board is the only one with no fixed `h-*` — its `min-h-[480px]` is what keeps a mount-time height measurement safe while its content is still loading.
- `TasksModalHost` renders a small project picker (`sm:max-w-sm`) through the **same** `DialogContent` when `boardProjectId === null` — the resize prop must be gated on `boardProjectId !== null`, mirroring the existing `showCloseButton={boardProjectId === null}`.
- `docs/plans/` is gitignored (`.gitignore:53`); this plan is committed with `git add -f`.
- UI package name for the changeset: `@qlan-ro/mainframe-ui`. `packages/ui` has `typecheck` and `test` scripts.

## Risks

- **Tasks board width vs. view switch.** The board's default width differs between list (`sm:max-w-[880px]`) and board (`w-[90vw] sm:max-w-[1200px]`) views under one storage key. Once a user resizes, the inline width wins and switching views no longer changes the width. Accepted for this pass (decision below).
- **Measured minimum is viewport-dependent** for the `vh`-based dialogs: the floor recorded on a tall display differs from a short one. Harmless — it is re-measured per drag, never persisted.
- **A stored size larger than a later, smaller viewport** is clamped down on restore but the stored value is left untouched, so the original size returns on a big display. Intentional.

## Exit gates

- Clamp-helper unit tests pass: below-min, above-viewport-max, in-range, and the degenerate min-greater-than-max case returning `min`.
- Store unit tests pass: `dialogSizeFor` returns the fallback for an absent key and the stored value for a present one; `setDialogSize` writes under the key and survives a persist reload.
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes, and the UI package's existing test suite still passes.
- A grep for `resizeKey` finds exactly the four intended call sites, and no non-opt-in dialog renders a grabber (the prop is absent → the component's returned tree is unchanged).
- Live check in the running app: each of the four dialogs drags from the corner with the grip staying under the pointer, stops at its default size and at the viewport bound, and reopens at the size it was left at after an app restart.
- A changeset for `@qlan-ro/mainframe-ui` is present.

## Decisions taken while planning

1. Measurement moved out of the wrapper into the grabber (Radix `Presence` unmounting makes a wrapper-level mount effect useless). Brief said "extend the primitive"; this stays inside the primitive's module boundary.
2. Default/minimum is measured at mount before any inline size is applied, not at first pointerdown (which the prototype and `SidebarRail` both use) — measuring after a restore would make the stored size its own floor. The Tasks board mounts lazily, so its mount-time height can be a loading state; `min-h-[480px]` keeps that floor defensible.
3. Single storage key `tasks` for the board regardless of list/board view; the inline width outlives a view switch.
4. No store version bump — the key is additive and zustand's default merge covers it.
5. The store setter does not clamp; the hook clamps before commit.
