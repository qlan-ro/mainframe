# Retire the shell-geometry shim and the last live-sounding inspector references

**Todo:** #308 — Decide the Files tree's permanent home; retire InspectorPane's shim fragment
**Branch:** `todo/308-files-tree-home`
**Package:** `@qlan-ro/mainframe-ui` only (plus one design-system reference doc)
**Route:** no-spec — planned directly from the approved Agent Brief

## Goal

The Files tree's permanent home was settled on 2026-08-08: it is a floating glass panel inside the
workspace surface, and the app-level InspectorPane is gone. What is left is residue that still reads
as live code. This change deletes the `SHELL_GEOMETRY` shim module and moves its two class fragments
and its gutter width into `SurfaceHost`, drops the fragment that was a permanently empty string,
deletes the palette's dead `inspector` icon entry with its now-unused lucide import, deletes the
unreferenced `SidebarRightGlyph` export, and rewrites the module comments that still describe the
inspector as a surface that renders today. Rendered markup does not change: the same background
utility class, the same divider border class, the same 9px gutter. Past-tense references that explain
why code exists — above all the persisted UI-prefs migration that strips `inspectorVisible` and
`workspaceFilesCollapsed` — stay exactly as they are.

## Decisions adopted

All five PM recommendations from the brief are adopted as written:

1. **Do not rename the dead `inspector` command-icon key to `files`.** Delete the key only. Toggle Files
   keeps today's generic chevron fallback; giving it a glyph is a visible change that would pull a
   dead-code sweep into the design gate.
2. **Rewrite, do not delete, the surface-host inset assertion.** It becomes vacuous once the fragment is
   gone, so it is replaced with an exact-className assertion that still fails if a stray class lands on
   the wrapper.
3. **Keep the gutter as a named constant** in `SurfaceHost`. Three call sites must agree and an existing
   test pins the shared value.
4. **Delete `SidebarRightGlyph`.** An unused export is exactly the residue this todo exists to clear.
5. **One PR** covering #308 and #309's residual. It is a single sub-300-line sweep in one package.

Two further decisions were forced by facts on disk:

6. **The acceptance grep is scoped to exclude `docs/plans/` (and `node_modules`, `.git`).** This plan
   file must name `SHELL_GEOMETRY` and `InspectorPane` to describe the tasks, and it is force-added to
   the branch because `docs/plans/` is gitignored. An unscoped repo grep would therefore never reach
   zero. The changeset is worded without either token so it needs no exclusion.
7. **`.claude/skills/mainframe-design-system/references/v2-stock.md` line 170 is rewritten, even though
   its reference is historical.** Two reasons. Its parenthetical "(SurfaceHost slices remain)" becomes
   factually false the moment this change lands, and the brief's zero-hit criterion overrides the
   past-tense-stays discriminator for these two exact tokens. The replacement sentence keeps the history
   and drops both tokens.

## Files touched

| File | Change |
|---|---|
| `packages/ui/src/lib/appearance/shell-geometry.ts` | deleted; it is the only file in `lib/appearance/`, so the directory goes with it |
| `packages/ui/src/layout/SurfaceHost.tsx` | geometry inlined; local `DIVIDER_GUTTER`; empty interpolation removed |
| `packages/ui/src/layout/__tests__/SurfaceHost.test.tsx` | header comment + the inset case rewritten; the other three cases untouched |
| `packages/ui/src/features/palette/SpotlightRow.tsx` | `inspector` icon entry and the `PanelRightIcon` import deleted |
| `packages/ui/src/layout/surface-icons.tsx` | `SidebarRightGlyph` deleted |
| `packages/ui/src/app/AppShell.tsx` | comment: island list no longer names an inspector host |
| `packages/ui/src/features/files/FileTree.tsx` | comment: the tree serves the workspace files panel, not the Inspector |
| `packages/ui/src/features/tasks/TasksModalHost.tsx` | two comments: "inspector drawer" → the tasks modal / quick-add |
| `packages/ui/src/features/tasks/__tests__/TasksModalHost.test.tsx` | one comment, same substitution |
| `.claude/skills/mainframe-design-system/references/v2-stock.md` | line 170 sentence rewritten (decision 7) |
| `.changeset/<name>.md` | new patch changeset for the UI package |

