# Plan — Make the branch-flyout and rail-Escape e2e cases deterministic

Todo #315 (`route:no-spec`, project `rgoM5ZldH0UeeOonms6PK`) · branch `todo/315-flaky-e2e-pair`

## Goal

Two e2e cases flake on every batch and each git-branch occurrence burns a full test timeout. In
`packages/e2e/tests-tauri/git-branch.spec.ts`, the helper that opens a branch row's flyout waits only
for the search field, which is visible long before the lazily-loaded branch list exists; the three
flyout cases (checkout, new-branch-from, merge fast-forward) then click a Radix submenu item while the
list is still settling, and Playwright retries the click until the test timeout. In
`packages/e2e/tests-tauri/session-panel.spec.ts`, `settleForEscape` demands a page-wide "no Radix
popper layer exists" precondition that a hover-driven layer can invalidate at any moment, so the test
dies in the helper before Escape is ever pressed. This plan fixes both **test-side**: the branch
helpers wait on the app state that actually gates the interaction (rows loaded, no dying dialog scrim)
and bound every click with its own timeout, and the panel spec asserts the outcome (the overlay is
gone) through a bounded Escape retry in the same shape as the shared `closeMenus` helper. No product
code changes unless the red-phase evidence proves real menu jitter — see [Escalation](#escalation).

## Constraints

From the root `CLAUDE.md` and the todo brief:

- Max 300 lines/file, 50 lines/function. `git-branch.spec.ts` is at 659 lines and
  `session-panel.spec.ts` at 738 — both are pre-existing spec files over the limit. Do **not** grow
  either past its current line count by more than the fix needs, and do not attempt a split in this
  todo (out of scope, and a split would churn every test id reference).
- No fixed sleeps. `waitForTimeout` is banned in both specs; every new wait is on observable app or
  Radix state.
- Comments say *why*. Every comment left in place must describe the mechanism the code now relies on;
  a comment describing an abandoned approach is a defect, not a leftover.
- Changesets required before commit (`pnpm changeset --empty` shape, with a body — see
  `git show 2ba52f9c:.changeset/plenty-lizards-lick.md` for the precedent this repo uses for
  e2e-only changes).
- No leftovers: stale references (e.g. the comment naming `settleForEscape`) get fixed in the same
  pass.
- **`packages/e2e` is not typecheck-clean at HEAD, and never has been.** `tsc --noEmit` reports 90
  errors on branch HEAD (`b5b11f58`) and on a clean `main` checkout: 87 × TS2591 ("Cannot find name
  'fs' / 'path' / 'os' / 'child_process' / 'Buffer'") plus 3 × TS7006 in `fixtures/daemon.ts` and
  `fixtures/global-setup.ts`. `@types/node@26.1.1` is installed and its symlink resolves, but
  `packages/e2e/tsconfig.json` declares no `types` and no `typeRoots`, and the package has no
  `typecheck` script — so nothing in CI has ever run this. Fixing the tsconfig is **out of scope**:
  it would touch every file in the package. This plan therefore gates on a scoped typecheck (below),
  not on a clean `tsc`. An implementer who sees 90 errors has not broken anything.

## Ground rules for this fix

These three rules decide every judgement call below. An implementer who deviates must say so.

1. **Wait on data, not on chrome.** `git-branch-search` renders before the branch data arrives
   (`BranchPopover.tsx` loads lazily on `open`, and `BranchListView` renders the search field
   unconditionally). The only honest "list is loaded" signal available today is the presence of branch
   rows — `[data-testid^="git-branch-row-"]`. `busy` is **not** usable: `loadBranches` is the one
   handler in `use-branch-actions.ts` that is *not* wrapped in `withBusy`, so `git-fetch` never
   disables during the initial load.
2. **Retry only side-effect-free steps.** Opening a popover or a flyout can be retried; **clicking a
   flyout item can not**. A retried `git-submenu-merge` would run a second merge. Any retry loop in
   this plan wraps opens only.
3. **Bound every click.** A click that can legitimately race a transient layer gets an explicit
   `{ timeout: … }` so the failure names the element in seconds instead of riding the 45s (mock) test
   timeout.

## Files touched

| File | Change |
|------|--------|
| `packages/e2e/tests-tauri/git-branch.spec.ts` | helper rewrite: scrim wait, list-loaded wait, bounded clicks, comment updates |
| `packages/e2e/tests-tauri/session-panel.spec.ts` | `settleForEscape` → bounded Escape retry; two comment updates |
| `.changeset/<generated>.md` | e2e-only changeset |

Tasks are numbered globally for hand-off: **A1–A6 = 1–6, B1–B4 = 7–10, C1–C3 = 11–13.**

Read-only (do **not** edit): `packages/e2e/helpers/tauri/menus.ts` — `waitForDialogScrimsGone` and
`closeMenus` are already correct and are imported by six specs; changing them re-risks
`sessions`, `sessions-tags`, `sessions-filters`, `settings`, `files-tree`, `layout` and
`directory-picker`.

## Verification commands

Build once per worktree (this is what bakes `VITE_DAEMON_PORT=31416` into the bundle the preview
server serves, and builds the Rust daemon):

```
pnpm --filter @qlan-ro/mainframe-e2e build:app:tauri
```

Then every scoped run below is:

```
E2E_MODE=mock MF_E2E_SKIP_BUILD=1 pnpm --filter @qlan-ro/mainframe-e2e exec \
  playwright test tests-tauri/git-branch.spec.ts
```

(swap in `tests-tauri/session-panel.spec.ts`, or pass both paths, as each task says). Rebuild without
`MF_E2E_SKIP_BUILD=1` only if `packages/ui` changes.

Static gates, run from the repo root. Prettier and eslint are clean at HEAD and are plain pass/fail:

```
npx prettier --check packages/e2e/tests-tauri/git-branch.spec.ts packages/e2e/tests-tauri/session-panel.spec.ts
npx eslint packages/e2e/tests-tauri/git-branch.spec.ts packages/e2e/tests-tauri/session-panel.spec.ts
```

**The scoped typecheck gate.** Every task below that says "the scoped typecheck gate passes" means this
command, run from the repo root:

```
pnpm --filter @qlan-ro/mainframe-e2e exec tsc --noEmit 2>&1 \
  | grep -E 'tests-tauri/(git-branch|session-panel)\.spec\.ts' \
  | grep -v 'TS2591'
```

**The gate passes when this command prints nothing.** Judge it by its output, never by its exit code:
`tsc` exits 2 on the pre-existing errors and a `grep` that matches nothing exits 1, so a passing gate
still reports a non-zero status.

Why this shape is safe: TS2591 fires only on the known node-global names the package never types. A
typo'd identifier is TS2304 and a real type error is TS2322/TS2345 — none of them can hide behind the
allowlist. Baseline at HEAD (`b5b11f58`), for comparison: `git-branch.spec.ts` has exactly 4 errors
(lines 76–79) and `session-panel.spec.ts` exactly 4 (lines 115–117, 637), all TS2591. Record the
post-change counts as an observation; the plan adds no node-global usage, so a count above 4 + 4 means
the change introduced one and deserves a second look before it ships.

**Do not change `playwright.config.ts`.** `retries: 1` is what makes a first-attempt failure report as
"flaky"; that reporting is the acceptance signal, and retry-count changes are out of scope.

**Only one Playwright run may be in flight at a time in this repo.** The daemon port (31416), the vite
preview port (4317) and `packages/ui/dist` are all shared and global-setup kills whoever holds the
preview port. Groups A and B therefore run in sequence even though they share no files.

---

## Group A — branch flyout determinism

Files: `packages/e2e/tests-tauri/git-branch.spec.ts`.

### A1 · Red phase: capture the real failure signature

No code change. Run the spec and record what actually fails, because the fix in A2–A4 is only correct
if the mechanism matches.

1. Build (`pnpm --filter @qlan-ro/mainframe-e2e build:app:tauri`).
2. Run `tests-tauri/git-branch.spec.ts` twice back to back with the scoped command above.
3. For each failing/flaky case — "checkout switches the worktree current branch", "new branch from a
   selected branch", "merge fast-forwards a clean ancestor branch" — record verbatim:
   - the Playwright error class: *not stable* vs *element was detached* vs *intercepts pointer events*
     vs *element is not visible*;
   - which locator it was retrying (`git-submenu-*` item, or the `git-branch-row-*` sub-trigger);
   - the elapsed time of the failing test from the `list` reporter.
4. Confirm the typecheck baseline before touching anything, so later runs have something to compare
   against: `pnpm --filter @qlan-ro/mainframe-e2e exec tsc --noEmit 2>&1 | grep -c 'error TS'` should
   print 90, and the scoped typecheck gate command from
   [Verification commands](#verification-commands) should print nothing. If either differs, say so in
   the report rather than adjusting the numbers.

**Verification:** at least one of the three cases reproduces with a recorded signature, and the
signature is written into the implementation commit message. If **zero** cases reproduce in two runs,
stop and report that instead of "fixing" a race you never saw — the todo's premise is three batches of
evidence, so a non-repro is itself a finding the lane must see.

### A2 · `openBranchPopover` waits for a dying dialog scrim, then for the loaded list

Edit `openBranchPopover` in `git-branch.spec.ts` (currently lines 139–143):

- Import `waitForDialogScrimsGone` alongside `closeMenus` from `../helpers/tauri/menus.js`.
- Call `await waitForDialogScrimsGone(page)` **before** the existing `menuLayers` count assertion. This
  is the parity fix: five sibling specs already do this, and this spec opens four kinds of dialog
  (new branch, rename, confirm, conflict) whose `data-slot="dialog-overlay"` scrim outlives the dialog
  content and intercepts the next trigger click. Putting it in the helper covers every
  dialog-then-menu transition in the file at once — do not sprinkle it at call sites.
- After `git-branch-search` is visible, add a wait for the lazily-loaded list:
  `await expect(page.locator('[data-testid^="git-branch-row-"]').first()).toBeVisible({ timeout: 10_000 })`.
  The repo under test always has local branches, so zero rows means the load has not landed.
- Update the helper's doc comment to state both waits and why (scrim interception; the lazy load in
  `BranchPopover`'s `open`-gated `useEffect`, which leaves the search field visible before any row
  exists).

**Verification:** the scoped typecheck gate passes; the "toolbar branch trigger opens the menu; branches lazy-load"
and "search filters the branch list" tests still pass in a scoped run of the spec.

### A3 · `openSubmenu` opens the flyout on settled geometry, and retries only the open

Rewrite `openSubmenu` (currently lines 163–166):

- Resolve the row locator once; assert it visible with an explicit timeout before clicking.
- Click the row with an explicit `{ timeout: 5_000 }`.
- Assert `git-submenu` visible with `{ timeout: 5_000 }`.
- Wrap those three steps in a bounded retry (max 2 attempts). The open is side-effect-free (rule 2),
  so a flyout that a mid-flight list re-render closed can be re-opened. On the final attempt let the
  assertion throw so the failure names `git-branch-row-<branch>` or `git-submenu`.
- Between attempts, re-assert the row is visible rather than sleeping.
- Keep `openBranchSubmenu` as the two-step composition; the loaded-list wait it inherits from A2 is
  what makes the row's geometry final before the first click.
- The comment must describe the mechanism the code now relies on: the flyout anchors to a row whose
  position is only final once the branch data has landed, and a re-render can close an already-open
  Sub, which is why the open — and only the open — is retried.

**Verification:** the scoped typecheck gate passes, then a scoped run of `git-branch.spec.ts`: the three flyout
cases pass on the first attempt and each completes in single-digit seconds per the `list` reporter.

### A4 · Bound the flyout item clicks

Every `page.getByTestId('git-submenu-*').click()` in the file is currently unbounded and inherits the
whole test timeout. Add a small local helper (name it for what it does, e.g. `clickSubmenuItem`) that
clicks a `git-submenu-*` testid with `{ timeout: 5_000 }`, and route all `git-submenu-*` call sites
through it: checkout (×2 sites), new-branch-from, merge, rename, delete, pull, push, delete-worktree,
new-session. One click, no retry (rule 2). Leave the non-flyout quick actions (`git-fetch`,
`git-update-all`, `git-push-current`, dialog buttons) alone — they are not the class this todo names.

**Verification:** the scoped typecheck gate passes; grep shows no bare `.click()` left on a `git-submenu-` testid;
scoped run of the spec still green.

### A5 · Comment hygiene in the touched header

The file header (lines 1–74) documents the menu port and already says `openBranchPopover` "waits for
the previous layer to unmount". Update the two bullets that describe `openBranchPopover` /
`closeBranchPopover` so they describe the waits after A2–A4 (scrim, loaded list, bounded clicks).
Do not rewrite unrelated parts of the header.

**Verification:** `npx prettier --check` on the file; read-through confirms no comment describes a wait
the code no longer performs.

### A6 · Prove it: three consecutive clean scoped runs

Run `tests-tauri/git-branch.spec.ts` three times in a row with the scoped command. Each run must report
**0 failed, 0 flaky**. Record each run's per-test durations and confirm no test reaches the 45s mock
timeout and no menu/overlay interaction costs more than a few seconds.

**Verification:** three run summaries pasted into the group's report. Any flaky result means the fix is
not done — do not proceed to Group C.

### Escalation

If, after A2–A4, a flyout item click still fails **with the branch list demonstrably loaded and
quiescent** (rows present, no in-flight load), that is user-visible menu jitter in the popper
anchoring, not a test bug. Per the todo's Decisions: **stop, do not paper over it with more retries.**
Report the evidence and the recommendation to split the todo, with the product half labelled
`needs-ui`. Group C's acceptance run then covers the panel fix only, and the flyout cases stay as they
are.

---

## Group B — floating panel Escape determinism

Files: `packages/e2e/tests-tauri/session-panel.spec.ts`. Runs **after** Group A: the two groups share
no files but cannot share the e2e runtime.

### B1 · Red phase: confirm the helper is what times out

Run only the rail-Escape case:

```
E2E_MODE=mock MF_E2E_SKIP_BUILD=1 pnpm --filter @qlan-ro/mainframe-e2e exec \
  playwright test tests-tauri/session-panel.spec.ts -g "a rail click floats the panel"
```

Record whether the failure is `settleForEscape`'s `[data-radix-popper-content-wrapper]` count
assertion timing out (the brief's claim) or the final `overlay` assertion after the Escape. If the
solo `-g` run passes, run the whole spec file — the case is order-sensitive and the preceding tests
leave the hover state that matters.

**Verification:** the failing assertion is identified by line and written into the implementation
commit message.

### B2 · Replace the global precondition with a bounded Escape retry

Rewrite `settleForEscape` (lines 212–246) into a helper that asserts the **outcome**:

- Keep the real click on the floating card's own `session-panel-section-summary` heading. It is still
  load-bearing and the reasons in the current comment stay true: a pointerdown closes an open tooltip
  outright, it takes hover off the `Hint`-wrapped rail button without parking on a sessions row (whose
  `SessionMetaCard` hover card carries no `role`), and the heading is inert and inside the panel root
  so light dismiss reads it as "inside".
- **Delete** the `[data-radix-popper-content-wrapper]` `toHaveCount(0)` precondition. It is not
  reachable: a hover-driven layer can open after the click, inside the helper's own budget.
- Loop, at most 3 iterations: press `Escape`, then wait for `session-panel-overlay` to reach
  `detached` with a short per-press budget (~1.5s), catching the timeout because a transient Radix
  layer legitimately consumes a press (`use-session-panel-state.ts` bails on
  `event.defaultPrevented`). Return as soon as the overlay is gone. This is the shape `closeMenus`
  already uses for menu layers — press once, settle, re-read.
- Rename the helper to say what it does (e.g. `dismissOverlayWithEscape`) and rewrite the doc comment
  to describe the retry mechanism and why a press can be swallowed. The abandoned "clear every Radix
  overlay first" framing must not survive anywhere in the comment.
- The helper must **not** swallow the final failure: leave the authoritative
  `await expect(overlay).toHaveCount(0, { timeout: 5_000 })` in the test (line 415) so a genuine
  regression fails there, naming the overlay.

Update the call site at line 413 accordingly. The test's assertions are otherwise unchanged — same
overlay, same `role=dialog`, same "inline card stays absent" check.

**Verification:** the scoped typecheck gate passes; the rail-Escape case passes both solo (`-g`) and in a full
scoped run of the spec.

### B3 · Fix the stale cross-reference

The comment above "right-clicking the rail launch button floats the panel on the Launch section"
(≈ line 449–453) points at `settleForEscape` by name to explain why that test dismisses with a second
right-click instead of Escape. Update the name and, if the reasoning changed, the wording — the point
(a right-click leaves the rail button's tooltip open, and that tooltip owns the first Escape) still
holds under the retry helper because the retry now presses again rather than requiring a clear page.

**Verification:** grep for `settleForEscape` returns nothing in the repo.

### B4 · Prove it: three consecutive clean scoped runs

Run `tests-tauri/session-panel.spec.ts` three times in a row. Each run must report **0 failed, 0
flaky**, and no test may reach the mock timeout.

**Verification:** three run summaries in the group's report.

---

## Group C — close-out

Depends on A and B. Files: `.changeset/<generated>.md` only.

### C1 · Changeset

`pnpm changeset --empty`, then write the body in the shape this repo uses for e2e-only work: one or
two sentences naming both fixes and stating "No shipped behavior changes." Keep the generated file
name.

**Verification:** the file exists under `.changeset/` and `git status` shows it staged.

### C2 · Joint acceptance run — three consecutive clean runs of both specs

```
E2E_MODE=mock MF_E2E_SKIP_BUILD=1 pnpm --filter @qlan-ro/mainframe-e2e exec \
  playwright test tests-tauri/git-branch.spec.ts tests-tauri/session-panel.spec.ts
```

three times in a row. This is the todo's acceptance criterion; the per-group runs in A6/B4 do not
substitute for it, because the two specs share a daemon and a preview server within one run.

**Verification:** all three runs report 0 failed and 0 flaky; the durations show no test near the mock
timeout. Paste the three summaries into the report.

### C3 · Static gates

Run prettier `--check` and eslint on both spec files, plus the scoped typecheck gate. Confirm by
inspection that neither spec gained a `waitForTimeout`, that no test was deleted, weakened, skipped,
or had an assertion removed, and that `playwright.config.ts` is untouched.

**Verification:** prettier and eslint exit 0; the scoped typecheck gate prints nothing (do not check
its exit code — see [Verification commands](#verification-commands)); `git diff --stat origin/main`
lists exactly the two spec files plus the changeset (plus this plan). The whole-package
`tsc --noEmit` error count is unchanged at 90 — report it, do not fix it.

---

## Risks

- **The red phase may not reproduce on this machine.** The flake was measured under batch load; a
  scoped two-file run is quieter. A1/B1 handle this by making a non-repro a reportable outcome rather
  than a licence to guess. The waits added here are correct regardless (they close a real window), but
  claiming the flake is *fixed* requires having seen it fail first.
- **`--repeat-each` is not a substitute for three separate runs.** The fixtures are per-describe and
  order-dependent (`checkoutBase()` between mutating tests); repeating a single test inside one process
  does not reproduce the state the batch does. Use three full runs.
- **A retry around the flyout open can mask a genuine "the flyout never opens" regression.** Bounded at
  2 attempts with the real assertion thrown on the last one, a permanent breakage still fails in
  ~10 seconds with the row named. Do not raise the attempt count to make a run go green.
- **Group A and B cannot run Playwright concurrently** (shared daemon port, preview port and
  `packages/ui/dist`). The dependency edge between them exists for that reason alone.

---

## Appendix — C2 acceptance evidence (2026-08-10, review-fixes stage)

Command run verbatim, three consecutive times, foreground, from the worktree root:

```
E2E_MODE=mock MF_E2E_SKIP_BUILD=1 pnpm --filter @qlan-ro/mainframe-e2e exec \
  playwright test tests-tauri/git-branch.spec.ts tests-tauri/session-panel.spec.ts
```

The four cases this todo's fix targets — `branch row flyout: checkout`, `branch row flyout: new
branch from a selected branch`, `branch row flyout: merge fast-forwards a clean ancestor branch`,
and `a rail click floats the panel; Escape dismisses it` — passed on the **first attempt, in single
digit seconds, in all three runs** (checkout 2.4s/2.5s/2.5s, new-branch-from 1.8s/1.7s/2.2s,
merge-ff 1.1s/1.1s/1.1s, rail-Escape 3.1s/3.1s/3.1s). No occurrence reached a timeout or a retry.
The fix this todo describes is confirmed working under the exact joint-run condition the acceptance
criterion specifies.

**Run 1 — 21:02:44–21:03:44 EEST:** `42 passed (54.6s)`. 0 failed, 0 flaky.

**Run 2 — 21:03:49–21:04:59 EEST:** `41 passed, 1 flaky (1.1m)`. The flaky case was **not** one of
the four above: `quick actions: fetch, update all, and push current complete without error`
(git-branch.spec.ts:668) failed on first attempt and passed on Playwright's built-in retry. Failure:
`git rev-parse e2e-workspace` in the bare "remote" repo raised `fatal: ambiguous argument
'e2e-workspace': unknown revision` for the full 15s poll window, even though the UI had already
shown a "Pushed to origin/e2e-workspace" success toast.

**Run 3 — 21:08:54–21:10:20 EEST:** `41 passed, 1 failed (1.3m)`. Same test, same failure signature,
on both the initial attempt and Playwright's retry — this time it did not recover.

**Verdict: C2 does not close.** The acceptance criterion is "zero flaky and zero failed on every
run"; the quick-actions case broke that in 2 of 3 runs. This is a **different mechanism** from the
bug this todo fixes, and reproduces only under the joint two-spec run (Group A's three standalone
`git-branch.spec.ts` runs, task A6, saw no failures) — it involves a git push landing in the bare
repo, not a Radix popper/menu race.

Diagnosis so far (not fixed, no code changed for this): `BranchListView`'s push-current handler
reads `currentBranch` from `BranchPopover`'s `branches.current` state
(`packages/ui/src/features/git/BranchPopover.tsx:129`), which by this point in the test is the
*fresh* GET this todo's A2 fix now waits for, so the toast naming `e2e-workspace` is credible — the
push is real and targets the right branch. The unknown-revision result on the bare repo, persisting
for the full 15s poll, points at either the daemon reporting push success before the underlying git
process/ref-write is actually visible on disk, or a repo-path resolution issue specific to the
worktree under joint-run load; neither is confirmed. `git-fetch` / `git-update-all` / `git-push-current`
are the non-flyout quick actions the plan's task A4 explicitly scoped out of the click-bounding fix
("Leave the non-flyout quick actions … alone — they are not the class this todo names"), and the
mechanism here is unrelated to flyout anchoring or the rail-Escape overlay — fixing it would expand
this todo into a new investigation. Recommend a follow-up todo: "git-branch quick-actions
push-current: unknown-revision race in the joint two-spec run."
