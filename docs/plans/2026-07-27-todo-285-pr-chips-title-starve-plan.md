# Implementation plan — cap the session row's PR chips so they can't starve the title (#285)

**Brief (the contract):** todo #285, `## Agent Brief` (route `no-spec`; project `rgoM5ZldH0UeeOonms6PK`). Its Decisions section is settled; this plan implements it and does not reopen it.
**Worktree:** `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-285-pr-chips-title-starve`, branch `todo/285-pr-chips-title-starve`. Every path below is relative to the worktree root.
**Package:** `@qlan-ro/mainframe-ui` only. No daemon, types, Rust, or mobile change.

**Goal.** A sidebar session row lays out `[status] [title] [meta glyphs] [time | hover actions]` on one 28px line. Today the title is the only flexible item and the meta cluster is `flex-shrink-0`, so the cluster wins every contest for space. The daemon appends a `DetectedPr` per PR it associates with a chat — including ones merely *mentioned* in conversation — and `SessionRowMetaIcons` renders one chip per entry with no cap, so a chat that discussed several PR numbers pushes the title to zero width. This plan (a) caps inline PR chips at 2, session-owned first, with a never-shrinking PR indicator whose popover lists every detected PR; and (b) inverts the flex contract — a floor on the title, a meta cluster that yields whole glyphs — and puts both halves in one module, so a future meta item cannot silently reintroduce the starvation.

---

## Status — revised 2026-07-27 after the first implement attempt

**Tasks 1–8 are landed on the branch. Tasks 9–11 are all that remain, and they now ship as one group.**

The first implement run failed on three groups — `new-component-tests` (T9), `existing-test-updates-and-regression` (T10), `verification-sweep` (T11) — for a scheduling reason, not a design one. The workflow journal (`wf_0ec2b012-f76`) shows T9 and T10 dispatched while the branch head was still `a2004e96` (the plan commit) with `node_modules` absent: both agents correctly refused to write tests against production code that did not exist, and T11 refused to sweep a tree whose test files were missing. The implementation groups then ran and completed. Nothing in this plan was found wrong by that run.

Landed:

| Task | Commit | |
|---|---|---|
| T1 bootstrap | — (no diff by design) | `node_modules` installed, `pnpm-lock.yaml` byte-identical |
| T2 red-phase pure test | `5ad58aee` | `__tests__/row-pr-chips.test.ts`, 9 cases |
| T3 `arrangeRowPrs` | `153f598b` | `row-pr-chips.ts` |
| T4 layout contract | `f7aa0809` | `session-row-layout.ts` |
| T5 chips + overflow | `c0c98584` | `SessionRowPrChips.tsx`, `SessionRowPrOverflow.tsx` |
| T6 meta-icons rewire | `746571f1` | `SessionRowMetaIcons.tsx` |
| T7 title floor + mount | `85d51c0e` | `SessionRow.tsx` |
| T8 changeset | `97c9e46e` | `.changeset/session-row-pr-chip-cap.md` |

Verified baseline at `97c9e46e` (re-measured for this revision, not taken on trust):