## Do not touch

Implementers will grep and find these. They are deliberately out of scope.

- `packages/ui/src/store/ui-prefs.ts` — the `migrate` function, its version number, and its comments.
  That migration is the only thing stopping a stale `inspectorVisible` from rehydrating into a live
  store, and its wording is already correctly historical.
- `packages/ui/src/store/__tests__/ui-prefs.test.ts` — untouched, including the v2→v4 case.
- `packages/ui/src/features/review/ReviewScopeSwitcher.tsx` and
  `packages/ui/src/features/review/__tests__/ReviewPanel.test.tsx` — past-tense comments explaining what
  the retired inspector Changes tab used to own. They explain why the scopes live where they do.
- `packages/ui/src/store/layout-placement.ts` — the three-slot algebra is kept by the 2026-08-08 decision.
- `packages/e2e/tests-tauri/files-tree.spec.ts` lines 181–183 — the `toHaveCount(0)` assertions for
  `inspector-tab-files`, `inspector-tab-changes` and `changes-panel` are this retirement's regression
  guard. Also `packages/e2e/tests-tauri/viewers.spec.ts` line 21.
- The e2e testid inventory docs listing `inspector-tab-*`; both already carry a STALE banner naming
  regeneration as its own task.
- `packages/ui/src/layout/SurfDivider.tsx` — see Observed but excluded, below.
- Anything in the Rust daemon, and anything in the floating workspace Files panel, its store, or its
  dismiss behavior.

## Observed but excluded

`SurfDivider.tsx`'s prop doc comments describe `lineClass` as "`bg-border` for split, `bg-transparent`
for glass/unified" and the gutter as "per window style … 8 for unified/glass, 9 for split". Those three
window styles no longer exist. The comments reference the 04-engine prototype rather than the shim,
the brief enumerates its comment sites exhaustively (down to the tasks-modal *test* comment) and omits
this one, and nothing in this change makes them staler than they already are. Left for a separate
warm-chrome comment pass.

## Task groups

Four groups. No two groups write the same file. Ordering is two waves: groups 1 and 3 run together —
their files are disjoint and neither runs a package-wide check — then group 2, then group 4. Group 2
waits on group 3 as well as group 1 because its typecheck compiles the files group 3 edits; running them
concurrently would make each group's gate fail on the other's half-finished file.

---

### Group 1 — `surface-host-red-test` (test)

**depends_on:** none. This is the red phase; group 2 depends on it, not the reverse.

#### Task 1.1 — Replace the vacuous inset assertion with an exact-className assertion

**File:** `packages/ui/src/layout/__tests__/SurfaceHost.test.tsx`

Replace the body of the first `it` in the `SurfaceHost — flat shell geometry` describe block. Today it
asserts the wrapper's className does *not* contain `pt-[4px]` or `px-[10px]`, which is vacuous once the
inset fragment no longer exists. Rewrite it to pin the wrapper's exact utility classes:

```ts
it('renders the outer wrapper with only the flex-container utilities', () => {
  render(<SurfaceHost />);

  const outer = screen.getByTestId('chat-thread-area');
  expect(outer.className).toBe('flex flex-1 flex-col overflow-hidden');
});
```

