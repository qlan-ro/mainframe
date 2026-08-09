# Todo #304 — `@` / `/` suggestion list becomes an anchored overlay

**Goal:** The composer's `@` and `/` suggestion list renders in normal document flow inside the thread's sticky
`ViewportFooter`, whose measured height is the thread's scroll inset, so opening the list grows the composer and
pushes thread content upward. Rebuild the shared listbox as the repo's portalled `Popover` primitive anchored to the
field it serves, with the row internals rebuilt on the shadcn `Command` tree, so opening, closing, and resizing the
result set leave the composer's height and the thread's scroll position untouched, while the existing trigger engine
keeps sole ownership of detection, filtering, keyboard, selection, ARIA ids, and test ids.

**Architecture:** `TriggerFieldPopover` stops being a positionless in-flow `<div>` supplied with `position` by each
caller. It becomes a wrapper: `Popover` → `PopoverAnchor asChild` around the caller's field root → portalled
`PopoverContent` holding `Command` → `CommandList` → `CommandItem` rows. cmdk contributes chrome and structure only:
filtering off, pointer selection off, no `CommandInput`, no `onSelect`. Every row is `CommandItem asChild` over the
existing `<button role="option">`, which is what keeps our `id`, `data-testid`, and `data-highlighted` on the DOM node
(Radix `Slot.mergeProps` lets child props win and composes event handlers). Both consumers — the composer and the
automations `TriggerTextField` — opt into the same overlay, so they cannot drift apart again.

**Tech Stack:** TypeScript (strict), React 19, Radix Popover (`radix-ui` via `components/ui/popover`), cmdk 1.1.1 (via
`components/ui/command`), Tailwind v4, Vitest + Testing Library, Playwright, pnpm workspaces.

---

## Verified facts this plan rests on

Each was read out of the installed source in this worktree, not assumed.

1. **The list has no positioning of its own.** `TriggerFieldPopover.tsx:69-75` renders a plain block with
   `z-50 max-h-64 w-80 … shadow-md` and takes `position` from the caller's `className`. `TriggerTextField.tsx:130`
   passes `absolute left-0 top-full mt-1`; `ComposerTriggers.tsx:166` passes nothing. That divergence is the defect.
2. **The footer's height is the thread's scroll inset.** `ChatThread.tsx:158-159` —
   `{/* Sticky footer — its height is measured into the scroll inset. */}`.
3. **`--radix-popover-trigger-width` is populated from the anchor, not only from a trigger.**
   `@radix-ui/react-popper` sets `--radix-popper-anchor-width` from `rects.reference`; `@radix-ui/react-popover`
   re-exports it as `--radix-popover-trigger-width`. `PopoverAnchor` supplies the reference. `DependencyPicker.tsx:75`
   already consumes the var in this repo.
4. **cmdk overrides `id` on both `Item` and `List`.** `cmdk/dist/index.mjs` renders
   `createElement(Primitive.div, { ...ourProps, id: generatedId, role: 'option', … })` — ours is spread *before*, so
   cmdk wins. The same holds for `CommandList` (`id: listId`, plus `aria-activedescendant: selectedItemId` and
   `aria-label`). `data-testid` is **not** overridden.