- `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean.
- `pnpm --filter @qlan-ro/mainframe-ui exec eslint src/features/sessions/sidebar` — **1 pre-existing warning**, `__tests__/resolve-project-session.test.ts:5:71` `no-explicit-any`, in a file this change never touches. T11's original `--max-warnings=0` would fail on it; T11 below is corrected.
- `SessionRowMetaIcons.test.tsx` — 9 pass, 1 fails on the renamed testid, exactly the red state T10 owns.
- `SessionRow.tsx` is **290** lines, not the 283 this plan predicted (still under 300, 10 lines of slack). `SessionRowInner` is **171** lines before *and* after T7 — the predicted net −1 did not materialise because the title `className` split across two lines.

**Remaining scope = T9 + T10 + T11, dispatched as ONE group.** They are three tasks for one agent, in that order. Splitting them is what failed: T11 has a hard dependency on T9 and T10 landing first, and the schema the orchestrator consumes carries no dependency edge — only a `parallel_safe` flag. One group removes the hazard rather than restating it.

Two commits, matching the two tasks that write files: one for T9's two new test files, one for T10's two edits and one new file. T11 writes nothing and commits nothing. The changeset already exists (`.changeset/session-row-pr-chip-cap.md`, `@qlan-ro/mainframe-ui: patch`) — do not add a second one.

---

## Ground rules for every task

- **Dependencies are installed (Task 1, done). Do not re-run `pnpm install`.** `packages/mobile` is a submodule and is *not* checked out here, so an unguarded install drops its importer from `pnpm-lock.yaml`. Task 1 already installed under a lockfile snapshot-and-restore and proved `git status --porcelain pnpm-lock.yaml` empty; `node_modules` is present now. If a command reports a missing module, re-read Task 1 and repeat its guarded sequence — never a bare `pnpm install`. No task in this plan adds a dependency — `@radix-ui/react-popover` is already installed and wrapped in `components/ui/popover.tsx`.
- **Read the `mainframe-design-system` skill before writing any markup or class names.** Spacing integers are compressed (`p-2` = 4px); the arbitrary values in this plan (`min-w-[44px]`, `h-[17px]`, `gap-x-[6px]`) are literal px and unaffected. Every text node takes an explicit type rung.
- **Test commands.** Single file only — `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` (large multi-suite runs hit cross-file `React.act` failures). Typecheck: `pnpm --filter @qlan-ro/mainframe-ui typecheck` (it includes test files).
- **Code rules baked in:** ≤300 lines/file, ≤50/function; `data-testid` on every interactive element, kebab-case `<surface>-<element>`, keyed by PR number never by array index; no `@ts-ignore`; comments say *why*; no dead code left behind.
- **`docs/plans/` is ignored yet tracked.** `.gitignore:53` ignores the directory, but `git ls-files docs/plans` lists 6 committed plans — the convention is to force-add. Commit this file with `git add -f docs/plans/2026-07-27-todo-285-pr-chips-title-starve-plan.md`.
- **Vitest project split:** `.test.ts` runs in the `node` project (no DOM), `.test.tsx` in `jsdom`. The pure-logic test must be `.test.ts`; component tests must be `.test.tsx`.

## Architecture decisions taken by this plan

Verified against the code at `5f7fdcaa`.

1. **The starvation rule lives in one module, `session-row-layout.ts`, as two exported class constants** — `SESSION_ROW_TITLE_FLOOR` on the title and `SESSION_ROW_META_CLUSTER` on the meta cluster. The repo already keeps shared row/chrome class strings as module constants (`layout/MainToolbar.tsx` `ICON_BTN`/`CHIP_BASE`, `ChatCardHeader` `HEADER_ROOT_CLASS`), and Tailwind v4's scanner reads literal class strings out of `.ts` files, so this compiles. It is the "single place" the brief demands: the title's floor and the cluster's yield behaviour are one pair of facts, and they currently live in two different files (`SessionRow.tsx:199` and `SessionRowMetaIcons.tsx:43`).

2. **The title gets a floor; the meta cluster becomes the shrinkable item.** The brief's preferred mechanism (a `min-w` on the title) is necessary but not sufficient on its own: with the cluster still `flex-shrink-0`, a floored title makes the row's intrinsic width exceed the panel and the row overflows instead of the meta yielding. So the title swaps `min-w-0` for `min-w-[44px]` (**exactly one** `min-width` utility on the element — two Tailwind `min-w-*` classes on one element resolve by CSS source order, not class order, which is a silent trap), and the cluster drops `flex-shrink-0` and takes `min-w-0`. Flexbox then honours the title's floor and pushes all remaining overage into the cluster.

3. **44px is the largest floor that provably fits the narrowest row.** The sidebar content frame is pinned to `minWidth: SIDEBAR_EXPANDED_WIDTH` (280px, `layout/SidebarShell.tsx:52`) under an `overflow-hidden` panel, so 280px is the narrowest layout the row ever sees. Budget at 280:

   | Item | px | Source |
   |---|---|---|
   | Panel width | 280 | `SIDEBAR_EXPANDED_WIDTH` |
   | − Root `mx-2` (compressed scale, 4px/side) | 8 | `SessionRow.tsx:164` |
   | − Trigger `paddingLeft` | 32 | `SESSION_ROW_CONTENT_INSET_PX` = `sidebarIndentPx(2) − SIDEBAR_ROW_GUTTER_PX` = 36 − 4 |
   | − Trigger `pr-[12px]` | 12 | `SessionRow.tsx:178` |
   | **= content box** | **228** | |
   | Leading cluster: `PinIcon` 11 + `gap-[5px]` + `StatusDot` `size-6` 12 | 28 | `SessionRow.tsx:180-185`, `SessionRowStatus.tsx` |
   | Four `gap-[9px]` gaps (5 rendered children; `display:none` children take no gap) | 36 | `SessionRow.tsx:178` |
   | PR overflow indicator, widest label `99+` (11px glyph + 3px gap + 3 × ~6.5px `text-caption tabular-nums` + 2×3px padding) | ~40 | decision 5 |
   | Timestamp, widest string "just now" at `text-caption` 11px | ~46 | `SessionRow.tsx:55-64` |
   | Hover actions: 3 × `size-[26px]`, no gaps | 78 | `SessionRowHoverActions.tsx` |

   `detected_prs` is unbounded, so the indicator's label — not just its count — has to be bounded or the budget is a guess: it renders `ordered.length` up to 99 and the literal `99+` beyond, which pins its widest state at three tabular glyphs (Task 5, tested in T9.10). The timestamp (`group-hover:hidden`) and the hover actions (`group-hover:flex`) are never rendered together, so the binding case is hover: `228 − 28 − 36 − 40 − 78 = 46px` for title + cluster. A 44px floor fits with 2px of slack and the cluster yields to ~0 — which is correct behaviour, since the `SessionMetaCard` hover card is already showing the full detail at that moment. Unhovered the same row leaves `228 − 28 − 36 − 40 − 46 = 78px`, so the title takes 44 and the cluster keeps 34. At 13px `text-body`, 44px is roughly six characters plus an ellipsis — the guaranteed minimum at the narrowest width with every optional element present, not the typical case (the sidebar drags to 640px, and a row with no PRs and no pin gets 46px more).

4. **The cluster yields whole glyphs, not clipped ones, via wrap-and-clip.** `flex-wrap` + `gap-y-[8px]` + a fixed `h-[17px] overflow-hidden`: an item that no longer fits wraps onto a second line starting 25px down, which the fixed height clips away entirely — so a squeezed cluster drops a glyph rather than showing half of one (the brief's objection to a plain `overflow-hidden`). 17px clears the tallest item (the 14px `FolderGit2` icon and the 11px × 1.35 = 14.85px caption line box), with the row's `items-center` keeping it vertically centred in the 28px row. DOM order is drop priority in reverse — worktree, PR chips, tag dots — so the ornamental tag dots wrap away first.

5. **The overflow indicator sits *outside* the yielding cluster and shows the total, not the hidden count.** Two consequences of decision 2 force this. First, if the indicator lived inside the cluster it would be the last thing before the tag dots and would itself be squeezed away exactly when the row is tightest — an affordance the user cannot click on hover is worse than none, and hover is the only way a mouse user reaches it. So it renders as a `flex-shrink-0` sibling of the cluster, between the cluster and the timestamp, and is always clickable. Second, because the cluster can squeeze an inline chip away, a "+N hidden" label would be wrong at exactly those widths; the indicator therefore renders a `GitPullRequest` glyph plus the **total** PR count, which is true no matter how many chips survived the squeeze. It renders only when the total exceeds `MAX_ROW_PR_CHIPS`, so the common one-or-two-PR row stays chip-only. This is a deliberate refinement of the brief's "+N" wording, not a rejection of it: the requirement is an indicator that the row is showing a subset and a reveal for the rest, and both hold.

6. **The reveal is a Popover, with a Hint wrapping its trigger.** The brief asks for hover-reveal *and* keyboard reachability *and* clickable entries; a Radix tooltip (`Hint`) is not focusable and cannot host links, so the interactive reveal is `components/ui/popover.tsx` (already installed, focus-managed, Escape-dismissed, portalled) and the hover affordance is a `Hint` **wrapping** the `PopoverTrigger` — the order required by the `app-tauri-hint-tooltip-primitive` convention, and known-good with two `asChild` Slots chained onto one `<button>`.

7. **The popover lists every PR, not only the hidden ones.** The brief says "reveals the rest" in prose and "reveals the full PR set" in the acceptance criteria. Full set wins: it is the superset, it keeps the panel's content independent of the cap and of the squeeze, and it gives the mentioned/created marker a place to live for chips that *are* inline.

8. **No UI-side dedupe; React keys are `pr.url`.** Verified: `packages/core-rs/crates/mainframe-db/src/chats.rs:542` `add_detected_prs` already skips an incoming PR whose `url` matches a stored one and upgrades a stored `mentioned` to `created` in place. The stored list is therefore URL-unique, so `pr.url` is a correct and stable React key and a UI dedupe pass would be dead code. `arrangeRowPrs` stays a pure ordering-and-capping function.

9. **PR state = `DetectedPr.source`.** `DetectedPr` (`packages/types/src/adapter.ts:137`) carries `url`/`owner`/`repo`/`number`/`source` and nothing else — no open/merged/closed state exists anywhere in the contract. The brief's "state where known" is therefore rendered as the `created` / `mentioned` source. Do not invent a status field (design-system rule: never design an affordance for data the backend lacks).

10. **`sessions-row-meta-icon-pr` becomes `sessions-row-meta-icon-pr-<number>`.** The current id is emitted once per chip, so it is already duplicated whenever a chat has two PRs — a violation of the keyed-testid rule. Number-keying is what the brief asks for and matches the existing `chat-header-pr-<number>` precedent. Two *different* repos with the same PR number in one chat would still collide, and an owner/repo suffix is not kebab-safe, so the disambiguator is a sibling attribute instead: every chip and every popover entry also carries `data-pr-url={pr.url}` — the daemon's unique key (decision 8). A test that needs one specific PR selects on `[data-pr-url="…"]`; the number-keyed testid stays the ergonomic default. Only unit tests reference the old id (`SessionRowMetaIcons.test.tsx`, `SessionRow.test.tsx`); no E2E spec does (verified by grep across `packages/e2e`), so the rename is free.

11. **The dead `@max-[260px]:hidden` wrapper is deleted, not relocated.** `SessionRow.tsx:206` wraps the meta cluster in `<div className="@max-[260px]:hidden">`, but the `@container` it resolves against (`sessions-sidebar-content-frame`) carries `minWidth: 280`, so the container's border-box width is never below 280 and the query can never match. Keeping a class that provably cannot fire — while rewriting the exact contract it was meant to express — is the leftover this repo's rules forbid, so the wrapper goes and the responsive story is decision 2's yield. The row-level hide is not the mechanism being fixed here, and nothing else depends on it.

12. **`SessionMetaCard` is not touched.** Its PR list wraps inside a 220px card, so it grows in height rather than starving anything, and it is the complete-detail surface this plan leans on. Out of scope.

---

## Task graph

```
T1 (bootstrap) ─ T2 (pure test, red) ─ T3 (pure module) ─ T4 (layout contract) ─┬─ T5 (chips) ──┬─ T6 (meta icons) ─ T7 (row) ─ T8 (changeset)
                                                                                └─ T5b (overflow)┘                              └─ T9 (new tests) ─ T10 (existing tests) ─ T11 (sweep)
