# Todo #424: themed, stacked toasts (short-form plan)

Size: s. Route: no-spec. Brief and design direction (variant A, a stacked card with a footer action row) live in the todo, which you can read with `task_context.py rgoM5ZldH0UeeOonms6PK 424`.

## Goal

Make sonner toasts follow the resolved app theme and update live. Map every toast part to theme tokens in the shared `Toaster` primitive. Move the close button inside the card on the title row. Clamp descriptions to 3 lines. When a description is clamped and the caller passed no `details`, show a Details button automatically. Buttons sit in a right-aligned footer row that appears only when there is a button. Placement, stacking, swipe and durations do not change.

## Files touched

- `packages/ui/src/components/ui/sonner.tsx`: read `useTheme((s) => s.resolvedMode)` and pass it as `theme`. Add `icons` (lucide 16px, coloured `text-destructive` / `text-warning` / `text-success` / `text-muted-foreground`) and `toastOptions.classNames` with popover tokens: `bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-md rounded-md p-3`, a one-line truncating title and a muted description.
- UI stylesheet (`packages/ui/src/styles/app.css` or a small sheet it imports): a `[data-sonner-toaster] [data-sonner-toast]` block. It switches the card from flex to a grid: header row `icon | content | close`, then a full-width footer row. It also neutralises sonner's absolute or translated close button styling and its `--gray*` and `#3f3f3f` colours, and sets the 3-line clamp on `[data-description]`.
- `packages/ui/src/lib/toast.ts`: each raise gets a generated `id`. `action` and `cancel` are passed as React elements: one fragment holding the footer (`Details` as a ghost `xs` button, then the primary action as a default `xs` button) plus, on persistent toasts only, a ghost `icon-xs` close button. Set `closeButton: false` for sonner. Each button calls `toast.dismiss(id)` after its handler, which keeps sonner's current click-dismisses behaviour. Test ids are `toast-close`, `toast-action` and `toast-details`. `description` becomes a clamped-description element. When that element first reports overflow and `details` was not given, re-issue the same toast by `id` with an auto Details payload (`details` = the full description).
- A small component file next to the helper (for example `packages/ui/src/components/ui/toast-parts.tsx`): the clamped description (measures `scrollHeight > clientHeight` and reports once) and the footer/close fragment.
- Tests: `packages/ui/src/lib/__tests__/toast.test.ts` (update to the element-based slots), plus a new Toaster test and a clamp test beside the new files.
- `packages/e2e/helpers/tauri/testids.ts`: point `TOAST.close` and `TOAST.action` at the new test ids. Add `TOAST.details`.
- `.changeset/*.md`: patch changeset for the `ui` package.

## Risks

- **Height re-measure.** Sonner measures toast height only when `title`, `description`, `action`, `cancel`, `jsx` or `id` change. A footer that appeared through internal component state would not trigger a re-measure, and stacked toasts would overlap. That is why the auto-Details path re-issues the toast by `id` with new slot elements. Re-issuing a non-persistent toast may restart its 4.2s timer, which is acceptable.
- **Class specificity.** Sonner's injected CSS uses `[data-sonner-toast][data-styled='true'] …` selectors, so plain utility classes can lose to them. The override block needs equal or higher specificity. Keep `data-styled` true and do not use `unstyled`, because sonner's stacking and swipe rules still apply then.
- **Swipe.** Sonner skips swipe tracking only when `event.target.tagName === 'BUTTON'`. The custom buttons must be real `<button>` elements, which the `Button` primitive already renders.
- **Mocks.** `App.integration.test.tsx` mocks `@/components/ui/sonner`, and other tests mock `sonner`'s `toast`. New imports (`toast.dismiss`, `useTheme`) must not break those mocks.
- Out of scope: the automation branch failure, message wording, toaster position.

## Established facts