5. **`asChild` reverses that.** cmdk's `Primitive` is `@radix-ui/react-primitive`; `Slot.mergeProps(slotProps,
   childProps)` returns `{ ...slotProps, ...overrideProps }` where `overrideProps` starts as `childProps` — child
   props win for `id`/`data-*`, `className` is concatenated, and `on*` handlers are **composed** (child first, then
   slot). cmdk's `Item` and `List` both accept `asChild` in their published types.
6. **cmdk's keyboard handler is unreachable here.** It is bound to the `Command` root
   (`createElement(Primitive.div, { tabIndex: -1, onKeyDown … })`). The composer textarea lives in a different DOM
   subtree (the anchor, not the portal) and the overlay never takes focus, so cmdk's ArrowUp/Down/Enter never fire.
   There is no second key handler to reconcile.
7. **cmdk does not lowercase item values** (1.1.1 trims only), and `disablePointerSelection` / `shouldFilter` /
   controlled `value` are all published props.
8. **Category rows are selectable.** `use-trigger-field.ts:118-124` — `selectEntry(category)` sets
   `activeCategoryId`, i.e. drill-in. `navigation.ts:61` returns `navigableList = activeCategoryId ? items :
   visibleCategories`, one flat list the highlight index walks.
9. **Radix `Presence` unmounts immediately under jsdom.** It gates on `getComputedStyle(node).animationName`, which
   is `none` when no stylesheet is loaded, so `queryByTestId(...)` returning null on close still works in tests.

---

## Decisions

These override or resolve parts of the brief and the design direction. The lane reviewer should read them first.

- **D1 — Categories stay `CommandItem` rows; no `CommandGroup`.** The design direction states category rows "are not
  selectable"; fact 8 shows they are — a category row drills into that category, and the keyboard highlight walks
  categories and items through the same flat `navigableList`. Rendering them as `CommandGroup` headings would delete
  `@`'s drill-down navigation and the `composer-file-item-category-<id>` test id. No `CommandGroup` is used at all:
  with one flat list it would only add a second layer of padding.
- **D2 — `CommandEmpty` is not adopted; the panel still renders nothing when there are no entries.** The feedback
  asked for a deliberate pick. The deciding reason is asynchrony: the `@` mention source is an async-over-sync cache
  with no loading signal, so between the keystroke and the debounced `searchFiles` result the entry list is legitimately
  empty with a non-empty query — `CommandEmpty` would flash "No results" on the way to results on every `@` query. Two
  supporting reasons: `TriggerField.open` is *defined* as `entries.length > 0` (`use-trigger-field.ts:91`), so adopting
  an empty state changes when the overlay exists and what `aria-expanded` reports; and five existing assertions across
  `use-trigger-field.test.tsx` and `TriggerTextField.test.tsx` assert no popover on a no-match query. Revisit when the
  mention adapter grows a loading state.
- **D3 — cmdk is adopted for chrome and structure, not behavior.** This is the shape the feedback's own escape hatch
  contemplates ("keep the engine's keyboard path with `CommandItem` used for presentation only — do not ship two
  competing key handlers"), chosen up front rather than as a retreat. The engine keeps detection, filtering, the
  highlight index, insertion, the option ids, and the test ids. cmdk supplies the row/list/panel recipe and the
  `data-selected` styling hook, driven from the engine's `highlightedIndex`.
- **D4 — `components/ui/command.tsx` gains an `asChild` guard.** Its `CommandItem` renders `{children}` plus a trailing
  `CheckIcon`; two children into a Radix `Slot` throws. The wrapper skips the check icon when `asChild` is set. This is
  additive, and no current consumer passes `asChild` (verified in Task 3).
- **D5 — `TriggerField` gains `close()`.** Radix reports dismissal through `onOpenChange`; with `open` controlled by
  `field.open` and no way to close the field, an outside click would leave the panel up. `close` already exists inside
  the hook as a stable `useCallback` — this only exports it. This is not the caret/anchor surface the brief ruled out.
- **D6 — Per-consumer side and width.** The composer opens upward (`side="top"`) and takes the composer's width
  (`w-(--radix-popover-trigger-width)`, uncapped — the anchor *is* the composer, so it cannot exceed it). The
  automations field opens downward (`side="bottom"`, matching today's `top-full mt-1`) and keeps `w-80`, its current
  width, so its rendered result stays equivalent. Placement mechanism (portal, anchor, collision handling) lives in the
  shared component; only these two knobs are per-caller.
- **D7 — Plan location.** The dispatch requires `docs/plans/`; the repo's three older plans live in
  `docs/superpowers/plans/`. This plan creates `docs/plans/` as directed and does not move the older files.
- **D8 — Out of scope, unchanged.** Todo #316 (the `@` toolbar button submitting instead of opening the picker) is a
  separate defect on the same surface and lands after or alongside this one; `ComposerAddMention` is not modified here.

---

## Global constraints

- Files stay under 300 lines, functions under 50.
- `data-testid` values are frozen: `composer-trigger-popover`, `composer-skill-item-*`, `composer-file-item-*`,
  `composer-file-item-category-*`, `composer-mention-session-*`, `<field>-trigger-popover`, `<field>-variable-item-*`.
- The overlay never takes focus. `onOpenAutoFocus` and `onCloseAutoFocus` are both prevented.
- `field.handleKeyDown` and `field.setCursorPosition` stay referentially stable — `ComposerInputPluginBridge`
  registers them once into assistant-ui's composer-input plugin registry, and churn there silently kills both triggers.
- Every implementer working in `packages/ui` loads the repo's `mainframe-design-system` skill **before** writing markup
  or class names.
- Do not restate chrome `PopoverContent` and `Command` already supply (portal, `z-50`, `bg-popover`, radius, shadow,
  ring, transform origin, side-aware animations).
- Stage only the files named in this plan; the worktree may hold other agents' work.

---

## Group 1 — Red-phase placement tests

Owns one new file. Must be observed failing before Group 2 exists.

### Task 1: Failing test — the suggestion list is not a layout descendant of the field

**Files:**

- Create: `packages/ui/src/components/trigger-engine/__tests__/trigger-popover-placement.test.tsx`

**Interfaces:**

- Consumes: `TriggerTextField` (`@/features/automations/fields/TriggerTextField`), `ComposerTriggers`
  (`@/features/chat/composer/triggers/ComposerTriggers`), `useExternalStoreRuntime` / `AssistantRuntimeProvider` /
  `ComposerPrimitive` from `@assistant-ui/react`.
- Produces: no source API. The test asserts DOM containment only, so it compiles against both the current
  sibling-rendered component and the wrapper API Group 2 introduces.

- [ ] **Step 1: Write the automations-consumer assertion**

Mock `@/lib/api/projects`, `@/lib/api/skills`, and `@/lib/api/files` exactly as
`src/features/automations/fields/__tests__/TriggerTextField.test.tsx` does. Render
`<TriggerTextField testId="notify-message" triggers="variables-only" scope={SCOPE} value={value} onChange={…} />`
in a small controlled wrapper, fire a `change` to `"$"` with `selectionStart` at the end, then assert:

```ts
const popover = await screen.findByTestId('notify-message-trigger-popover');
const container = screen.getByTestId('notify-message-container');
expect(container.contains(popover)).toBe(false);
```

- [ ] **Step 2: Write the composer-consumer assertion**

Copy the mock block from `src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx`
(`use-chat-thread-runtime`, `draft-config`, `use-chat-skills`, `@/lib/api/files`, `use-session-mention-source`) into
this file. The duplication is deliberate: two copies is under the repo's 3+ extract-a-helper threshold, and it keeps
this file free of any file Group 2 edits. Render the same harness shape
(`AssistantRuntimeProvider` → `ComposerPrimitive.Root data-testid="composer-root"` → `ComposerTriggers` →
`ComposerPrimitive.Input data-testid="composer-input"`), seed one skill, fire a `change` to `"/"`, then assert:

```ts
const popover = await screen.findByTestId('composer-trigger-popover');
expect(screen.getByTestId('composer-root').contains(popover)).toBe(false);
```

Add a file-header comment stating what the test pins: the suggestion list must not contribute height to the sticky
`ViewportFooter`, which is why it must not be a DOM descendant of the composer form.

- [ ] **Step 3: Run the file and verify RED**

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run \
  src/components/trigger-engine/__tests__/trigger-popover-placement.test.tsx
```