```

T5 and T5b are two components in two files; they are written as one task (Task 5) because they share the arrangement contract.

Everything left of `T9` is committed. **The only live edge now is `T9 → T10 → T11`, and all three belong to one agent** — see the Status section. Nothing on this branch runs in parallel any more, so the collision map below is history rather than a schedule; it is kept because it still tells you which task owns which file.

### File-collision map

| File | Task |
|---|---|
| `pnpm-lock.yaml` (must end unchanged), `node_modules/` | T1 |
| `packages/ui/src/features/sessions/sidebar/__tests__/row-pr-chips.test.ts` | T2 |
| `packages/ui/src/features/sessions/sidebar/row-pr-chips.ts` | T3 |
| `packages/ui/src/features/sessions/sidebar/session-row-layout.ts` | T4 |
| `packages/ui/src/features/sessions/sidebar/SessionRowPrChips.tsx` | T5 |
| `packages/ui/src/features/sessions/sidebar/SessionRowPrOverflow.tsx` | T5 |
| `packages/ui/src/features/sessions/sidebar/SessionRowMetaIcons.tsx` | T6 |
| `packages/ui/src/features/sessions/sidebar/SessionRow.tsx` | T7 |
| `.changeset/session-row-pr-chip-cap.md` | T8 |
| `packages/ui/src/features/sessions/sidebar/__tests__/SessionRowPrChips.test.tsx` | T9 |
| `packages/ui/src/features/sessions/sidebar/__tests__/SessionRowPrOverflow.test.tsx` | T9 |
| `packages/ui/src/features/sessions/sidebar/__tests__/SessionRowMetaIcons.test.tsx` | T10 |
| `packages/ui/src/features/sessions/sidebar/__tests__/SessionRow.test.tsx` | T10 |
| `packages/ui/src/features/sessions/sidebar/__tests__/SessionRow.meta-layout.test.tsx` | T10 |

No file is written by two tasks.

---

## Task 1 — bootstrap the worktree's dependencies without touching the lockfile  (DONE — no diff by design)

**Files:** none committed. `node_modules/` is gitignored; `pnpm-lock.yaml` must end byte-identical.

`ls node_modules` and `ls packages/ui/node_modules` both fail today, so nothing below this task can run. `ls packages/mobile` returns zero entries — the submodule is not checked out — and pnpm prunes importers for missing workspace directories, which would rewrite the lockfile.

From the worktree root, in order:

1. `cp pnpm-lock.yaml /tmp/mf-285-lock.yaml`
2. `pnpm install --ignore-scripts` (`--ignore-scripts` skips the native `better-sqlite3` / Tauri postinstall builds this plan never exercises)
3. `cp /tmp/mf-285-lock.yaml pnpm-lock.yaml` — restores only this file, which only this task could have modified. Do not `git checkout`/`restore`/`stash` anything.
4. `pnpm --filter @qlan-ro/mainframe-types build` — the UI imports `DetectedPr` from the built `@qlan-ro/mainframe-types` entry point.

**Verify:**
- `git status --porcelain pnpm-lock.yaml` prints nothing.
- `git status --porcelain` lists no file outside this plan's collision map.
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest --version` prints a version.
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes on the untouched tree (this is the baseline every later task compares against).

---

## Task 2 — pure-logic tests for the chip cap (red phase)  (DONE — `5ad58aee`)