Rename the `it` title as shown. Do not touch the three other test cases in this file — the 9px divider
case and both flex-weight cases must stay byte-identical, because the brief requires them to pass
unmodified.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__/SurfaceHost.test.tsx`
**must FAIL on this one case and only this one case.** Today `SurfaceHost` builds the className as
`` `flex flex-1 flex-col overflow-hidden ${geo.workspaceInset}` `` with `workspaceInset` set to the empty
string, so the rendered attribute carries a trailing space and the strict equality fails. Record the
observed failure message. The other three cases must pass. If the new case passes before group 2 lands,
stop — the assertion is not pinning what it claims to.

#### Task 1.2 — Rewrite the test file's header comment

**File:** `packages/ui/src/layout/__tests__/SurfaceHost.test.tsx` (lines 1–4)

The header describes wiring to a shim that is about to be deleted. Replace it with a description of what
the file actually covers: that the outer wrapper carries nothing but its flex-container classes, that the
divider gutter is the shared 9px value, and that flex weights follow the lone-pane and two-pane rules.
Do not name the deleted constant or module.

**Verification:** the comment names no deleted identifier;
`grep -n "SHELL_GEOMETRY\|shell-geometry" packages/ui/src/layout/__tests__/SurfaceHost.test.tsx`
returns nothing.

---

### Group 2 — `surface-host-geometry` (ui)

**depends_on:** `surface-host-red-test`, `dead-exports-and-comments`. This group turns the red test green,
so it must not start before the failure has been observed. It also waits on group 3 because task 2.2's
package-wide typecheck compiles `features/palette/SpotlightRow.tsx` and `layout/surface-icons.tsx` —
group 3's files — and would report a red gate for an edit this group does not own.

#### Task 2.1 — Inline the geometry into `SurfaceHost` and drop the dead inset

**File:** `packages/ui/src/layout/SurfaceHost.tsx`

Four edits, all mechanical:

1. Delete the `import { SHELL_GEOMETRY } from '@/lib/appearance/shell-geometry';` line (line 5) and the
   `const geo = SHELL_GEOMETRY;` line (line 35).
2. Add a module-level constant beside `PANEL_LAYOUT`:
   `const DIVIDER_GUTTER = 9;` — the shared px width. It has three consumers below (the horizontal
   `SurfDivider`, the vertical `SurfDivider`, and the single-column spacer), which is why it stays named
   rather than being inlined three times.
3. Fold the pane background into the panel class and update the comment above it. The comment currently
   says "Each surface is its own rounded floating card (geo.surface)" and must stop naming the deleted
   constant. Result:
   `const PANEL_LAYOUT = 'flex flex-col overflow-hidden bg-background';` — then `panelCls` is just
   `PANEL_LAYOUT` and the local `panelCls` binding can go, with its two call sites
   (`` `min-w-0 ${panelCls}` `` and `` `min-w-0 flex-1 ${panelCls}` ``) reading `PANEL_LAYOUT` instead.
4. Replace the remaining `geo.*` reads: `lineClass={geo.divider}` → `lineClass="bg-border"` at both
   `SurfDivider` call sites (lines 126 and 139); `gutter={geo.gutter}` → `gutter={DIVIDER_GUTTER}` at both;
   `style={{ width: geo.gutter, flexShrink: 0 }}` → `style={{ width: DIVIDER_GUTTER, flexShrink: 0 }}`
   (line 130). Finally, the outer wrapper's className loses the interpolation entirely — it becomes the
   plain string `"flex flex-1 flex-col overflow-hidden"`, not a template literal.

The rendered class strings must be identical to today's apart from the removed trailing space: panes keep
`bg-background`, dividers keep `bg-border`, the gutter stays 9.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__/SurfaceHost.test.tsx`
— all four cases pass, including the case that failed in group 1.
`grep -n "geo\.\|SHELL_GEOMETRY" packages/ui/src/layout/SurfaceHost.tsx` returns nothing.

#### Task 2.2 — Delete the shim module and its directory

**File:** `packages/ui/src/lib/appearance/shell-geometry.ts`

Delete the file. It is the only file in `packages/ui/src/lib/appearance/`, so remove the directory too
(`git rm` handles this; confirm the directory is gone from the working tree). There is exactly one
importer in the repo and task 2.1 removed it — no barrel, tsconfig path, or vite alias references
`lib/appearance`.

**Verification:** `ls packages/ui/src/lib/appearance` fails with "No such file or directory".
`pnpm --filter @qlan-ro/mainframe-ui typecheck` passes — an unresolved import would surface here.

Any failure in another group's file goes back to the owning group; do not patch it from here.

---

### Group 3 — `dead-exports-and-comments` (ui)

**depends_on:** none. Shares no file with any other group, and runs in the first wave alongside group 1.
Group 2 waits on this group; nothing here waits on anything.

#### Task 3.1 — Delete the dead palette icon entry and its import