Both tests must fail on `expect(false).toBe(true)`-shaped assertions — the popover is currently a descendant of the
field container and of the composer form. A failure with any other message (mock wiring, no popover found) means the
harness is wrong, not the production code: fix the harness until the failure is the containment assertion itself.

---

## Group 2 — Overlay implementation

### Task 2: Export `close()` from the trigger field

**Files:**

- Modify: `packages/ui/src/components/trigger-engine/use-trigger-field.ts`

**Interfaces:**

- Produces: `TriggerField.close(): void` — "Dismisses the list and stops matching the current token."

- [ ] **Step 1: Add `close` to the `TriggerField` interface** with a one-line doc comment, placed next to
  `handleKeyDown`.
- [ ] **Step 2: Return the existing `close` callback** from the hook's return object. It is already a
  `useCallback(…, [])`, so referential stability is unchanged. Do not alter its body.
- [ ] **Step 3: Verify** `pnpm --filter @qlan-ro/mainframe-ui typecheck` reports only the expected error — the
  `makeField` fixture in `__tests__/TriggerFieldPopover.test.tsx` now misses `close` (fixed in Task 7).

### Task 3: Let `CommandItem` be used with `asChild`

**Files:**

- Modify: `packages/ui/src/components/ui/command.tsx`

**Interfaces:**