**File (new):** `packages/ui/src/features/sessions/sidebar/__tests__/row-pr-chips.test.ts`

Must be `.test.ts` (node project — no DOM needed). Import `{ MAX_ROW_PR_CHIPS, arrangeRowPrs }` from `../row-pr-chips` and a local `pr()` factory building `DetectedPr` objects (`{ url, owner, repo, number, source }`) from `@qlan-ro/mainframe-types`. The factory derives `url` from owner/repo/number so every fixture is URL-unique, matching the daemon's stored invariant (decision 8).

Cases, one `it` each:

1. `MAX_ROW_PR_CHIPS` is `2`.
2. Empty input → `inline`, `overflow`, `ordered` all empty.
3. One `created` PR → `inline` length 1, `overflow` empty, `ordered` length 1.
4. Exactly 2 PRs → `inline` length 2, `overflow` empty.
5. Five PRs → `inline` length 2, `overflow` length 3, `ordered` length 5.
6. Mixed sources: input `[#1 mentioned, #2 created, #3 mentioned, #4 created]` → `ordered` numbers are `[2, 4, 1, 3]` (created first, original order preserved inside each group), `inline` numbers `[2, 4]`, `overflow` numbers `[1, 3]`.
7. All-`mentioned` input keeps its original order (no reshuffle when there is nothing to prioritise).
8. Same number, different repos — `[#7 org/a created, #7 org/b created]` → `ordered` length 2, both kept, `url`s distinct. This is the guard against anyone reintroducing number-based identity (decision 8/10).
9. The input array is not mutated: snapshot `input.map(p => p.number)` before the call and assert it is unchanged after.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/row-pr-chips.test.ts` — fails to resolve `../row-pr-chips`. That failure is the expected red state.

---

## Task 3 — the pure cap/prioritise function  (DONE — `153f598b`)

**File (new):** `packages/ui/src/features/sessions/sidebar/row-pr-chips.ts` (~40 lines)

```ts
import type { DetectedPr } from '@qlan-ro/mainframe-types';

export const MAX_ROW_PR_CHIPS = 2;

export interface RowPrArrangement {
  /** Chips rendered inline on the row, session-owned (`created`) first. */
  inline: DetectedPr[];
  /** Everything the cap leaves out — non-empty means the row shows the indicator. */
  overflow: DetectedPr[];
  /** All PRs in the same priority order — what the reveal lists, and whose length the indicator shows. */
  ordered: DetectedPr[];
}
```

- `arrangeRowPrs(prs: readonly DetectedPr[]): RowPrArrangement` — a **stable** sort with `created` ranked 0 and `mentioned` ranked 1 (`Array.prototype.sort` is stable per ES2019, so equal ranks keep input order), then `slice(0, MAX_ROW_PR_CHIPS)` / `slice(MAX_ROW_PR_CHIPS)`.
- Never mutate the input: copy before sorting.
- Return a module-level frozen `EMPTY_ARRANGEMENT` when `prs.length === 0` — the overwhelmingly common case allocates nothing.
- No dedupe (decision 8) and no `prIdentity` helper: `pr.url` is the key, and the daemon guarantees it is unique.
- One exported function, ~12 lines. The header comment explains *why* the cap exists (the title's width comes out of this cluster) and points at `session-row-layout.ts`.

**Verify:** the Task 2 command now passes, all 9 cases green.

---

## Task 4 — the row's title-vs-meta layout contract  (DONE — `f7aa0809`)

**File (new):** `packages/ui/src/features/sessions/sidebar/session-row-layout.ts` (~20 lines, no functions)

Two exported constants plus a header comment stating the invariant in one place: *the title has a legibility floor; every meta glyph yields before it, and yields whole; anything that must stay clickable goes outside the cluster.*

```ts
/** The session title never shrinks below this. 44px is the largest floor that
 *  still fits the 280px sidebar with a pin glyph, the PR indicator at its
 *  widest label and the hover actions all showing. */
export const SESSION_ROW_TITLE_FLOOR = 'min-w-[44px]';

/** The meta cluster is the row's shock absorber: it shrinks (min-w-0, no
 *  flex-shrink-0) and drops whole glyphs by wrapping them onto a clipped
 *  second line, rather than clipping one in half. */
export const SESSION_ROW_META_CLUSTER =
  'flex min-w-0 h-[17px] flex-wrap content-start items-center gap-x-[6px] gap-y-[8px] overflow-hidden text-muted-foreground';
```

Both must be single literal strings (no template interpolation) so Tailwind's scanner sees the class names.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes (the module is unused at this point — expected until T6/T7).

---

## Task 5 — inline PR chips and the PR overflow indicator  (DONE — `c0c98584`)

**File (new):** `packages/ui/src/features/sessions/sidebar/SessionRowPrChips.tsx` (~45 lines)
**File (new):** `packages/ui/src/features/sessions/sidebar/SessionRowPrOverflow.tsx` (~85 lines)

Two components, two files, because they mount at two different levels: the chips are a child of the yielding cluster, the indicator is a sibling of it (decision 5). Both call `arrangeRowPrs` under a `useMemo` keyed on the `detectedPrs` reference — `SessionRow` is memoised and `custom.detectedPrs` comes from the memoised `allItems`, so the arrangement recomputes only when the PR list changes.

### `SessionRowPrChips` — inline, inside the cluster

```tsx
export function SessionRowPrChips({ detectedPrs }: { detectedPrs: DetectedPr[] }) {
  const { inline } = useMemo(() => arrangeRowPrs(detectedPrs), [detectedPrs]);
  if (inline.length === 0) return null;
  …
}
```

Each chip is the same `<a>` as today (`href={pr.url}`, `target="_blank"`, `rel="noreferrer"`, `onClick={e => e.stopPropagation()}` so it does not also select the row), classes unchanged (`inline-flex items-center font-mono text-caption font-semibold text-mf-success hover:underline`), plus `key={pr.url}`, ``data-testid={`sessions-row-meta-icon-pr-${pr.number}`}`` and `data-pr-url={pr.url}` (decision 10). Wrap each chip in ``<Hint label={`${pr.owner}/${pr.repo} #${pr.number}${pr.source === 'mentioned' ? ' — mentioned' : ''}`}>`` so the source is glanceable without opening anything. Returns a Fragment of chips — no wrapper element, so the chips are direct children of the cluster and wrap individually.