**File:** `packages/ui/src/features/palette/SpotlightRow.tsx`

Delete the `inspector: PanelRightIcon,` line from the `COMMAND_ICONS` record (line 39) and the
`PanelRightIcon,` line from the lucide import block (line 16). No palette command has the id `inspector`
— the ids in `features/palette/palette-commands.ts` are `review`, `settings`, `sidebar`, `files` and
`workspace`. Do **not** add a `files` key (decision 1); Toggle Files keeps the `ICONS.command` chevron
fallback that `rowIcon` already returns for unmapped ids.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes — a stale `PanelRightIcon`
import would fail there under `noUnusedLocals`.
`grep -rn "PanelRightIcon" packages/ui/src` returns nothing.

#### Task 3.2 — Delete the unused right-rail glyph

**File:** `packages/ui/src/layout/surface-icons.tsx`

Delete the `SidebarRightGlyph` export together with its doc comment (lines 124–132). It has zero
consumers repo-wide. Leave `SidebarLeftGlyph` and every other glyph in the module untouched.

**Verification:** `grep -rn "SidebarRightGlyph" packages/ui packages/app-tauri packages/e2e` returns
nothing; `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes.

#### Task 3.3 — Rewrite the four present-tense inspector comments

Each of these describes the inspector as a surface that renders today. Rewrite each to describe what
actually renders, in the same register and length as the line it replaces. Do not delete surrounding
explanatory prose.

- `packages/ui/src/app/AppShell.tsx` line 8 — the island list reads "the surfaces, toolbar, inspector and
  overlay hosts are legacy islands that port in place". Drop `inspector` from the list; the remaining
  hosts are accurate.
- `packages/ui/src/features/files/FileTree.tsx` line 2 — "a lazy, expandable project file tree for the
  Inspector" becomes a tree for the workspace's floating Files panel. The rest of the header (the
  `getFileTree` lazy-expand contract, the `open-file` intent, the reveal behavior) is accurate and stays.
- `packages/ui/src/features/tasks/TasksModalHost.tsx` lines 7 and 35 — both say the eager boot load
  exists "so the inspector drawer has data" / "even when the inspector drawer is hidden". The real
  consumers are the Tasks modal and the quick-add dialog this host mounts; say that instead. The *reason*
  for the eager load is unchanged and must survive the rewrite.
- `packages/ui/src/features/tasks/__tests__/TasksModalHost.test.tsx` line 109 — "Boot load fires once so
  the inspector drawer has data", same substitution.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/tasks/__tests__/TasksModalHost.test.tsx`
still passes (comment-only change). `git grep -Ini "inspector" -- packages/ui/src` returns hits only in
`store/ui-prefs.ts`, `store/__tests__/ui-prefs.test.ts`, `features/review/ReviewScopeSwitcher.tsx`,
`features/review/__tests__/ReviewPanel.test.tsx` — all four past-tense and all four on the do-not-touch
list — plus `lib/appearance/shell-geometry.ts`, which is still on disk: group 2 runs after this group and
owns that deletion. Do not delete the shim from here.

#### Task 3.4 — Correct the design-system reference doc

**File:** `.claude/skills/mainframe-design-system/references/v2-stock.md` line 170

The sentence reads: "``…popover family run on v2 primitives; `SHELL_GEOMETRY.toolbar` is deleted
(SurfaceHost slices remain).``" Its parenthetical is false after group 2. Rewrite it so it still records
the history of the toolbar slice's removal but states that the shared geometry constant is now gone
entirely and `SurfaceHost` carries its background, border and gutter values inline. Phrase it without
the strings `SHELL_GEOMETRY` or `shell-geometry` (decision 6/7). Change nothing else in the file.

**Verification:** `grep -n "SHELL_GEOMETRY\|shell-geometry" .claude/skills/mainframe-design-system/references/v2-stock.md`
returns nothing; `git diff --stat origin/main...HEAD -- .claude/skills/mainframe-design-system/references/v2-stock.md`
shows one insertion and one deletion. Leave the file's two other `InspectorPane` mentions (lines 572 and
585) alone — both are past-tense records of surfaces that died.