- Sonner is 2.0.7 (`packages/ui/package.json` `"sonner": "^2.0.7"`; installed `node_modules/.pnpm/sonner@2.0.7_*`).
- The `Toaster` `theme` prop defaults to `'light'` and sets `data-sonner-theme` on the toaster. Changing the prop updates it through an effect. Receipt: `sonner/dist/index.mjs` `Toaster` destructure `theme = 'light'` and `setActualTheme` effect.
- `ToastClassnames` keys are toast, title, description, loader, closeButton, cancelButton, actionButton, success, error, info, warning, loading, default, content, icon. `ToastIcons` covers success, info, warning, error, loading and close. Receipt: `sonner/dist/index.d.ts` `interface ToastClassnames`, `interface ToastIcons`.
- `action` and `cancel` accept `Action | React.ReactNode`. A valid element renders as-is in that slot, without sonner's button or auto-dismiss. Receipt: `index.d.ts` `ToastT.action`; `index.mjs` `React.isValidElement(toast.action) ? toast.action : …`.
- `description` accepts a ReactNode. `ExternalToast` has `id` and `testId` (on the `<li>`). `toast.dismiss(id)` exists. Receipt: `index.d.ts` `ToastT`, `toast.dismiss`.
- DOM order inside `<li data-sonner-toast>` is close button, `[data-icon]`, `[data-content]` (`[data-title]`, `[data-description]`), cancel, action. Receipt: `index.mjs` `Toast` render.
- The stock close button is `position:absolute; top:0; transform: translate(-35%,-35%)`, which places it at the top-left corner. Its colours are hard-coded `--gray12`/`--gray4`. Receipt: `sonner/dist/styles.css` `[data-sonner-toast][data-styled='true'] [data-close-button]`.
- The height re-measure effect depends on `[mounted, toast.title, toast.description, setHeights, toast.id, toast.jsx, toast.action, toast.cancel]`. Receipt: `index.mjs` `Toast` "Keep height up to date" `useLayoutEffect`.
- The resolved theme source is `useTheme` `resolvedMode` (`'light' | 'dark'`, follows system through `syncSystemMode`). It is the same value `ThemeEffect` uses to toggle `.dark`. Receipt: `packages/ui/src/store/theme.ts` `useTheme`; `packages/ui/src/app/ThemeEffect.tsx` `ThemeEffect`.
- Tokens `--success`, `--warning`, `--destructive` and `--popover` exist. The `Button` primitive has `xs` and `icon-xs` sizes and `ghost` and `secondary` variants. Receipt: `packages/ui/src/styles/globals.css`; `packages/ui/src/components/ui/button.tsx` `buttonVariants`.
- The `Toaster` is mounted once in `packages/ui/src/app/App.tsx` (`position="top-right" offset={{ top: 48, right: 18 }} … expand`). The Details dialog is `ToastDetailsHost`, fed by `showToastDetails({ title, description, details })` (`packages/ui/src/store/toast-details.ts`).
- The e2e contract today is `TOAST` in `packages/e2e/helpers/tauri/testids.ts`, and `close` is used by `sessions-draft.spec.ts`. The remaining toast specs select by root, title or description text only.

## Exit gates (one implementation group, TDD inline)

- Red before green: the `toast.test.ts` expectations for element slots, generated `id`, `closeButton: false`, test ids and auto-Details are written failing first, then pass.
- A Toaster unit test shows `data-sonner-theme` following `useTheme` `resolvedMode`, and flipping it while a toast is mounted restyles without a remount.
- A clamp test shows that overflow triggers exactly one re-issue with a Details payload carrying the full text, that short text triggers none, and that a caller-supplied `details` is never replaced.
- The `ui` package typecheck, lint and the full vitest suite pass, including `styles/__tests__/contrast.test.ts`.
- No call site outside `lib/toast.ts` and `components/ui/sonner.tsx` changes, which you can confirm by grepping for `from 'sonner'`.
- Live check in the running app (light, dark, a mode switch while an error toast is open, compact scale, narrow window). The close button is inside the card, no light surfaces remain in dark mode, a long stderr description clamps and Details shows the full text, and a one-line success toast stays one row tall.
- The changeset is committed.