### `SessionRowPrOverflow` — the indicator and its panel

```tsx
export function SessionRowPrOverflow({ detectedPrs }: { detectedPrs: DetectedPr[] }) {
  const { overflow, ordered } = useMemo(() => arrangeRowPrs(detectedPrs), [detectedPrs]);
  if (overflow.length === 0) return null;
  return (
    <Popover>
      <Hint label={`${ordered.length} pull requests on this session`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="sessions-row-pr-overflow"
            aria-label={`Show all ${ordered.length} pull requests`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex flex-shrink-0 items-center gap-[3px] rounded-xs px-[3px] text-caption font-semibold tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <GitPullRequest size={11} />
            {ordered.length > 99 ? '99+' : ordered.length}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="start" side="bottom" className="w-[210px]" data-testid="sessions-row-pr-overflow-panel">
        <div className="flex flex-col">{ordered.map((pr) => <PrOverflowItem key={pr.url} pr={pr} />)}</div>
      </PopoverContent>
    </Popover>
  );
}
```

`Hint` **wraps** `PopoverTrigger` (not the reverse) — the `app-tauri-hint-tooltip-primitive` convention; both are `asChild` Slots chaining onto the one `<button>`. `stopPropagation` (not `preventDefault`) keeps Radix's own toggle working while stopping the row-select bubble. `flex-shrink-0` is on the button itself because it is a direct flex child of the row. The label clamps at `99+` (decision 3): `detected_prs` is unbounded, and an unbounded label would blow the 280px budget the title's floor is derived from. The `aria-label` keeps the exact count.

`PrOverflowItem`, a local component in the same file (~15 lines), keeps the exported component under 50:

```tsx
<a
  data-testid={`sessions-row-pr-overflow-item-${pr.number}`}
  data-pr-url={pr.url}
  href={pr.url}
  target="_blank"
  rel="noreferrer"
  onClick={(e) => e.stopPropagation()}
  className="flex items-center gap-[6px] rounded-xs px-1.5 py-1 text-caption hover:bg-accent"
>
  <span className="font-mono font-semibold text-mf-success">#{pr.number}</span>
  <span className="min-w-0 flex-1 truncate text-muted-foreground">{pr.owner}/{pr.repo}</span>
  {pr.source === 'mentioned' && <span className="flex-shrink-0 text-micro text-muted-foreground">mentioned</span>}
</a>
```

Every text node carries an explicit type rung; `truncate` sits on a `min-w-0` flex child. Anchors are natively focusable, so the panel is keyboard-reachable once Radix moves focus into it.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`. `wc -l` on both files — under 300. Each of the four functions (`SessionRowPrChips`, `SessionRowPrOverflow`, `PrOverflowItem`, and the chip's local render helper if extracted) reads under 50 lines; the estimates above are the expected sizes.

---

## Task 6 — rewire `SessionRowMetaIcons` onto the cap and the cluster contract  (DONE — `746571f1`)

**File (edit):** `packages/ui/src/features/sessions/sidebar/SessionRowMetaIcons.tsx`

1. Delete the uncapped `{detectedPrs.map(...)}` block (lines 59–71) and render `<SessionRowPrChips detectedPrs={detectedPrs} />` in its exact position — between the worktree glyph and the tag dots, preserving the drop priority decision 4 relies on.
2. Replace the root `className="flex flex-shrink-0 items-center gap-[6px] text-muted-foreground"` with `SESSION_ROW_META_CLUSTER` from `./session-row-layout`. No `cn()` composition is needed — the constant is the whole class list (the `@max-[260px]:hidden` wrapper is deleted in T7, decision 11).
3. Leave `MAX_ROW_TAG_DOTS`, the worktree `Hint`, and the tag-dot block untouched.
4. Update the file's header comment: PR chips now cap at 2 and hand the remainder to the row-level indicator, mirroring the tag-dot cap; the cluster is the row's shrinkable item, defined in `session-row-layout.ts`. Delete the now-stale "PR keeps its short `#N` number" phrasing rather than leaving it beside the new behaviour.

`hasContent` keeps its current shape (`worktreePath != null || detectedPrs.length > 0 || visibleTags.length > 0`) so an empty row still renders nothing.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/SessionRowMetaIcons.test.tsx` — the two `sessions-row-meta-icon-pr` cases fail on the renamed testid (fixed in T10); everything else stays green. `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes. File stays under 300 lines (≈80).

---

## Task 7 — apply the title floor and mount the indicator in `SessionRow`  (DONE — `85d51c0e`)

**File (edit):** `packages/ui/src/features/sessions/sidebar/SessionRow.tsx`

1. In the title `<span>` (lines 196–204), replace `min-w-0` with `SESSION_ROW_TITLE_FLOOR` imported from `./session-row-layout`. The class array becomes `[SESSION_ROW_TITLE_FLOOR, 'flex-1 truncate text-body tracking-normal group-data-[active=true]:text-primary', isUnread ? … : …]`. **Exactly one `min-w-*` class** must remain on the element.
2. Delete the `<div className="@max-[260px]:hidden">` wrapper (line 206, decision 11), leaving `<SessionRowMetaIcons … />` as a direct flex child.
3. Insert `<SessionRowPrOverflow detectedPrs={custom.detectedPrs} />` immediately after `<SessionRowMetaIcons … />` and before `<RelativeTime … />`.
4. Extend the file header comment with one line: the title's floor and the meta cluster's yield behaviour are defined together in `session-row-layout.ts` — a new meta glyph goes inside the cluster, and only something that must stay clickable at 280px goes beside it.

Do not touch `SessionRowRename` (the rename input replaces the title and has its own sizing), `RelativeTime`, or `RowHoverActions`.

`SessionRowInner` spans lines 75–245 (171 lines) before this change and 170 after (one wrapper `<div>` removed, one component added). It already exceeds the 50-line function limit; this plan does not decompose it — see "Carried forward" below.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/SessionRow.unread-store.test.tsx` (green — it asserts `font-bold`, unaffected). `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes. File stays under 300 lines (284 → 283).

---

## Task 8 — changeset  (DONE — `97c9e46e`)

**File (new):** `.changeset/<generated-name>.md`