Any failure in another group's file goes back to the owning group; do not patch it from here.

---

### Group 4 — `changeset-and-verify` (test)

**depends_on:** `surface-host-geometry`, `dead-exports-and-comments`. The acceptance greps span both.

#### Task 4.1 — Add the changeset

**File:** new `.changeset/<name>.md`

A `patch` bump for `@qlan-ro/mainframe-ui`, in the house format (front matter, then one or two sentences
of prose). Describe it as internal cleanup with no user-visible change: the shared shell geometry
constant is retired into the surface host, and the dead inspector icon entry and right-rail glyph are
removed. **Word it without the strings `SHELL_GEOMETRY` or `shell-geometry`** so the acceptance grep stays
clean without needing another exclusion.

**Verification:** the file exists under `.changeset/`, names `'@qlan-ro/mainframe-ui': patch`, and
`grep -n "SHELL_GEOMETRY\|shell-geometry" .changeset/<name>.md` returns nothing.

#### Task 4.2 — Run the acceptance checks

No file edits. Run each and record the output:

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — passes. The package sets `noUnusedLocals` and
   `noUnusedParameters`, so a stranded import fails here, and the run includes test files. Note that an
   unused *export* is invisible to the compiler — `SidebarRightGlyph` is covered by check 3.2's grep, not
   by this run.
2. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__/SurfaceHost.test.tsx` — passes.
3. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/ui-prefs.test.ts` — passes,
   with the file unmodified (check 6 confirms it is absent from the diff).
4. `git grep -In "SHELL_GEOMETRY\|shell-geometry" -- ':(exclude)docs/plans'` — zero hits. Use `git grep`,
   not `grep -r`: it searches tracked files only, which drops `node_modules` and the multi-GB Rust
   `target/` dirs for free. The pathspec exclusion is required because this plan file necessarily names
   the identifier it removes and is force-added to the branch (`docs/plans/` is gitignored).
   Do **not** substitute `grep -r --exclude-dir=docs/plans` — `--exclude-dir` matches a directory *name*,
   not a path, so a value containing a slash silently excludes nothing and the plan file trips the check.
5. `git grep -In "InspectorPane" -- packages/ui/src` — hits only in `packages/ui/src/store/ui-prefs.ts`
   and `packages/ui/src/store/__tests__/ui-prefs.test.ts`, both past-tense and both on the do-not-touch
   list. The check is scoped to `packages/ui/src` deliberately: the identifier also appears in prose
   across `packages/ui/CLAUDE.md`, `packages/e2e/tests-tauri/files-tree.spec.ts`,
   `.claude/skills/mainframe-design-system/references/v2-stock.md` and two `docs/` research notes, all
   describing the deletion in the past tense. Those are permitted by the brief and must not be edited.
   Note that `features/review/__tests__/ReviewPanel.test.tsx` does **not** match this pattern — its
   comment says "the retired inspector `ChangesPanel`", two words, so it never appears in this output.
6. `git diff --stat origin/main...HEAD` — no change to `packages/ui/src/store/ui-prefs.ts`,
   `packages/ui/src/store/__tests__/ui-prefs.test.ts`, `features/review/ReviewScopeSwitcher.tsx`,
   `features/review/__tests__/ReviewPanel.test.tsx`, `store/layout-placement.ts`, or anything under
   `packages/e2e/`.

**Verification:** all six checks as stated. Any failure goes back to the owning group; do not patch
another group's file from here.

## Risks

- **The exact-className assertion is strict by design.** Any future class added to the surface-host
  wrapper fails task 1.1's test. That is the point (decision 2), but it means the failure message must
  read clearly — hence asserting on `className` rather than on a class-list membership check.
- **The full UI suite is not part of the acceptance checks.** Per the repo's guidance, large multi-suite
  runs hit cross-file `React.act` failures, so verification is per-file. The typecheck run covers the
  whole package, and no group changes runtime behavior, so the residual risk is confined to a test file
  that imports `SidebarRightGlyph` or the deleted module — both greps in tasks 2.2, 3.2 and 4.2 rule
  that out.