- Produces: `CommandItem` renders bare `children` when `asChild` is set, and `children` + trailing `CheckIcon`
  otherwise. No prop is added or removed.

- [ ] **Step 1: Confirm no current consumer passes `asChild`**

```bash
grep -rn "CommandItem" packages/ui/src --include=*.tsx | grep asChild
```

Must print nothing. If it prints anything, stop and report — the guard would change that consumer's rendering.

- [ ] **Step 2: Destructure `asChild` and branch the children.** Keep `asChild` forwarded to
  `CommandPrimitive.Item`; keep `data-slot`, the `cn(...)` class, and every other prop identical. Add a one-line
  comment saying why: a Radix `Slot` accepts exactly one child, so the trailing check icon cannot ride along.
  If cmdk's published `Item` props do not include `asChild`, widen the wrapper's own prop type with
  `& { asChild?: boolean }` rather than casting — no `@ts-ignore`.
- [ ] **Step 3: Verify** the ten existing `Command` consumers still typecheck:
  `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task 4: Rebuild `TriggerFieldPopover` as an anchored, portalled Command list

**Files:**

- Modify: `packages/ui/src/components/trigger-engine/TriggerFieldPopover.tsx`

**Interfaces:**

- Consumes: `Popover`, `PopoverAnchor`, `PopoverContent` from `@/components/ui/popover`; `Command`, `CommandList`,
  `CommandItem` from `@/components/ui/command`; `TriggerField`, `TriggerEntry` from `./use-trigger-field`.
- Produces:

```ts
export function TriggerFieldPopover(props: {
  field: TriggerField;
  /** The element the list anchors to — the composer form, or the automations field container. */
  children: ReactNode;
  testId?: string;          // default 'trigger-field-popover'
  className?: string;       // forwarded to PopoverContent; width/padding overrides only
  label?: string;           // default 'Suggestions'
  side?: 'top' | 'bottom';  // default 'top'
}): ReactElement;
```

- [ ] **Step 1: Wrap the anchor**

```tsx
<Popover open={field.open} onOpenChange={(next) => { if (!next) field.close(); }}>
  <PopoverAnchor asChild>{children}</PopoverAnchor>
  <PopoverContent … >…</PopoverContent>
</Popover>
```

Delete the `if (!field.open) return null` early return — Radix already mounts nothing while closed, and the anchor
must render either way. `asChild` keeps the anchor from adding a DOM node that would change the composer's layout.

- [ ] **Step 2: Configure `PopoverContent`**

```tsx
<PopoverContent
  data-testid={testId}
  side={side}
  align="start"
  sideOffset={6}
  collisionPadding={8}
  className={cn('w-(--radix-popover-trigger-width) gap-0 p-0', className)}
  onOpenAutoFocus={(e) => e.preventDefault()}
  onCloseAutoFocus={(e) => e.preventDefault()}
  onInteractOutside={(e) => {
    if ((e.target as Element | null)?.closest('[data-slot="popover-anchor"]')) e.preventDefault();
  }}
>
```

`gap-0 p-0` cancels `PopoverContent`'s `flex flex-col gap-4 p-4`; `Command` owns the inner padding. The
`onInteractOutside` guard is required, not cosmetic: without it, clicking inside the textarea to move the caret
mid-token dismisses the list, which is a behavior change from today. `data-slot="popover-anchor"` lands on the
caller's own element because `PopoverAnchor asChild` merges it there. Add a one-line comment for the guard and one for
the focus prevention (the caret must stay in the field). Do not restate `z-50`, radius, ring, shadow, or animation
classes — `PopoverContent` supplies them.

- [ ] **Step 3: Mount the Command tree with cmdk's behavior disabled**

```tsx
<Command shouldFilter={false} disablePointerSelection loop={false} value={String(field.highlightedIndex)}>
  <CommandList asChild className="max-h-[min(18rem,var(--radix-popover-content-available-height))]">
    <div
      id={field.listboxId}
      aria-label={label}
      aria-activedescendant={highlighted ? field.optionId(highlighted.id) : undefined}
    >
      {field.entries.map((entry, index) => <TriggerFieldRow … />)}
    </div>
  </CommandList>