`pnpm changeset` → select `@qlan-ro/mainframe-ui`, **patch** (a bug fix inside an existing surface, no API change). Summary, one sentence, plain: `Cap a session row's PR chips at two with an indicator that opens the full list, and give the row title a minimum width so the meta glyphs can no longer squeeze it out.`

**Verify:** the file exists under `.changeset/` and names `@qlan-ro/mainframe-ui` with `patch`.

---

## Task 9 — component tests for the chips and the reveal

**Files (new):**
- `packages/ui/src/features/sessions/sidebar/__tests__/SessionRowPrChips.test.tsx`
- `packages/ui/src/features/sessions/sidebar/__tests__/SessionRowPrOverflow.test.tsx`

jsdom project. No mocking needed — both components take plain props, and `src/__tests__/setup.ts` already stubs what Radix needs in jsdom (`hasPointerCapture`/`setPointerCapture`/`releasePointerCapture` at lines 100–110, `scrollIntoView` at 81–87, `ResizeObserver`). All verified for this revision.

**Follow `features/chat/composer/config-toolbar/__tests__/ProviderModelSelect.test.tsx`, not `BranchPopover.test.tsx`.** BranchPopover drives an `open` prop and never clicks a trigger, so it proves nothing about the shape used here. ProviderModelSelect is the exact precedent: it nests a `PopoverTrigger` inside a `TooltipTrigger` (what `Hint`-wraps-`PopoverTrigger` compiles to), opens it with `userEvent.click`, and its header records that Radix's portal renders inline under `document.body` in jsdom — so `screen.getByTestId` finds panel contents immediately after the click settles. `Hint` carries its own `TooltipProvider`, so no extra wrapper is needed.

**`SessionRowPrChips.test.tsx`:**

