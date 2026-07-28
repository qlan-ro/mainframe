# Todo #288 — warn before a mid-session model / effort / feature change

**Branch:** `todo/288-effort-model-switch-warning` · **Route:** no-spec (plan works from the approved brief)
**Package:** `@qlan-ro/mainframe-ui` only. No daemon, no Rust, no `packages/mobile`.

## Goal

Changing the model, the reasoning effort, or a tuning feature on a chat that already has at least one
message must open a modal confirm before anything reaches the daemon. Confirming sends exactly the PATCH
the control sends today; cancelling sends nothing and leaves the control on the daemon-authoritative
value. A chat with no messages — including the `__LOCALID_*` draft — behaves exactly as it does now, as
does a no-op re-pick of the current value. The dialog names the concrete change ("Sonnet 4.5 → Opus 5"),
explains in one hedged sentence that the session's cached context is discarded and the next message
re-sends the conversation as new input, quotes the approximate size when the CLI-reported context usage
is known, and carries a "Don't warn again" checkbox that persists in the existing client-preference
store. Alongside this the model picker gains the mid-turn inertness the effort and features controls
already have, so no control can reach a running CLI mid-answer.

## Verified starting state

Read before planning; every path below exists on the branch.

| Fact | Where |
|---|---|
| `useComposerTuning` is the **only** mid-session write seam — `setChatTuning` / `setChatConfig` are called nowhere else outside `new-thread-coordinator.ts` (first-send creation, zero messages) | `packages/ui/src/features/chat/composer/config-toolbar/use-composer-tuning.ts:163,179,190` |
| The hook has exactly one consumer | `packages/ui/src/features/chat/composer/config-toolbar/ComposerToolbar.tsx` |
| Config is server-authoritative, no optimistic UI — a cancelled change needs no rollback, only "don't send" | `use-composer-tuning.ts` header + `packages/ui/CLAUDE.md` (judo-B) |
| Draft mode short-circuits every setter to `patchDraftConfig` before the live path | `use-composer-tuning.ts:157,171,199` |
| `disabled` = live `isRunning` from `useAuiState`; `EffortPicker` and `FeaturesPopover` consume it, `ProviderModelSelect` does **not** | `ComposerToolbar.tsx:33,60-77` |
| `hasMessages` is computed in the toolbar and passed as `locked` to the provider row | `ComposerToolbar.tsx:42,54` |
| `ConfirmDialog` renders title → optional body → `DialogFooter`, testid-prefixed cancel/confirm | `packages/ui/src/components/ui/confirm-dialog.tsx` (55 lines) |
| `Checkbox` and `Label` primitives exist and pass props through | `packages/ui/src/components/ui/{checkbox,label}.tsx` |
| `useUiPrefs` persists to `mf:ui-prefs`, `version: 1`, explicit `partialize`; `rightClickHintDismissed` is the one-time-suppression precedent | `packages/ui/src/store/ui-prefs.ts` |
| CLI-reported usage lives at `extras.state.contextUsage` (`{percentage,totalTokens,maxTokens} | null`) | `packages/ui/src/features/chat/controller/chat-thread-state.ts:82` |
| Effective (inherited) current values come from `displayEffort` / `effectiveFeature`; label maps are `EFFORT_META` / `FEATURE_LABELS` | `packages/ui/src/lib/model-tuning.ts` |
| Radix DropdownMenu **and** Popover both open under `userEvent.click` in this suite — the pointer-capture stubs are in the global setup | `packages/ui/src/__tests__/setup.ts:100-112`; `SessionsMoreMenu.test.tsx`, `ProviderModelSelect.test.tsx` |
| A thread switch does **not** remount the composer — every link in the chain is rendered unkeyed, so switching flips the assistant-ui runtime's `mainThreadId` and React reconciles the same instances | `layout/SurfaceHost.tsx:27` → `features/sessions/new-thread/ChatSurface.tsx:135-142` → `features/chat/thread/ChatThread.tsx:124` |
| `packages/ui/tsconfig.json` has `"include": ["src"]`, so `tsc --noEmit` typechecks the test files too | `packages/ui/tsconfig.json` |
| `.test.ts` runs in the **node** project; DOM-touching logic tests opt in with `// @vitest-environment jsdom` | `packages/ui/vitest.config.ts` |
| No token formatter exists anywhere in `packages/ui` | grepped `formatTokens`, `contextUsage` consumers |

## Decisions taken while planning

- **D1 — `useProviderDefaults` moves to its own file.** `use-composer-tuning.ts` is 264 lines and the guard
  wiring would push it past the 300-line limit. Task 9 lifts `useProviderDefaults` verbatim into
  `use-provider-defaults.ts` and re-exports it from `use-composer-tuning.ts`, so the existing test import
  (`import { useProviderDefaults } from '../use-composer-tuning'`) keeps working. No behavior change.
- **D2 — the guard lives inside `useComposerTuning`, not in the toolbar.** The brief names this seam, and the
  hook has a single consumer, so a guarded setter cannot be bypassed. The toolbar only mounts the dialog.
- **D3 — the "from" value the dialog shows is the *effective* value** (`displayEffort` / `effectiveFeature`),
  because that is what the control displays. A pick that equals the effective value is a no-op for the
  warning but still fires its PATCH, exactly as today — the warning changes no write behavior.
- **D4 — feature copy.** The brief's design gives explicit sentences for model and effort but not for the
  boolean features. The title already names the feature, so the body opens `Off → On.` / `On → Off.`
- **D5 — mid-turn hint via a local wrapper, not a `Hint` prop.** The three triggers carry
  `disabled:pointer-events-none`, so a tooltip on the disabled button itself never fires. Task 12 adds a
  local `RunningHint` that wraps the *whole* control in a `Hint` + `<span className="inline-flex">` only
  while running (matching the `app-tauri-hint-tooltip-primitive` rule that `Hint` wraps popover/dropdown
  triggers rather than sitting inside them). Enabled controls render exactly as today — no extra span, no
  nested tooltip.