</Command>
```

where `const highlighted = field.entries[field.highlightedIndex]`. `asChild` on `CommandList` is what keeps
`field.listboxId` on the element that carries `role="listbox"`, so the input's `aria-controls` resolves; the explicit
`aria-activedescendant` overrides cmdk's, which would otherwise point at an id no longer in the DOM (fact 4). The
`max-h` expression is the panel's own scroll cap and the viewport clamp in one place, so a long list scrolls inside
the panel instead of growing past the screen. Add a comment recording *why* `shouldFilter`/`disablePointerSelection`
are off: the engine filters against a token cmdk cannot see, and it owns the highlight.

- [ ] **Step 4: Rebuild the row on `CommandItem asChild`**

Keep `TriggerFieldRow`'s existing signature and its whole test-id / glyph derivation (`itemTestId` →
`<prefix>-<id>` fallback, `<prefix>-category-<id>` for categories, `itemGlyph` only for items). Render:

```tsx
<CommandItem asChild value={String(index)}>
  <button
    type="button"
    id={field.optionId(entry.id)}
    data-testid={testId}
    data-highlighted={highlighted ? '' : undefined}
    className="flex w-full min-w-0 items-center gap-1.5 text-left"
    onMouseDown={(e) => e.preventDefault()}
    onMouseMove={() => field.highlightIndex(index)}
    onClick={() => field.selectEntry(entry)}
  >
    {glyph}
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="truncate text-sm font-medium text-foreground">{entry.label}</span>
      {isItem && entry.description != null && (
        <span className="max-w-full truncate text-xs text-muted-foreground">{entry.description}</span>
      )}
    </span>
  </button>
</CommandItem>
```

Rules for this step:

- Pass **no** `onSelect`. cmdk fires `onSelect` from its own composed click handler; our `onClick` is the single
  selection path, and adding `onSelect` would insert twice.
- `value={String(index)}` (not the entry id) guarantees uniqueness and lines up exactly with `highlightedIndex`, so
  cmdk's `data-selected` and our `data-highlighted` always name the same row.
- Keep `data-highlighted` with a one-line comment: it mirrors cmdk's `data-selected` for the engine's own tests;
  cmdk's attribute is the styling hook.
- Drop the row's `role`, `aria-selected`, `rounded-md px-2 py-1.5 text-sm`, and `data-[highlighted]:bg-muted` — cmdk's
  `Item` supplies `role="option"` and `aria-selected`, and the `CommandItem` recipe supplies the padding, radius, and
  `data-selected:bg-muted` fill. Explicit `text-sm` / `text-xs` stay on the label and description nodes.
- `onMouseDown` preventDefault stays: it is what keeps the caret alive through a click.
- Keep the label truncating inside a `min-w-0` parent so a long skill name does not blow out the panel.

- [ ] **Step 5: Verify** `pnpm --filter @qlan-ro/mainframe-ui typecheck` and confirm the file is under 300 lines
  (`wc -l`).

### Task 5: Anchor the composer's list to the composer

**Files:**

- Modify: `packages/ui/src/features/chat/composer/triggers/ComposerTriggers.tsx`

- [ ] **Step 1: Wrap `children` in the popover**

```tsx
<ComposerPrimitive.Unstable_TriggerPopoverRoot>
  <ComposerInputPluginBridge field={field} />
  <TriggerFieldPopover field={field} testId="composer-trigger-popover">
    {children}
  </TriggerFieldPopover>
</ComposerPrimitive.Unstable_TriggerPopoverRoot>
```

`Unstable_TriggerPopoverRoot` stays mounted — it is the only public mounter of the composer-input plugin registry that
routes keys and cursor position from the native input. `side`, `align`, and width take the component defaults
(`side="top"`, `align="start"`, composer width). Pass no `className`.

- [ ] **Step 2: Update the file-header comment** to say the list is portalled and anchored to the composer, replacing
  any wording that implies it renders as a composer sibling.
- [ ] **Step 3: Verify** `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task 6: Keep the automations field rendering as it does today