1. Empty `detectedPrs` → renders nothing (`container.firstChild` is null).
2. One PR → one chip `sessions-row-meta-icon-pr-42` whose visible text is `#42`. Assert on `textContent`, not `toHaveTextContent` of a single node: the component renders `#{pr.number}` as two adjacent text nodes.
3. Five PRs → exactly two chips: `container.querySelectorAll('[data-testid^="sessions-row-meta-icon-pr-"]')` has length 2.
4. Prioritisation: `[#1 mentioned, #2 created, #3 mentioned]` → `sessions-row-meta-icon-pr-2` and `sessions-row-meta-icon-pr-1` render, `sessions-row-meta-icon-pr-3` does not.
5. Each chip's `href` is the PR's `url`.
6. Same number, different repos — `[#7 org/a, #7 org/b]` → two chips render and `container.querySelectorAll('[data-pr-url]')` resolves each one uniquely by URL (decision 10's disambiguator, so a collision on the number-keyed testid can never make a test silently assert the wrong chip).
7. Clicking a chip does not bubble: render inside a parent `<div onClick={spy}>`, click the chip, assert the spy was not called.

**`SessionRowPrOverflow.test.tsx`:**

8. Two PRs → renders nothing (nothing is hidden, so no indicator).
9. Five PRs → `sessions-row-pr-overflow` renders with visible text `5` (the total, decision 5) and `aria-label` `Show all 5 pull requests`.
10. 120 PRs → the visible label is `99+` while the `aria-label` still says `Show all 120 pull requests` (the bounded-width guarantee decision 3's budget rests on).
11. Clicking the indicator opens `sessions-row-pr-overflow-panel` with one item per PR: assert `sessions-row-pr-overflow-item-1` … `-5` are all present (the full set, including the inline ones), that each carries the right `href`, and that each shows its `#N` and `owner/repo` text.
12. Keyboard reachability: from `document.body`, `await user.tab()` in a loop of at most 5 iterations until `document.activeElement` matches the indicator; assert it was reached (do not assume a fixed tab index — the panel is portalled and the component renders in isolation). Then `await user.keyboard('{Enter}')` opens the panel.
13. `Escape` closes the panel (Radix behaviour, asserted so a future `modal`/`onOpenChange` change can't silently break dismissal).
14. A `mentioned` entry renders the `mentioned` marker; a `created` entry does not.
15. Clicking the indicator does not bubble to a parent `onClick` spy.

**Verify:** each file green, run individually with `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <path>`.

---

## Task 10 — update the existing tests and add the inflated-cluster regression

**Files (edit):**
- `packages/ui/src/features/sessions/sidebar/__tests__/SessionRowMetaIcons.test.tsx`
- `packages/ui/src/features/sessions/sidebar/__tests__/SessionRow.test.tsx`

**File (new):**
- `packages/ui/src/features/sessions/sidebar/__tests__/SessionRow.meta-layout.test.tsx`

`SessionRow.test.tsx` is already 640 lines — over the 300-line limit before this plan touches it. It therefore gets the two-line testid rename and nothing else; the new regression goes in its own file (which also keeps the layout contract findable by name).

In `SessionRowMetaIcons.test.tsx`:
1. Update the two cases under `describe('SessionRowMetaIcons — PR glyph')` to the keyed id `sessions-row-meta-icon-pr-42`. The first (`renders sessions-row-meta-icon-pr with text "#42"…`) is the one currently red; the second (`does not render a PR glyph when detectedPrs is empty`) must query the keyed id too, or it passes vacuously forever.
2. Add: with 4 PRs, only 2 chips render inside `sessions-row-meta-icons`, and no `sessions-row-pr-overflow` is inside it (the indicator is a row-level sibling now — this pins decision 5 so nobody moves it back into the cluster).
3. Add: the cluster root `sessions-row-meta-icons` carries the shared contract — assert its `className` equals the imported `SESSION_ROW_META_CLUSTER`, not a hand-copied string, and separately that it contains `min-w-0` and not `flex-shrink-0`.
4. Update the file header comment to describe the cap.

In `SessionRow.test.tsx`:
5. Update the case `renders sessions-row-meta-icon-pr with "#42" when a PR is detected`, under `describe('SessionRow — compact worktree/PR glyphs render inline')`, to the keyed id `sessions-row-meta-icon-pr-42`. No other change.

In `SessionRow.meta-layout.test.tsx` (new, ~130 lines) — **the inflated-meta-cluster regression the brief requires.**

**Write a fresh minimal harness inside this file. Do NOT extract a shared one.** (Revised: the earlier "extract if it exceeds ~40 lines" instruction was a trap.) `SessionRow.test.tsx`'s harness is four `vi.mock` calls plus mutable module-level flags and spies — ~110 lines — and `vi.mock` is hoisted per *test file*; moving those calls into an imported helper makes registration order depend on module-evaluation timing rather than the transform, which is exactly the kind of silent breakage this plan is trying to remove. Two copies is also below the repo's extract-at-3 threshold.

The harness this test needs is smaller than the one it would have copied, because nothing here clicks, renames, pins or archives — it renders once and inspects structure. Mock only the four modules `SessionRow` reaches for, with constant returns and no spies:

- `@assistant-ui/react` — `ThreadListItemRuntimeProvider` (passthrough), `ThreadListItemPrimitive.Root` (a `<div>` forwarding `data-testid` and `data-active="false"`) and `.Trigger` (`asChild` passthrough), `useThreadListItemRuntime` (`{}`), `useAuiState` (selector against `{ thread: { id: '' } }`), and `useAssistantRuntime` returning **both** `threads.getState: () => ({ threadItems: { 'chat-1': {} } })` **and** `threads.getItemById: () => ({})`. Both are required: `SessionRowResolver` (`SessionRow.tsx:261-278`) reads `getState().threadItems` first and returns `null` if the fixture's id is absent, so a mock with only `getItemById` renders an empty row and every assertion below fails for the wrong reason. The key must match the fixture id (`chat-1`).
- `@/store/unread-store` — never unread.
- `../../runtime/daemon-port-context` — `useDaemonPort: () => 31415`.
- `@/lib/api/chats` — `pinChat: vi.fn()`.

Then `const { SessionRow } = await import('../SessionRow')` after the mocks, and a local `makeItem()` fixture mirroring the one in `SessionRow.test.tsx`.

6. Render a row whose `custom` carries 8 detected PRs (mixed sources), 5 tags, and a `worktreePath`, then assert:
   a. `sessions-row-title` still carries `SESSION_ROW_TITLE_FLOOR` and still carries `truncate`;
   b. it carries exactly one `min-w-` class — `expect(title.className.match(/min-w-\S+/g)).toHaveLength(1)` — guarding the two-min-width trap;
   c. exactly 2 PR chips render;
   d. `sessions-row-pr-overflow` renders with text `8` and is **not** a descendant of `sessions-row-meta-icons` (`expect(cluster.contains(indicator)).toBe(false)`);
   e. exactly 3 tag dots render — `colorOf` needs no wiring here, `SessionRow` defaults it to `DEFAULT_COLOR_OF` (the same reason `SessionRow.test.tsx`'s tag-dot cases pass without it).
   Name the test so its purpose survives: *"a bloated meta cluster cannot take the title's floor"*.
7. Head the file with a comment pointing at `session-row-layout.ts` as the one place the contract is defined, so a future meta item is added inside the cluster rather than beside it.

**Verify:** all three files green, run individually:
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/SessionRowMetaIcons.test.tsx`
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/SessionRow.test.tsx`
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/SessionRow.meta-layout.test.tsx`

---

## Task 11 — verification sweep

No files written.

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean (it type-checks test files too).
2. Every test file this plan added or edited, run individually (the T2, T9, T10 commands), plus `src/features/sessions/sidebar/__tests__/SessionRow.unread-store.test.tsx` and `src/features/sessions/sidebar/__tests__/SessionRowRename.test.tsx` — green.
3. `pnpm --filter @qlan-ro/mainframe-ui exec eslint src/features/sessions/sidebar` — **0 errors, and exactly the 1 pre-existing warning** (`__tests__/resolve-project-session.test.ts:5:71`, `no-explicit-any`, in a file this change never touches). Do **not** pass `--max-warnings=0`: the original instruction did, and it fails on that untouched baseline warning. Do not "fix" the warning either — it is out of scope, and silencing it would put an unrelated edit in this diff.
4. Size limits, both checked explicitly:
   - `wc -l` on the seven touched/added source files — every one under 300. Measured at `97c9e46e`: `row-pr-chips.ts` 34, `session-row-layout.ts` 21, `SessionRowPrChips.tsx` 41, `SessionRowPrOverflow.tsx` 68, `SessionRowMetaIcons.tsx` 81, `SessionRow.tsx` **290** (10 lines of slack — do not add to it). `SessionRow.meta-layout.test.tsx` ≈130.
   - Function length, measured not eyeballed. Prettier puts every top-level declaration's closing brace in column 0, so this reports the length of each one:
     ```sh
     for f in row-pr-chips.ts SessionRowPrChips.tsx SessionRowPrOverflow.tsx SessionRowMetaIcons.tsx; do
       awk -v F="$f" '/^(export )?(async )?(function|const) /{s=NR;n=$0} /^}/{if(s){if(NR-s+1>50) printf "%s:%d %d lines %s\n", F, s, NR-s+1, n; s=0}}' \
         "packages/ui/src/features/sessions/sidebar/$f"
     done
     ```
     It must print nothing. **Do not run that one-liner over a test file** — it keys on top-level `function`/`const` declarations closing at column 0, and a test file's bodies are `it('…', () => { … });` callbacks it never matches, so it would report "clean" without checking anything. For the three T9/T10 test files, measure the callbacks instead:
     ```sh
     awk '/^(it|test)\(|^  it\(/{s=NR} /^\}\);|^  \}\);/{if(s){if(NR-s+1>50) printf "%s:%d %d lines\n", FILENAME, s, NR-s+1; s=0}}' <file>
     ```
     It must print nothing for `SessionRowPrChips.test.tsx`, `SessionRowPrOverflow.test.tsx` and `SessionRow.meta-layout.test.tsx`. Also `wc -l` those three: each under 300. `SessionRowMetaIcons.test.tsx` gets the same treatment. `SessionRow.test.tsx` is exempt — it is 640 lines and grandfathered (see "Carried forward"); confirm only that T10.5's rename left its length unchanged. `SessionRow.tsx` is excluded from the source one-liner because its pre-existing `SessionRowInner` would report — see "Carried forward". Confirm separately that this plan's edit leaves that number **not higher**: it is 171 lines on `main` and 171 lines at `97c9e46e`. (The original wording asked for "one line lower"; that prediction was wrong — removing the `@max-[260px]:hidden` wrapper saved a line, splitting the title `className` spent it.)
5. **Live visual check** (the only thing that can verify decisions 3 and 4, which jsdom cannot).

   **If the dev app cannot be launched from this environment, do not block and do not claim a pass.** Record it verbatim as a decision — *"decisions 3 and 4 (44px floor, wrap-and-clip yield) are unverified live; jsdom cannot measure layout"* — and hand it to the lane's QA stage, whose job is exactly this smoke test. Everything else in this sweep is machine-checkable and must still be green. A missing display is not a reason to fail a group whose code-level criteria all pass.

   Set up a reproducible fixture in the isolated dev data dir:
   - Start the app isolated: `DAEMON_PORT=31500 MAINFRAME_DATA_DIR=~/.mainframe_dev pnpm tauri:dev` from `packages/app-tauri`, backgrounded to a log file. Never launch without both variables.
   - Pick a session id: `sqlite3 ~/.mainframe_dev/mainframe.db "SELECT id, title FROM chats ORDER BY updated_at DESC LIMIT 5;"`. If it returns no rows, the dev data dir is fresh — add a project in the app and send one message to create a session, then re-run it.
   - Snapshot the row as an executable, correctly escaped `UPDATE` — a plain `SELECT` writes pipe-delimited text that cannot be replayed and corrupts on any title containing a `|`:
     ```sh
     sqlite3 ~/.mainframe_dev/mainframe.db \
       "SELECT 'UPDATE chats SET title='||quote(title)||', pinned='||quote(pinned)||', detected_prs='||quote(detected_prs)||' WHERE id='||quote(id)||';' FROM chats WHERE id='<id>';" \
       > /tmp/mf-285-restore.sql
     ```
     `quote()` is SQLite's own literal escaper, so the restore round-trips NULLs and embedded quotes exactly. Confirm the file is non-empty before touching the row.
   - Give it a long title and five PRs (the `detected_prs` column is a JSON array of `DetectedPr`):
     ```sh
     sqlite3 ~/.mainframe_dev/mainframe.db "UPDATE chats SET title='Refactor the session sidebar row layout contract', pinned=1, detected_prs='[{\"url\":\"https://github.com/o/r/pull/1\",\"owner\":\"o\",\"repo\":\"r\",\"number\":1,\"source\":\"created\"},{\"url\":\"https://github.com/o/r/pull/2\",\"owner\":\"o\",\"repo\":\"r\",\"number\":2,\"source\":\"mentioned\"},{\"url\":\"https://github.com/o/r/pull/3\",\"owner\":\"o\",\"repo\":\"r\",\"number\":3,\"source\":\"mentioned\"},{\"url\":\"https://github.com/o/r/pull/4\",\"owner\":\"o\",\"repo\":\"r\",\"number\":4,\"source\":\"created\"},{\"url\":\"https://github.com/o/r/pull/5\",\"owner\":\"o\",\"repo\":\"r\",\"number\":5,\"source\":\"mentioned\"}]' WHERE id='<id>';"
     ```
   - Reload the window, drag the sidebar to its 280px floor, and confirm on that row: the title shows a readable fragment ending in an ellipsis and never collapses to nothing; the row neither wraps nor overflows the panel; no glyph is half-clipped (a squeezed glyph disappears entirely); hovering the row — the actions replace the timestamp — keeps all of that true **and** the PR indicator stays visible and clickable; the indicator reads `5`; clicking it, and focusing it and pressing `Enter`, both open a panel listing all five PRs.
   - Restore, in this order: stop the dev app by port — `lsof -ti :31500 | xargs kill`, then re-run `lsof -ti :31500` and confirm it prints nothing. Kill by port only; never a name-fragment `pkill -f`, which would take out unrelated Mainframe processes. Then `sqlite3 ~/.mainframe_dev/mainframe.db < /tmp/mf-285-restore.sql`, then re-select the row and confirm the three fields match the snapshot. **Do not delete `~/.mainframe_dev`** — it is shared dev state other lanes rely on, and the fixture is a three-field edit that the snapshot fully reverses. Never touch `~/.mainframe`.
6. `git diff --name-only main...HEAD` lists exactly the ten collision-map **source and test** files, `.changeset/session-row-pr-chip-cap.md`, and `docs/plans/2026-07-27-todo-285-pr-chips-title-starve-plan.md` (tracked despite the ignore, see Ground rules). Nothing else. The map's first row — `pnpm-lock.yaml` and `node_modules/` — is the one entry that must **not** appear: T1 owns it in the sense of "must leave it byte-identical", and `node_modules/` is gitignored. No submodule pointer either. `git status --porcelain` is empty.

## Definition of done

Every acceptance-criteria box in the brief maps to a verification above:

| Acceptance criterion | Verified by |
|---|---|
| At most the capped chips inline, indicator shows the remainder exists | T9.3, T9.9, T9.10, T10.2, T10.6c/d |
| Title keeps a defined minimum width and truncates with an ellipsis | T7, T10.6a/b, T11.5 |
| Reveal shows the full set, keyboard-reachable, PR numbers identified | T9.11, T9.12, T9.13, T11.5 |
| Session-owned PRs preferred over mentioned ones | T2.6, T9.4 |
| Narrowest sidebar width still readable, no overflow or wrap | decision 3's budget table, T11.5 |
| Starvation fix enforced in one place, proven with an inflated cluster | T4, T10.3, T10.6 |
| Cap/prioritisation unit-tested as a pure function | T2 (all 9 cases) |
| `data-testid` keyed by PR number, never index | T5, T9.6, T10.1/5 |
| Typecheck + UI tests pass, ≤300 lines/file, ≤50/function | T11.1, T11.2, T11.4 |
| Changeset present | T8 |

## Carried forward, deliberately not done here

- **`SessionRowInner` is 171 lines, over the 50-line function limit.** It was 171 before this plan and is 171 after — unchanged, measured, not estimated. Decomposing a render function with six handlers and an aui runtime binding inside a chip-cap bugfix would swamp the fix's diff and put the row's behaviour at risk for no bug-related gain. It is a real violation and it wants its own change.
- **`SessionRow.test.tsx` is 640 lines**, over the file limit. This plan adds nothing to it (T10.5 is a two-line rename) and puts the new coverage in its own file. Splitting it is a separate change.
- **The daemon appends detected PRs without bound** (`add_detected_prs` dedupes by URL but never caps or ages entries). The brief already puts this out of scope and asks for a follow-up todo; nothing here depends on it.