- **D6 — no `version` bump on `mf:ui-prefs`.** A new boolean defaulting to `false` needs no migration:
  zustand's default shallow merge fills the missing key from the initial state. `partialize` gains the key.
- **D7 — the suppression preference commits on confirm only.** Checking the box and then cancelling writes
  nothing, so the checkbox is never a trapdoor.
- **D8 — four pre-existing functions over the 50-line limit are grandfathered; the gate covers new code.**
  Every function this plan touches in an existing file already violates the repo's 50-line rule, measured on
  the branch:

  | Function | Lines | This plan adds |
  |---|---|---|
  | `useComposerTuning` (`use-composer-tuning.ts:109-264`) | ~155 | Task 13: a `hasMessages` selector, the warning-hook call, three guard wrappers |
  | `ProviderModelSelect` (`ProviderModelSelect.tsx:125-221`) | ~96 | Task 15: a `disabled` prop and a `RunningHint` wrapper |
  | `EffortPicker` (`EffortPicker.tsx:32-96`) | ~64 | Task 15: a `RunningHint` wrapper |
  | `FeaturesPopover` (`FeaturesPopover.tsx:57-114`) | ~57 | Task 15: a `RunningHint` wrapper |

  D1 only lifts `useProviderDefaults` *out of the file*; it does not shorten `useComposerTuning`'s own body.
  Bringing all four under 50 means decomposing three popover components and a 155-line hook — a refactor
  several times the size of this todo, on code no acceptance criterion asks us to change, with no test
  coverage of the intermediate states. Splitting a hook that returns seven memoized setters into
  sub-50-line pieces also produces artificial seams, not better code.

  So: the four keep their existing size, and **Task 18's gate is narrowed to functions this plan creates**
  (all of which are small by construction) plus the unchanged 300-lines-per-file rule, which does bind and
  is enforced on every touched file. This is a scope call, not a licence — an operator who wants the
  decomposition should schedule it as its own todo, where it can be reviewed on its own merits.

## Out of scope (restated so no task drifts)

Daemon behavior, adapter protocol, respawn/restart; measuring or displaying cache hits or re-billed
tokens; permission-mode, plan-mode, worktree and the provider (agent) lock; provider-defaults inheritance
and the Settings > Providers pane; `packages/mobile`; any new route or WS message.

---

## Architecture