**Files:**

- Modify: `packages/ui/src/features/automations/fields/TriggerTextField.tsx`

- [ ] **Step 1: Wrap the field container** — the existing `<div data-testid={`${testId}-container`} …>` becomes the
  popover's child, so the container keeps its `relative` class and its `minHeight` style and `VariablePickerButton`
  keeps its absolute position inside it.
- [ ] **Step 2: Pass the two per-consumer knobs**: `side="bottom"` (today's `top-full mt-1`) and `className="w-80"`
  (today's base width, so the rendered result stays equivalent instead of widening to the form column). Delete the old
  `className="absolute left-0 top-full mt-1"`. Add a one-line comment on `w-80` recording that it preserves the
  field's current width.
- [ ] **Step 3: Verify** `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task 7: Update the existing suites to the new component shape

These are structural harness edits, not selector edits — every `data-testid` assertion stays byte-identical.

**Files:**

- Modify: `packages/ui/src/components/trigger-engine/__tests__/TriggerFieldPopover.test.tsx`
- Modify: `packages/ui/src/components/trigger-engine/__tests__/use-trigger-field.test.tsx`
- Modify: `packages/ui/src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx`

- [ ] **Step 1: `TriggerFieldPopover.test.tsx`** — add `close: () => undefined` to the `makeField` fixture, and give
  every `render(<TriggerFieldPopover field={…} />)` a child anchor: `<TriggerFieldPopover field={…}><div /></…>`.
  Change nothing else; all sixteen test-id and `textContent` assertions must stay exactly as written.
- [ ] **Step 2: `use-trigger-field.test.tsx`** — in the `Field` harness, replace the fragment
  `<><textarea …/><TriggerFieldPopover …/></>` with `<TriggerFieldPopover field={field} testId="composer-trigger-popover"><div><textarea …/></div></TriggerFieldPopover>`.
  A wrapping `<div>` is needed because `PopoverAnchor asChild` merges onto one element and the textarea must keep its
  own props. Assertions are untouched, including the `data-highlighted` checks and the two `aria-activedescendant`
  checks — those pin the ARIA contract through the portal and are the reason for `CommandList asChild`.
- [ ] **Step 3: `ComposerTriggers.test.tsx`** — no harness change is required (the popover is rendered by
  `ComposerTriggers` itself). Run it; if the popover's move to a portal breaks a query, fix the query to use `screen`
  (which searches `document.body`) rather than a container-scoped query. Do not change any test id.
- [ ] **Step 4: Run all four suites individually**

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/trigger-engine/__tests__/TriggerFieldPopover.test.tsx
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/trigger-engine/__tests__/use-trigger-field.test.tsx
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/trigger-engine/__tests__/trigger-popover-placement.test.tsx
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/fields/__tests__/TriggerTextField.test.tsx
```

All green, including the two placement tests that were red in Task 1. Run them one file at a time — large multi-suite
runs in this package hit cross-file `React.act` failures.

- [ ] **Step 5: If a Radix or cmdk primitive needs a DOM API jsdom lacks**, add the stub to
  `packages/ui/src/__tests__/setup.ts` next to the existing `ResizeObserver` / pointer-capture stubs, with a comment
  naming the primitive that needs it. Do not weaken an assertion to route around a missing stub.

### Task 8: Changeset

**Files:**

- Create: `.changeset/<generated-name>.md`

- [ ] **Step 1:** `pnpm changeset` — select `@qlan-ro/mainframe-ui`, bump `patch`.
- [ ] **Step 2:** Summary line, plain and specific: "The composer's `@` and `/` suggestion list floats above the
  thread instead of growing the composer." No emoji, no puffery.

---

## Group 3 — Verification

### Task 9: Static gates

- [ ] **Step 1:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` (it includes test files).
- [ ] **Step 2:** `pnpm --filter @qlan-ro/mainframe-ui lint`.
- [ ] **Step 3:** `wc -l` on `TriggerFieldPopover.tsx`, `ComposerTriggers.tsx`, `TriggerTextField.tsx`,
  `command.tsx` — each under 300, no function over 50.

### Task 10: Measured non-displacement in the running app

The acceptance criterion is a measurement, not an impression. Do not settle it by eye.

- [ ] **Step 1: Launch isolated.** From `packages/app-tauri`, run `pnpm tauri:dev` in the background with output to a
  log file and **both** `DAEMON_PORT` and `MAINFRAME_DATA_DIR` set to non-default values. Launching without that
  isolation hijacks port 31415 and the real `~/.mainframe`, taking over the production app.
- [ ] **Step 2: Measure.** With a thread that has enough messages to scroll, record
  `document.querySelector('[data-testid="chat-composer"]').getBoundingClientRect().height` and the thread viewport's
  `scrollTop` before typing `@`, immediately after the list opens, after typing three more characters (result set
  shrinks), and after `Escape`. Composer height must be identical at all four points and `scrollTop` must not move.
  Repeat for `/`.
- [ ] **Step 3: Walk the state matrix.** Items only; categories + items (`@` with no query); highlighted row via
  keyboard and via hover resolving to the same visual; a long label and a long description (both truncate); overflow
  (many entries scroll inside the panel, panel never exceeds the viewport); a multi-line draft moving the anchor (list
  stays attached, still opens upward, never overlaps the composer); little room above (Radix flips or shifts rather
  than truncating); narrow window; compact UI scale (0.92); light and dark; one non-`glass` window style.
- [ ] **Step 4: Walk the interaction matrix.** Arrow Up/Down wrap; Enter and Tab insert; Shift+Enter still inserts a
  newline; Escape dismisses and leaves the draft text and caret untouched; Backspace on an empty query leaves a
  category; hover highlights; click inserts with the caret at the right offset; the composer keeps focus throughout
  (`document.activeElement` is the textarea while the list is open); clicking outside dismisses. Expect the known
  #316 failure on the `@` toolbar button: clicking `composer-add-mention` appends `@` **and submits the composer**,
  because the shared `Button` sets no `type` and a bare `<button>` inside `ComposerPrimitive.Root`'s `<form>` defaults
  to `type="submit"`. That is out of scope here (D8) and is not a regression of this work — record it and move on.
- [ ] **Step 5: Check the automations consumer for regressions** — open an automation step's prompt field, type `$`,
  `/`, and `@`, and confirm the list still opens downward at its current width with the same rows.
- [ ] **Step 6: Dispatch `design-conformance`** against the composer artboards rather than eyeballing the chrome.

### Task 11: End-to-end, once

- [ ] **Step 1:** `pnpm test:e2e` scoped to `packages/e2e/tests-tauri/composer-advanced.spec.ts`. Expect the `@`
  mention describe (open, pick file, drill into a directory, Escape) and the `/` skills describe to pass with no edit
  to their selectors — `composer-trigger-popover`, `composer-file-item-*`, and `composer-skill-item-*` are unchanged,
  and `toHaveCount(0)` still holds on close because Playwright retries past the exit animation.
- [ ] **Step 2:** If a spec fails, fix the product code — do not relax the spec or add a `TODO(bug)` skip.

---

## Risks

- **Two nested `asChild` layers over a minified dependency.** `CommandList asChild` and `CommandItem asChild` are the
  mechanism that keeps our ids on the DOM (facts 4-5). Verified by reading the installed dist and Radix's
  `mergeProps`, and pinned by the existing `aria-activedescendant` and `data-highlighted` assertions in
  `use-trigger-field.test.tsx`. If it does not hold at runtime, the fallback is the brief's own escape hatch: keep the
  `Popover` portal and anchor (which is the actual bug fix) and render the rows with the `CommandItem` class recipe
  applied directly to our own markup. Say so in the PR; do not ship two owners of the option ids.
- **Radix dismissal versus the caret.** The `onInteractOutside` containment guard and both auto-focus preventions are
  the whole of the "never steals focus, never disturbs the draft" contract. Task 10 Step 4 is what proves it.
- **cmdk's controlled `value` and index-keyed rows.** If the highlight ever renders on two rows or none, the cause is
  a duplicate or stale `value`; `String(index)` is chosen precisely to make that impossible.