Six new source files, seven edited, all in `packages/ui` — plus four new and four edited test files.
(`use-tuning-setters.ts` is a seventh new source file only if R2's measured trigger fires.)

```
features/chat/composer/config-toolbar/
  tuning-warning.ts          NEW  pure: types, resolveTuningChange, shouldWarnTuningChange
  tuning-warning-copy.ts     NEW  pure: describeTuningChange, formatApproxTokens
  use-tuning-warning.ts      NEW  hook: pending state, suppress checkbox, guard/confirm/cancel
  TuningWarningDialog.tsx    NEW  prop-driven ConfirmDialog wrapper
  RunningHint.tsx            NEW  wraps a control in the "working" hint while a turn runs
  use-provider-defaults.ts   NEW  D1 extraction (verbatim move)
  use-composer-tuning.ts     EDIT guard the three live setters; expose hasMessages + tuningWarning
  ComposerToolbar.tsx        EDIT mount the dialog; pass `disabled` to the model picker
  ProviderModelSelect.tsx    EDIT accept `disabled`; RunningHint
  EffortPicker.tsx           EDIT RunningHint
  FeaturesPopover.tsx        EDIT RunningHint
components/ui/confirm-dialog.tsx  EDIT optional `suppress` checkbox row
store/ui-prefs.ts                 EDIT dontWarnOnTuningChange + dismissTuningChangeWarning

tests
  config-toolbar/__tests__/tuning-warning.test.ts                  NEW  T1
  config-toolbar/__tests__/tuning-warning-copy.test.ts             NEW  T3
  components/ui/__tests__/confirm-dialog.test.tsx                  NEW  T7
  config-toolbar/__tests__/ComposerToolbar.tuning-warning.test.tsx NEW  T16
  store/__tests__/ui-prefs.test.ts                                 EDIT T5
  config-toolbar/__tests__/ComposerToolbar.test.tsx                EDIT T14 (widen the hook mocks)
  config-toolbar/__tests__/ProviderModelSelect.test.tsx            EDIT T15 (`disabled` in renderSelect) + T17 (cases)
  composer/__tests__/composer-states.test.tsx                      EDIT T15 (`disabled={false}`)
```

Data flow: control → `setEffort/setFeature/setModel` → (draft? patchDraftConfig, unchanged) →
`tuningWarning.guard(request, apply)` → `resolveTuningChange` + `shouldWarnTuningChange` → either
`apply()` now, or park `{change, apply, originChatId}` in state → `TuningWarningDialog` → confirm re-checks
the origin chat, then runs the *same* `apply` closure (one PATCH, identical payload) / cancel drops it /
a thread switch drops it.

### Contracts the tasks must implement exactly

```ts
// tuning-warning.ts
export type TuningChangeRequest =
  | { kind: 'model'; to: string }
  | { kind: 'effort'; to: EffortLevel }
  | { kind: 'feature'; key: FeatureKey; to: boolean };

export type TuningChange =
  | { kind: 'model'; from: string | null; to: string; fromLabel: string; toLabel: string }
  | { kind: 'effort'; from: EffortLevel; to: EffortLevel; fromLabel: string; toLabel: string }
  | { kind: 'feature'; key: FeatureKey; from: boolean; to: boolean; featureLabel: string };

export interface TuningWarningContext {
  chat: Chat | null;
  adapter: AdapterInfo | null;
  model: AdapterModel | null;
  providerDefaults: ProviderConfig | undefined;
  hasMessages: boolean;
  contextTokens: number | null;
}

export function resolveTuningChange(ctx: TuningWarningContext, req: TuningChangeRequest): TuningChange | null;
export function shouldWarnTuningChange(args: {
  change: TuningChange; hasMessages: boolean; suppressed: boolean;
}): boolean;

// tuning-warning-copy.ts
export function formatApproxTokens(totalTokens: number | null): string | null;
export function describeTuningChange(
  change: TuningChange, contextTokens: number | null,
): { title: string; body: string; confirmLabel: string };
```

---

## Verification gates — read before the tasks

Two levels, and the difference matters.

- **Per task:** the named test file(s), run individually
  (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <path>`) — never the whole suite. A red-phase task
  verifies that its file fails *for the stated reason*.
- **Per dependency wave, once, after every group in that wave has landed:**
  `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

Typecheck is a *wave* gate — never a per-task one, never a per-group one — and a wave made only of
red-phase test groups skips it. `packages/ui/tsconfig.json` sets `"include": ["src"]` and the tests live
under `src/`, so `tsc --noEmit` compiles every test file in the tree, not just the ones a group touched.
Three consequences:

- A task that widens a prop or a hook's return type leaves the stale call sites red until its sibling task
  patches them — a legitimate mid-group state. Demanding a clean typecheck after each task makes the gate
  unreachable and the declared graph cyclic.
- Sibling implementation groups hit the same problem one level up. `tuning-decision-modules`,
  `ui-prefs-suppression` and `confirm-dialog-suppress` run in one wave, and each compiles the other two
  groups' red tests, so whichever lands first would fail a gate of its own on work it does not own. The
  wave is the first point at which every red test in the tree has an implementation, so the wave owns the
  gate.
- A red-phase test group (Tasks 1, 3, 5, 7) is *supposed* to reference modules, actions and props that do
  not exist yet. The wave that implements them is what has to typecheck, and because `tsc` sees the whole
  `src` tree, that one run covers the test files too.

In practice the gate runs twice: at the end of the wave that lands Tasks 2, 4, 6 and 8, and at the end of
the wave containing `composer-tuning-guard`. Task 18 runs it once more as the final check.

## Tasks

### Task 1 — RED: pure decision tests

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/__tests__/tuning-warning.test.ts`
Node environment (no `@vitest-environment` pragma needed — the module imports no DOM).

Write against the Task 2 contract above; the module does not exist yet, so the file must fail to resolve.

`resolveTuningChange` cases — build the ctx from literal fixtures (a `Chat` with `effort: 'high'`,
`ultracode: false`; an `AdapterInfo` whose models are `{id:'sonnet',label:'Sonnet 4.5'}` and
`{id:'opus',label:'Opus 5'}`):
1. `{kind:'model', to:'opus'}` with `model = sonnet` → `{kind:'model', from:'sonnet', to:'opus', fromLabel:'Sonnet 4.5', toLabel:'Opus 5'}`.
2. model change where `to` is not in the catalog → `toLabel` falls back to the raw id.
3. model change where `chat.model` is null and `model` is null → `from: null`, `fromLabel: 'Current model'`.
4. `{kind:'effort', to:'max'}` with an effort-capable model → `from` is the **effective** effort from
   `displayEffort` (assert `'high'` for a chat with `effort:'high'`), `fromLabel:'High'`, `toLabel:'Maximum'`.
5. effort change on a chat with `effort: null` inheriting `providerDefaults.defaultEffort:'low'` → `from:'low'`.
6. `{kind:'feature', key:'ultracode', to:true}` → `{from:false, to:true, featureLabel:'Ultracode'}`.
7. `ctx.chat === null` → returns `null`.

`shouldWarnTuningChange` cases:
8. `hasMessages:false` → `false`, for all three kinds.
9. `suppressed:true` → `false`, for all three kinds.
10. `hasMessages:true, suppressed:false`, `from !== to` → `true`, for all three kinds.
11. no-op re-pick (`from === to`) → `false`, for all three kinds (model ids equal, effort levels equal,
    feature booleans equal).
12. model change with `from: null` and `hasMessages:true` → `true` (unresolvable "from" must not
    silently bypass the warning).

**Verify:** the file fails with a module-resolution error naming `../tuning-warning`.

### Task 2 — pure decision module

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/tuning-warning.ts`

Implement the contract. `resolveTuningChange` uses `displayEffort(chat, model, providerDefaults).value`
for the effort "from", `effectiveFeature(chat, providerDefaults, key)` for the feature "from",
`EFFORT_META[level].label` and `FEATURE_LABELS[key].label` for labels, and
`adapter?.models.find(m => m.id === id)?.label ?? id` for model labels (with the
`'Current model'` fallback when neither `model` nor `chat.model` resolves). Return `null` when
`ctx.chat == null`. `shouldWarnTuningChange` returns `false` when suppressed, `false` when
`!hasMessages`, `false` when `from === to`, else `true`.

**Verify:** `vitest run src/features/chat/composer/config-toolbar/__tests__/tuning-warning.test.ts` green;
file under 300 lines, every function under 50.

### Task 3 — RED: copy tests

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/__tests__/tuning-warning-copy.test.ts`

Assert literal strings — never re-derive them from the module under test.

`formatApproxTokens`: `48_000 → '~48k'`; `1_500 → '~2k'`; `640 → '~640'`; `0 → null`; `null → null`.

`describeTuningChange`:
1. model, `contextTokens: 48_000` →
   title `Change model for this session?`;
   body `Sonnet 4.5 → Opus 5. The session's cached context is discarded, so your next message re-sends the conversation (~48k tokens) as new input.`;
   confirmLabel `Change model`.
2. same change, `contextTokens: null` → identical body with the parenthetical removed:
   `Sonnet 4.5 → Opus 5. The session's cached context is discarded, so your next message re-sends the conversation as new input.`
   (assert there is no `(` and no `unknown` in the body).
3. effort → title `Change effort for this session?`, body starts `High → Maximum.`, confirmLabel `Change effort`.
4. feature on → title `Change Ultracode for this session?`, body starts `Off → On.`, confirmLabel `Change Ultracode`.
5. feature off → body starts `On → Off.`
6. no body ever contains `$`, `cost`, `bill`, or a cache-hit claim (guards the hedged-copy requirement).

**Verify:** fails with a module-resolution error naming `../tuning-warning-copy`.

### Task 4 — copy module

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/tuning-warning-copy.ts`

`formatApproxTokens`: `null`/`<= 0` → `null`; `>= 1000` → `` `~${Math.round(n / 1000)}k` ``; else `` `~${n}` ``.
`describeTuningChange` composes `<from> → <to>. The session's cached context is discarded, so your next
message re-sends the conversation<parenthetical> as new input.` where the parenthetical is
`` ` (${approx} tokens)` `` or `''`. Titles/confirm labels per Task 3.

**Verify:** `vitest run …/__tests__/tuning-warning-copy.test.ts` green.

### Task 5 — RED: ui-prefs suppression tests

**File (edit):** `packages/ui/src/store/__tests__/ui-prefs.test.ts`

Add `dontWarnOnTuningChange: false` to the `beforeEach` reset object, then add a describe:
1. the documented default is `false` (extend the existing defaults assertion).
2. `dismissTuningChangeWarning()` sets it to `true`.
3. after `dismissTuningChangeWarning()`, `JSON.parse(localStorage.getItem('mf:ui-prefs')!).state.dontWarnOnTuningChange === true` — the flag is persisted, not just in memory.

**Rehydration cases — write the payload, then actually re-hydrate.** The `beforeEach` at
`ui-prefs.test.ts:15-27` does `localStorage.clear()` then `useUiPrefs.setState({…defaults})`, and zustand's
persist middleware hydrates once at module import. Writing a `mf:ui-prefs` payload afterwards and reading
`useUiPrefs.getState()` only re-reads what `beforeEach` just wrote — the assertion cannot fail, and
acceptance criterion (f) ("survives a reload") would ship unverified. Nor is
`useUiPrefs.persist.rehydrate()` on the already-imported store enough for case 4: zustand's default merge is
`{...current, ...persisted}`, so a payload missing the key leaves whatever `beforeEach` set, not the
declared default. Reproduce boot instead — fresh module, fresh initial state, hydrate from storage:

```ts
async function reloadStore() {
  vi.resetModules();
  const mod = await import('../ui-prefs');
  await mod.useUiPrefs.persist.rehydrate();
  return mod.useUiPrefs;
}
```

4. **Legacy payload, key absent.** `localStorage.setItem('mf:ui-prefs', JSON.stringify({state: {bottomPanelTab: 'skills'}, version: 1}))`,
   then `const fresh = await reloadStore()`. Assert **both**: `fresh.getState().bottomPanelTab === 'skills'`
   (proves hydration ran, so the next assertion is not vacuous) and
   `fresh.getState().dontWarnOnTuningChange === false` — the declared default fills a key the payload
   predates, which is exactly D6's claim and the reason no `version` bump is needed.
5. **Persisted `true` survives a reload.** Same payload plus `dontWarnOnTuningChange: true`, then
   `reloadStore()` → `true`. This one is green even before Task 6 (the merge spreads unknown persisted keys
   through), so it is not a red case; it is the standing guard for criterion (f), and together with case 3
   it closes the round trip — the write path puts the flag in storage, the read path honors it after a reload.

Also update the **existing** `useUiPrefs persistence` case: its
`expect(Object.keys(parsed.state).sort()).toEqual([...])` pins the whitelist literally, so add
`'dontWarnOnTuningChange'` to that array. Skipping this turns Task 6 into a red test in an unrelated case.

**Verify:** cases 1-3 fail (`dismissTuningChangeWarning is not a function`) and case 4 fails on
`dontWarnOnTuningChange` reading `undefined` rather than `false`; the updated whitelist assertion fails too.
Case 5 is green from the start (see above). The `beforeEach` reset object referencing a key the store does
not declare yet is a type error until Task 6 — expected, and why typecheck gates the implementing wave,
not this one.

### Task 6 — ui-prefs suppression flag

**File (edit):** `packages/ui/src/store/ui-prefs.ts`

Add `dontWarnOnTuningChange: boolean` to `UiPrefsState` with a one-line comment saying *why* (the mid-session
tuning warning is suppressed for good once the user asks), default `false`, action
`dismissTuningChangeWarning: () => set({ dontWarnOnTuningChange: true })` next to `dismissRightClickHint`,
and the key in `partialize`. Leave `version: 1` (D6).

**Verify:** `vitest run src/store/__tests__/ui-prefs.test.ts` green.

### Task 7 — RED: ConfirmDialog suppress-row tests

**File (new):** `packages/ui/src/components/ui/__tests__/confirm-dialog.test.tsx`

Render the real `ConfirmDialog` (jsdom project — `.test.tsx`).
1. Without a `suppress` prop nothing extra renders: `queryByTestId('confirm-dialog-suppress')` is null and
   the cancel/confirm buttons are present (guards the archive-with-worktree and git confirms).
2. With `suppress={{label:"Don't warn again", checked:false, onChange}}` a checkbox with testid
   `${testid}-suppress` renders and its accessible label reads `Don't warn again`.
3. Clicking the checkbox calls `onChange(true)` exactly once; clicking it when `checked` is true calls
   `onChange(false)`.
4. A custom `testid` prop prefixes the suppress testid too (`x-suppress`).
5. Clicking confirm calls `onConfirm` and not `onCancel`; clicking cancel the reverse.

**Verify:** cases 2-4 fail against today's primitive.

### Task 8 — ConfirmDialog suppress row

**File (edit):** `packages/ui/src/components/ui/confirm-dialog.tsx`

Add the optional prop and render it between the body paragraph and `DialogFooter`:

```tsx
suppress?: { label: string; checked: boolean; onChange: (value: boolean) => void };
```

```tsx
{suppress && (
  <div className="flex items-center gap-2 pt-1">
    <Checkbox
      id={`${testid}-suppress`}
      data-testid={`${testid}-suppress`}
      checked={suppress.checked}
      onCheckedChange={(v) => suppress.onChange(v === true)}
    />
    <Label htmlFor={`${testid}-suppress`} className="text-caption text-muted-foreground font-normal">
      {suppress.label}
    </Label>
  </div>
)}
```

Compressed integer spacing (`gap-2` = 4px, `pt-1` = 2px) per the design direction; dialog chrome stays
inherited from `dialog.tsx` — do not restate `rounded-xl` / `bg-popover` / shadows.

**Verify:** `vitest run src/components/ui/__tests__/confirm-dialog.test.tsx` and
`vitest run src/components/ui/__tests__/dialog.test.tsx` both green; file stays well under 300 lines.

### Task 9 — extract `useProviderDefaults` (D1)

**Files:** new `packages/ui/src/features/chat/composer/config-toolbar/use-provider-defaults.ts`;
edit `packages/ui/src/features/chat/composer/config-toolbar/use-composer-tuning.ts`.

Move `useProviderDefaults` and its doc comment verbatim (its imports: `useEffect`, `getProviderSettings`,
`useSettingsStore`, `useChatExtras`, `ProviderConfig`). In `use-composer-tuning.ts` replace the definition
with `export { useProviderDefaults } from './use-provider-defaults';`, keep `export { useAdapters } from
'@/store/adapters';`, and drop imports that are now unused. Trim the file header comment's
`useProviderDefaults` paragraph to a one-line pointer.

**Verify:** `vitest run src/features/chat/composer/config-toolbar/__tests__/use-composer-tuning.test.ts`
green with **no test edits** (the re-export keeps the existing import path working).

### Task 10 — `useTuningWarning` hook

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/use-tuning-warning.ts`

```ts
export interface TuningWarningHook {
  pending: TuningChange | null;
  suppressChecked: boolean;
  setSuppressChecked: (value: boolean) => void;
  guard: (request: TuningChangeRequest, apply: () => void) => void;
  confirm: () => void;
  cancel: () => void;
}
export function useTuningWarning(ctx: TuningWarningContext): TuningWarningHook;
```

Implementation rules:
- `suppressed` reads `useUiPrefs((s) => s.dontWarnOnTuningChange)`.
- Keep the live `ctx` **and** `suppressed` in a ref refreshed on every render, and build `guard` with
  `useCallback` over an empty-but-for-the-ref dependency list. `guard` must have a stable identity —
  `useComposerTuning`'s setters are `useCallback`-memoized and an unstable `guard` would re-create them
  on every render.
- `guard(request, apply)`: `const change = resolveTuningChange(ctx, request)`; if `change == null` or
  `!shouldWarnTuningChange({change, hasMessages: ctx.hasMessages, suppressed})` → call `apply()` and return.
  Otherwise `setSuppressChecked(false)` and park `{ change, apply, originChatId: ctx.chat.id }` in state
  (store the triple inside an object so React never mistakes the closure for a state updater).
- **Origin-chat guard (R3).** The parked `apply` closure captured `port` and `patchChatId` at guard time,
  and `ComposerToolbar` is **not** remounted on a thread switch (verified: `layout/SurfaceHost.tsx:27` →
  `ChatSurface` → `thread/ChatThread.tsx:124` → `Composer` are all rendered unkeyed; switching threads runs
  through the assistant-ui runtime's `mainThreadId`, not a remount). Without a guard the dialog survives
  the switch and confirming PATCHes chat A while the UI shows chat B. Two defenses, both required:
  - an effect keyed on the live chat id drops the parked change when it no longer matches:
    `useEffect(() => { const live = ctx.chat?.id ?? null; setParked((p) => (p != null && p.originChatId !== live ? null : p)); setSuppressChecked(false); }, [ctx.chat?.id])` — write it so the `setSuppressChecked(false)`
    runs only on an actual drop, not on every id render;
  - `confirm()` re-checks `parked.originChatId === ctxRef.current.chat?.id` and, on a mismatch, clears the
    parked state and returns **without** calling `apply` and **without** writing the preference.
  The effect alone would be enough in React's ordering, but the `confirm()` check keeps the invariant
  readable at the only site that can issue a write.
- `confirm()`: read the parked triple; run the origin-chat check above; if `suppressChecked` call
  `useUiPrefs.getState().dismissTuningChangeWarning()`; clear the parked state; then run `apply()`
  (D7 — the preference commits only here).
- `cancel()`: clear the parked state and reset `suppressChecked`; never touch the preference; never call `apply`.
- `pending` is the parked `change` (or `null`).

**Verify:** behavior is covered by Task 16 (cases 1-4, 7-9, 11); the wave typecheck gate covers the types.

### Task 11 — `TuningWarningDialog`

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/TuningWarningDialog.tsx`

Purely prop-driven; no hooks, no store reads.

```tsx
export interface TuningWarningDialogProps {
  pending: TuningChange | null;
  contextTokens: number | null;
  suppressChecked: boolean;
  onSuppressChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}
```

Returns `null` when `pending == null`. Otherwise calls `describeTuningChange(pending, contextTokens)` and
renders `ConfirmDialog` with `open`, the title/body/confirmLabel from the copy module,
`cancelLabel="Cancel"`, **no** `destructive`, `testid="composer-tuning-warning"`, and
`suppress={{ label: "Don't warn again", checked: suppressChecked, onChange: onSuppressChange }}`.
Testids resolve to `composer-tuning-warning`, `-confirm`, `-cancel`, `-suppress`.

**Verify:** covered by Task 16 (the dialog and its testids); the wave typecheck gate covers the types.

### Task 12 — `RunningHint` (D5)

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/RunningHint.tsx`

```tsx
export const RUNNING_HINT = 'Unavailable while the assistant is working';

export function RunningHint({ active, children }: { active: boolean; children: React.ReactElement }) {
  if (!active) return children;
  return (
    <Hint label={RUNNING_HINT}>
      <span className="inline-flex">{children}</span>
    </Hint>
  );
}
```

The span exists only while running, so enabled markup is byte-for-byte what it is today. It is not
interactive, so it carries no `data-testid`.

**Verify:** covered by Task 17 (the disabled model picker renders the hint wrapper without breaking the
existing enabled-path assertions); the wave typecheck gate covers the types.

### Task 13 — guard the live setters

**File (edit):** `packages/ui/src/features/chat/composer/config-toolbar/use-composer-tuning.ts`

1. Add `const hasMessages = useAuiState((s: { thread: { messages: unknown[] } }) => s.thread.messages.length > 0);`
   next to the existing `isRunning` selector.
2. Build the warning hook after `model` / `providerDefaults` resolve:
   `const tuningWarning = useTuningWarning({ chat, adapter, model, providerDefaults, hasMessages, contextTokens: extras?.state.contextUsage?.totalTokens ?? null });`
3. In `setEffort`, `setFeature`, `setModel` **only**: leave the draft branch and the `port == null || !patchChatId`
   guard exactly as they are, then wrap the remaining body:
   `tuningWarning.guard({ kind: 'effort', to: effort }, () => { …existing body… });`
   (`{kind:'feature', key, to: on}`, `{kind:'model', to: m}` respectively). `setModel`'s live branch calls
   `patchConfig({ model: m }, 'setModel')` inside the `apply` closure. Add `tuningWarning.guard` to each
   `useCallback` dependency list.
4. Do **not** guard `setAdapter`, `setPlanMode`, `setPermissionMode`.
5. Extend `ComposerTuningHook` with `hasMessages: boolean`, `contextTokens: number | null` and
   `tuningWarning: TuningWarningHook`, and return all three. `contextTokens` is the same
   `extras?.state.contextUsage?.totalTokens ?? null` value passed into the warning hook — exposing it here
   is what lets Task 14 avoid a second `useChatExtras` call in the toolbar.
6. Update the file header comment: one line stating that the three tuning setters route through the
   mid-session warning gate.

**Verify:** `vitest run …/__tests__/use-composer-tuning.test.ts` green **without changing the assertions**
(the file's `useAuiState` mock returns `false`, so `hasMessages` is false and every existing setter test
still applies immediately). `wc -l use-composer-tuning.ts` — the projected landing size is ~255 after
Task 9's extraction; if it reads **≥ 285**, execute R2's pre-specified extraction in this same task rather
than trimming comments. Typecheck is the wave gate (Task 14 patches the call site this task's widened
`ComposerTuningHook` breaks).

### Task 14 — toolbar wiring

**File (edit):** `packages/ui/src/features/chat/composer/config-toolbar/ComposerToolbar.tsx`

- Take `hasMessages` and `tuningWarning` from `useComposerTuning` and delete the toolbar's own
  `useAuiState` messages selector (single source, no duplicate subscription).
- Pass `disabled={disabled}` to `ProviderModelSelect`.
- After the controls, render
  `<TuningWarningDialog pending={tuningWarning.pending} contextTokens={contextTokens} suppressChecked={…}
  onSuppressChange={tuningWarning.setSuppressChecked} onConfirm={tuningWarning.confirm}
  onCancel={tuningWarning.cancel} />`. Source `contextTokens` from the same hook — add
  `contextTokens: number | null` to `ComposerTuningHook` in Task 13 rather than calling `useChatExtras`
  again here.

**File (edit):** `packages/ui/src/features/chat/composer/config-toolbar/__tests__/ComposerToolbar.test.tsx`
Add `hasMessages: false`, `contextTokens: null` and a stub `tuningWarning`
(`{pending:null, suppressChecked:false, setSuppressChecked: vi.fn(), guard: vi.fn(), confirm: vi.fn(), cancel: vi.fn()}`)
to **both** `useComposerTuning` mock return objects, so the file typechecks against the widened hook type.
Keep the existing assertion unchanged.

**Verify:** `vitest run …/__tests__/ComposerToolbar.test.tsx` green.

### Task 15 — mid-turn inertness for the model picker

**File (edit):** `packages/ui/src/features/chat/composer/config-toolbar/ProviderModelSelect.tsx`

Add `disabled: boolean` to the props. On the trigger button add `disabled={disabled}` and the same
disabled classes the sibling controls use (`disabled:pointer-events-none disabled:opacity-40`). Wrap the
returned `<Popover>` in `<RunningHint active={disabled}>`. Leave the `locked` provider-row behavior and
its footer copy untouched — the provider lock and the running lock are different rules.

**Files (edit):** `EffortPicker.tsx`, `FeaturesPopover.tsx` — wrap the returned `<DropdownMenu>` /
`<Popover>` in `<RunningHint active={disabled}>` (the `disabled` **prop**, i.e. the running flag, not
`isDisabled`, so the Ultracode lock keeps its own "Effort locked by Ultracode" tooltip).

`ProviderModelSelect` has exactly **two** stale call sites outside `ComposerToolbar.tsx`, and this task
fixes **both** — leaving either one for a later task would strand the group's typecheck gate:

**File (edit):** `packages/ui/src/features/chat/composer/__tests__/composer-states.test.tsx` — its
`openPopover` helper renders `ProviderModelSelect` directly (line ~162). Add `disabled={false}` to that
render, change nothing else: both footer assertions must keep passing untouched.

**File (edit):** `packages/ui/src/features/chat/composer/config-toolbar/__tests__/ProviderModelSelect.test.tsx` —
its `renderSelect` helper renders the component at line ~121. Add `disabled?: boolean` to the local
`RenderProps` interface (line ~99), `const disabled = props.disabled ?? false;` beside the other prop
defaults, and `disabled={disabled}` to the render call. No existing case passes the prop, so every one of
them keeps its current behavior; Task 17 is what starts exercising it.

**Verify:** `vitest run src/features/chat/composer/__tests__/composer-states.test.tsx` and
`vitest run …/config-toolbar/__tests__/ProviderModelSelect.test.tsx` both green with no assertion changes.

### Task 16 — integration tests: confirm applies, cancel does not

**File (new):** `packages/ui/src/features/chat/composer/config-toolbar/__tests__/ComposerToolbar.tuning-warning.test.tsx`

Render the **real** `ComposerToolbar`, the real `useComposerTuning`, the real `useTuningWarning` and the
real dialog inside a `TooltipProvider`. Mock only the edges:

- `@assistant-ui/react` → `useAuiState: (selector) => selector(fakeAuiState)` where `fakeAuiState` is a
  mutable module-level `{ thread: { isRunning: false, messages: [...] } }`. A selector-executing stub is
  mandatory: the tree reads `isRunning` and `messages.length` through the same hook.
- `../../../runtime/use-chat-thread-runtime` → `useChatExtras` reading a **mutable module-level**
  `{ state: { chatId, chatConfig, contextUsage }, port }` (same shape as `fakeAuiState`). `chatConfig.id`
  must be the chat id, not a placeholder — case 11 swaps the whole object to a second chat and re-renders.
- `@/lib/api/chats` → `setChatTuning` / `setChatConfig` spies.
- `@/lib/api/settings` → `getProviderSettings` resolving `{}`.
- `@/lib/api/git`, `@/lib/api/adapters`, `@/features/sessions/runtime/daemon-port-context`,
  `@/features/sessions/runtime/draft-config` → the same stubs `ComposerToolbar.test.tsx` already uses.
- `../use-composer-tuning` must **not** be mocked, but `useAdapters` reads `@/store/adapters`; seed that
  store in `beforeEach` with
  `useAdaptersStore.setState({ byId: { claude: ADAPTER_CLAUDE } })` — direct `setState`, not
  `seedAdapters`, so no `modelsRevision` only-if-newer rule can drop the fixture between tests. The
  fixture adapter carries `sonnet` / `opus` models with `supportedEfforts: ['high','max']` and
  `supportsUltracode: true`.

Reset `useUiPrefs` (`dontWarnOnTuningChange: false`) and `localStorage` in `beforeEach`.

Cases — assert against literal testids and payloads:
1. **Model, has messages, confirm.** `messages: [msg]`. Open `composer-model-select`, click
   `composer-model-select-option-opus`. Assert `setChatConfig` **not** called and
   `composer-tuning-warning` is in the document. Click `composer-tuning-warning-confirm` →
   `setChatConfig` called exactly once with `(port, chatId, { model: 'opus' })`, and the dialog is gone.
2. **Model, cancel.** Same up to the dialog, then click `composer-tuning-warning-cancel` →
   `setChatConfig` never called, dialog gone, and the trigger `composer-model-select` still shows the
   previous model's label (daemon-authoritative value unchanged).
3. **Effort, confirm.** Open `composer-effort-select`, choose `composer-effort-select-option-max` → no
   `setChatTuning` until confirm; after confirm exactly one call with `(port, chatId, { effort: 'max' })`.
4. **Effort, cancel** → `setChatTuning` never called.
5. **No messages.** `messages: []` → picking a model calls `setChatConfig` immediately and
   `composer-tuning-warning` never renders. Repeat for effort.
6. **No-op re-pick.** With messages, re-pick the currently selected effort → no dialog (the PATCH
   behavior is whatever it is today; assert only the dialog's absence).
7. **Suppression already set.** `useUiPrefs.setState({ dontWarnOnTuningChange: true })` → model pick
   applies immediately, no dialog.
8. **Suppress + confirm.** With messages, open the dialog, click `composer-tuning-warning-suppress`, click
   confirm → the PATCH fires once **and** `useUiPrefs.getState().dontWarnOnTuningChange === true` and the
   persisted `mf:ui-prefs` payload carries it. A second pick then applies with no dialog.
9. **Suppress + cancel writes nothing.** Check the box, cancel → `dontWarnOnTuningChange` is still `false`.
10. **Body carries the context size.** With `contextUsage: {percentage: 5, totalTokens: 48_000, maxTokens: 1_000_000}`
    the dialog body contains `(~48k tokens)`; with `contextUsage: null` the body contains
    `re-sends the conversation as new input` and no `(`.
11. **Thread switch drops the pending change (R3).** Open the model dialog on chat A (`chatId: 'chat-a'`,
    `chatConfig: {…, id: 'chat-a'}`). Then mutate the `useChatExtras` fake to chat B
    (`chatId: 'chat-b'`, `chatConfig: {…, id: 'chat-b'}`) and `rerender(<ComposerToolbar />)` inside `act`
    — do **not** unmount, since the real tree does not remount on a thread switch. Assert
    `composer-tuning-warning` is gone and `setChatConfig` was never called. Then pick a model on chat B and
    confirm → exactly one `setChatConfig` call, with `'chat-b'`, never `'chat-a'`.

**Verify:** `vitest run …/__tests__/ComposerToolbar.tuning-warning.test.tsx` green.

### Task 17 — mid-turn inertness tests

**File (edit):** `packages/ui/src/features/chat/composer/config-toolbar/__tests__/ProviderModelSelect.test.tsx`

Task 15 already taught `renderSelect` the `disabled` prop (defaulting to `false`), so this task adds
only cases:
1. `renderSelect({ disabled: true })` → the `composer-model-select` trigger has the `disabled` attribute.
2. `renderSelect({ disabled: true })` → clicking the trigger does not open the popover
   (`queryByTestId('composer-provider-model-popover')` stays null) and `setModel` is never called.
3. `renderSelect({})` (the default `disabled: false`) → the trigger is not disabled and the popover still
   opens (regression guard).

**Verify:** `vitest run …/__tests__/ProviderModelSelect.test.tsx` green.

### Task 18 — changeset and final verification

**File (new):** `.changeset/<generated>.md` — `@qlan-ro/mainframe-ui` **minor**, one sentence:
"Warn before a model, effort, or tuning-feature change is applied to a session that already has history,
with a 'Don't warn again' option."

**Verify, all from the repo root of the worktree:**
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- each touched test file run individually (never the whole suite):
  `tuning-warning.test.ts`, `tuning-warning-copy.test.ts`, `ui-prefs.test.ts`, `confirm-dialog.test.tsx`,
  `dialog.test.tsx`, `use-composer-tuning.test.ts`, `ComposerToolbar.test.tsx`,
  `ComposerToolbar.tuning-warning.test.tsx`, `ProviderModelSelect.test.tsx`, `composer-states.test.tsx`
- `wc -l` on every touched file: all under 300 — this one binds without exception.
- every function **this plan creates** under 50 lines: `resolveTuningChange`, `shouldWarnTuningChange`,
  `formatApproxTokens`, `describeTuningChange`, `useTuningWarning`, `TuningWarningDialog`, `RunningHint`
  (plus `useTuningSetters` if R2 fired). The four pre-existing over-limit functions listed in D8 are
  grandfathered; confirm they gained only the lines D8 names, and nothing else.

---

## Acceptance-criteria trace

| Brief criterion | Covered by |
|---|---|
| Warning on model/effort/feature with ≥1 message, no network call before confirm | T13 + T16 cases 1, 3 |
| Cancel leaves config and control value unchanged | T16 cases 2, 4 |
| Confirm sends the identical single PATCH | T16 cases 1, 3 (`toHaveBeenCalledExactlyOnceWith`) |
| No dialog on a chat with no messages, incl. the draft path | T13 (draft branch untouched, before the guard) + T16 case 5 + T1 case 8 |
| No-op re-pick never warns | T1 case 11 + T16 case 6 |
| "Don't warn again" applies to all three controls and survives a reload | T6, T7/T8, T16 cases 7-9 |
| Model picker inert while running | T15 + T17 |
| Copy names before → after, includes the size when known, omits it cleanly when null | T3 + T16 case 10 |
| `data-testid` on every added interactive element, kebab-case, domain-keyed | T8 (`-suppress`), T11 (dialog family) |
| Unit tests for the pure decision; component tests for confirm/cancel on model and effort | T1/T3, T16 |
| No new daemon route or WS message | Nothing in this plan touches `packages/core-rs` or `lib/api` |
| Design-system compliance, reuse the confirm-dialog recipe | T8, T11 (no new primitive, compressed spacing) |
| Files < 300 lines, typecheck, changeset | T9 (D1), R2's measured trigger in T13, T18 |
| Functions < 50 | T18, narrowed to newly created functions per D8 (four pre-existing violations grandfathered) |
| A parked change never PATCHes the chat the user left (not a brief criterion — a defect R3 exposed) | T10's origin-chat guard + T16 case 11 |

## Risks

- **R1 — `useAuiState` mocking.** Any new test that renders the real toolbar must stub `useAuiState` as a
  selector-executing function; the older files' `mockReturnValue(false)` shortcut would make
  `messages.length` throw. Task 16 states this explicitly.
- **R2 — file-size pressure on `use-composer-tuning.ts`.** The file is 264 lines today. D1 removes ~27
  (`useProviderDefaults`, its doc block, its now-dead imports, minus the re-export line); Task 13 adds ~20.
  Projected landing size ~255 — under 300, but with only ~45 lines of headroom, so Task 13 measures it
  rather than assuming. **Trigger: `wc -l` ≥ 285.** The response is pre-specified, so it is never a
  judgment call at implementation time: move the three guarded setters into a new `use-tuning-setters.ts`
  exporting
  `useTuningSetters({draftMode, chatId, patchChatId, port, patchConfig, guard}) → {setEffort, setFeature, setModel}`.
  `patchConfig`, `setAdapter`, `setPlanMode` and `setPermissionMode` stay in `use-composer-tuning.ts` —
  `patchConfig` is shared, and the other three are outside the warning's remit (Task 13 step 4).
  `__tests__/use-composer-tuning.test.ts` imports only `useComposerTuning` and `useProviderDefaults`
  (line 73) and drives the setters through the hook, so the move needs no test edits. Never trim comments
  to fit.
- **R3 — the parked `apply` closure captures `port` / `patchChatId` at guard time, and a thread switch does
  NOT unmount the toolbar.** Capturing at guard time is intended — the user confirms the change they saw.
  What is *not* safe is assuming the dialog dies with the thread: `layout/SurfaceHost.tsx:27` renders
  `<ChatSurface>` unkeyed, `ChatSurface` renders `<ChatThread>` unkeyed, and `thread/ChatThread.tsx:124`
  renders `<Composer>` unkeyed. Thread switching flips the assistant-ui runtime's `mainThreadId`; React
  reconciles the same component instances, so `useTuningWarning`'s parked state survives. Open the dialog on
  chat A, switch to chat B, confirm → the `apply` closure would PATCH chat A's `patchChatId` while the UI
  shows chat B. Task 10's origin-chat guard drops the pending change on the switch; Task 16 case 11 is the
  regression test. Any future refactor that moves the parked state must carry the origin id with it.
