# Todo #311 — Regenerate the e2e coverage artifacts

**Branch:** `todo/311-regen-e2e-docs` · **Route:** no-spec (works from the approved Agent Brief)

## Goal

`packages/e2e/UNUSED-TESTIDS.md` and `packages/e2e/FLOW-MAP.md` were generated on 2026-05-30 against
the pre-v2 Electron renderer and now carry hand-written STALE banners: most of the ids they list
belong to surfaces that no longer exist, every id introduced by the v2 shell and the session panel is
missing, and the flow map cross-references numbered spec filenames the suite abandoned. The mechanical
half was never reproducible — the companion triage doc documents regeneration as running a script that
lived in `/tmp`. This plan lands a committed generator under `packages/e2e/scripts/testid-inventory/`,
reachable through a package script, that mechanically derives the unused-testid inventory (and the
same-diff coverage gap report) from the current `packages/ui/src` tree and the current e2e specs; then
rewrites the hand-authored flow map against today's surfaces and repoints the triage doc's regeneration
instructions. After this work, both named artifacts describe the UI as it exists, their banners are
gone, and re-running the generator on a clean checkout leaves the committed files byte-identical.

## Constraints from CLAUDE.md and the repo

- **Max 300 lines/file, 50 lines/function** — this governs *code*. The generator is split across four
  modules for that reason. Generated Markdown artifacts are exempt (see Decisions).
- **Tests required** — the generator's pure extraction/analysis logic gets unit tests, written first.
- **Changeset required** — the pre-push hook and CI's `changeset-check` job reject without one.
- **Never commit to `main`** — all work on `todo/311-regen-e2e-docs`.
- **No leftovers** — the `/tmp` regeneration instruction in `COVERAGE-GAPS.md` is fixed in this pass,
  not deferred.
- `packages/e2e` has **no `lint` and no `typecheck` script**, and the root `test` script explicitly
  excludes it (`pnpm -r --filter=!@qlan-ro/mainframe-e2e run test`). The generator is therefore plain
  ESM `.mjs` (no TypeScript build step needed) and its tests are wired into CI explicitly (task 9).
- `.prettierignore` contains `*.md` — **prettier does not format Markdown in this repo** (verified:
  `npx prettier --check` on the four docs passes today only because they are ignored). No
  prettier-stability work is needed for the generated output, and no prettier chaining in the script.
- `packages/e2e/playwright.config.ts` sets `testDir: './tests-tauri'`, so files under `scripts/` are
  never collected by Playwright.

## Files touched

| Path | Task |
|---|---|
| `packages/e2e/scripts/testid-inventory/__tests__/extract.test.mjs` | 1 |
| `packages/e2e/scripts/testid-inventory/__tests__/analyze.test.mjs` | 1 |
| `packages/e2e/scripts/testid-inventory/__tests__/render.test.mjs` | 1 |
| `packages/e2e/scripts/testid-inventory/extract.mjs` | 2 |
| `packages/e2e/scripts/testid-inventory/analyze.mjs` | 3 |
| `packages/e2e/scripts/testid-inventory/render.mjs` | 4 |
| `packages/e2e/scripts/testid-inventory/cli.mjs` | 5 |
| `packages/e2e/package.json` | 5 |
| `.github/workflows/ci.yml` | 9 |
| `.changeset/<name>.md` | 10 |
| `packages/e2e/UNUSED-TESTIDS.md` | 6 |
| `packages/e2e/COVERAGE-GAP-REPORT.md` | 6 |
| `packages/e2e/FLOW-MAP.md` | 7 |
| `packages/e2e/COVERAGE-GAPS.md` | 8 |

## Pinned module contract

Every task below is written against this contract. The red-phase tests (task 1) and the
implementations (tasks 2–5) are authored by different agents and must not diverge.

### Types (JSDoc only; no TypeScript)

```js
/** @typedef {{ prefix: string, templated: boolean }} Definition */
/** @typedef {{ broad: string[], strict: Definition[] }} References */
```

A `Definition` is either a static id (`{ prefix: 'chat-send-button', templated: false }`) or a
templated family (`{ prefix: 'daemon-row-', templated: true }` from ``data-testid={`daemon-row-${d.id}`}``).
The prefix of a templated definition is the source text before the **first** `${`, verbatim, including
any trailing `-`.

### `extract.mjs`

```js
export function collectDefinitions(sourceText)   // → Definition[]  (order of appearance, may repeat)
export function collectReferences(specText)      // → References
export function stringLiterals(text)             // → string[]  (helper, exported for tests)
```

`collectDefinitions` collects, from one source file's text:

1. `data-testid="literal"` → static definition.
2. ``data-testid={`prefix-${…}`}`` → templated definition with prefix = text before the first `${`.
   A backtick value with **no** `${` is a static definition.
3. `testId="literal"` and `testIdPrefix="literal"` prop call sites → static definition
   (~107 of these exist; they are the real definition site for the `ui/` passthrough primitives).
4. ``testId={`prefix-${…}`}`` / ``testIdPrefix={`prefix-${…}`}`` → templated definition.
5. `data-testid={identifier}` (a bare prop passthrough such as `data-testid={testId}`) contributes
   **nothing** — the definition lives at the call site, covered by rules 3–4.
6. A templated form whose prefix is empty or shorter than 4 characters (e.g. ``{`${PREFIX[surface]}-unlink-${n}`}``)
   is **discarded** — it carries no matchable literal.

`collectReferences` returns two asymmetric sets from one spec/helper/fixture file's text:

- `broad`: the contents of **every** string literal in the file (single-quoted, double-quoted, and
  backtick). For a backtick literal the value is the text before the first `${`. Tokens shorter than
  4 characters are dropped. This is what kills the old scanner's false-positive class where
  `openZone(page, 'zone-rail-button-files', 'files-root-toggle')` made `files-root-toggle` read as
  unused.
- `strict`: only explicit locator forms — `getByTestId('X')`, `getByTestId("X")`, ``getByTestId(`X${…}`)``,
  `[data-testid="X"]`, `[data-testid='X']` — as `Definition[]` (templated when the backtick form is used).
  Dead-selector detection **must** use this set; computing it from `broad` would report every
  `'utf-8'` and branch-name literal in a spec as a dead selector.

### `analyze.mjs`

```js
export function displayId(def)                       // → string
export function matchesDefinition(def, value)        // → boolean
export function isLiveReference(defs, ref)           // → boolean
export function analyze({ sourceFiles, specFiles })  // → Report
```

- `displayId(def)` → `def.templated ? def.prefix + '${…}' : def.prefix`. The `${…}` marker (with the
  Unicode ellipsis `…`) is what marks templated families in both artifacts.
- `matchesDefinition(def, value)` → static: `value === def.prefix`. Templated:
  `value.startsWith(def.prefix) && value.length > def.prefix.length`.
- `isLiveReference(defs, ref)` → true when some `d ∈ defs` satisfies `matchesDefinition(d, ref.prefix)`,
  or `d.prefix.startsWith(ref.prefix)` when either side is templated. (A spec that rebuilds the same
  template yields `ref.prefix === d.prefix`, which this covers.)
- `analyze({ sourceFiles, specFiles })` takes `Array<{ path: string, text: string }>` for each side —
  all file I/O lives in `cli.mjs`, so `analyze` is pure and directly unit-testable. It returns:

```js
/** @typedef {{
 *   definitions: Definition[],                              // deduped by displayId, sorted
 *   definedCount: number,                                   // definitions.length
 *   referencedCount: number,                                // definitions matched by some broad token
 *   unused: Definition[],                                   // sorted, = definitions − referenced
 *   dead: Array<{ id: string, specs: string[] }>,            // strict refs matching no definition
 *   perSpec: Array<{ spec: string, live: number, dead: number }>,  // spec = path basename
 *   bySurface: Array<{ surface: string, defined: number, unused: number }>,
 * }} Report */
```

Counting and ordering rules, pinned because byte-for-byte output depends on them:

- Each definition — static id **or** templated family — counts as **one** toward `definedCount`.
- Dedup key is `displayId`. `foo-bar` (static) and `foo-bar-${…}` (templated) are distinct entries.
- Sorting everywhere is bytewise ascending on the display string using plain `<`/`>` comparison,
  **never** `localeCompare` (locale-dependent, non-reproducible).
- Surface key = display id up to the first `-`; an id with no `-` is its own surface. `bySurface` is
  sorted by `unused` descending, then surface ascending.
- `perSpec` is sorted by spec basename ascending; specs with zero strict refs are still listed.
- `dead[].specs` is sorted ascending and deduped.

### `render.mjs`

```js
export function renderUnused(report, date)     // → string (full UNUSED-TESTIDS.md body)
export function renderGapReport(report, date)  // → string (full COVERAGE-GAP-REPORT.md body)
```

Both take a `Report` and a `YYYY-MM-DD` string; both are pure and end with exactly one trailing `\n`.

`renderUnused` output contract:

```
# e2e — test-ids not referenced by any test

_Generated <date>. Source: packages/ui/src data-testids (<definedCount>) minus e2e references
(<referencedCount>). Unused: <unused.length>._

> "Unused" means the test-id string isn't referenced in a Playwright locator or passed as a bare
> string to a helper. Some of these elements ARE exercised via role/text locators (e.g. permission
> buttons via getByRole), so this lists selector gaps, not necessarily untested behavior. `${…}`
> marks templated id families.

## <surface> (<count>)
- `<display id>`
- …
```

Surface sections are ordered by unused count descending, then surface name ascending; ids inside a
section are sorted bytewise. **No STALE banner.** The false-positive caveat prose above is carried
over deliberately — it is still true.

`renderGapReport` emits only mechanically-derived sections: the header (date + method sentence naming
`packages/ui/src` and `packages/e2e/{tests-tauri,helpers,fixtures}`), the caveat blockquote, a
`## Summary` table (defined / referenced / unused / dead-selector counts), `## Dead selectors` (the
`dead` list with the specs that reference each), `## Per-spec health` (the `perSpec` table), and
`## Untested surfaces, ranked` (the `bySurface` table). The stale hand-written narrative sections —
"Test-only fixture IDs", "Beyond testids", "Dead selectors — CORRECTED after source + live-DOM
verification", "Recommended sequencing" — are **dropped, not regenerated**: the fixture-ID exclusion is
now mechanical (test files are not scanned) and the rest is 2026-05-30 analysis of a deleted tree.

### `cli.mjs`

Node ESM entry, no dependencies beyond `node:fs/promises`, `node:path`, `node:url`.

- Definition sources: every `.ts`/`.tsx` under `packages/ui/src`, **excluding** any path containing a
  `__tests__/` segment and any file ending `.test.ts` / `.test.tsx`. This exclusion is what
  mechanically removes the "test-only fixture IDs" pollution (`btn`, `row`, `sub`, `slot-action`, …)
  the old docs handled by hand-listing.
- Reference sources: every `.ts` under `packages/e2e/tests-tauri`, `packages/e2e/helpers`, and
  `packages/e2e/fixtures`, excluding `packages/e2e/fixtures/recordings`.
- Paths are resolved relative to the module's own location (`import.meta.url`), so the script works
  from any cwd.
- Directory entries are sorted before recursion so file order — and therefore output — does not depend
  on filesystem enumeration order.
- **Date handling (this is what makes re-running byte-stable):** for each output file, the date is
  taken from the first `_Generated (\d{4}-\d{2}-\d{2})` match in the **existing** file on disk. Flags
  override: `--date=YYYY-MM-DD` sets it explicitly, `--today` stamps the current date. If the file does
  not exist and no flag is given, today's date is used. Re-running with no flags therefore reproduces
  the committed bytes exactly; you pass `--today` when you intend to restamp.
- `--check`: render both documents and compare to disk. On any mismatch, write the offending path and
  the first differing line number to stderr and `process.exitCode = 1`; on match, exit 0 silently.
- Write CLI output with `process.stdout.write` / `process.stderr.write`, not `console.*` (the root
  eslint config bans bare `console.log`; `packages/e2e` has no lint script today but that can change).

Package scripts added to `packages/e2e/package.json`:

```json
"testids": "node scripts/testid-inventory/cli.mjs",
"testids:check": "node scripts/testid-inventory/cli.mjs --check",
"test:tools": "node --test scripts/testid-inventory/"
```

---

## Tasks

### 1. Red-phase unit tests for the generator

**Files:** `packages/e2e/scripts/testid-inventory/__tests__/extract.test.mjs`,
`.../__tests__/analyze.test.mjs`, `.../__tests__/render.test.mjs`

Write `node:test` suites (`import { test } from 'node:test'; import assert from 'node:assert/strict';`)
against the pinned contract above. No implementation files exist yet — the imports fail, and that
failure is the red phase.

Cases to cover, at minimum:

`extract.test.mjs`
1. `collectDefinitions` picks up `data-testid="chat-send-button"` as `{ prefix: 'chat-send-button', templated: false }`.
2. It picks up ``data-testid={`daemon-row-${d.id}`}`` as `{ prefix: 'daemon-row-', templated: true }`.
3. It picks up `testId="settings-toggle-foo"` and `testIdPrefix="tasks-field"` as static definitions.
4. It ignores the bare passthrough `data-testid={testId}`.
5. It discards ``data-testid={`${PREFIX[surface]}-unlink-${n}`}`` (empty/short prefix).
6. `collectReferences` puts `'files-root-toggle'` (a bare helper argument) in `broad` but **not** in
   `strict`; puts `getByTestId('chat-send-button')` in both; puts ``getByTestId(`daemon-row-${id}`)``
   in `strict` as `{ prefix: 'daemon-row-', templated: true }`; puts `[data-testid="zone-tab-files"]`
   in `strict`.
7. Tokens shorter than 4 characters (`'ok'`) never appear in `broad`.

`analyze.test.mjs`
8. `displayId` renders `daemon-row-${…}` for a templated definition and the bare id for a static one.
9. `matchesDefinition` — static requires exact equality; templated matches `daemon-row-abc` but not
   `daemon-row-` itself, and not `daemon-rowabc`.
10. `analyze` marks a definition referenced when only a broad token matches (the `openZone` case) and
    unused when nothing matches.
11. `analyze` reports a strict ref with no matching definition in `dead`, with the referencing spec
    basename attached; a live strict ref does not appear there and increments that spec's `live`.
12. `analyze` dedupes an id defined in two source files into a single entry and counts each templated
    family once.
13. `analyze` sorts `definitions`/`unused` bytewise (assert an explicit expected array containing
    ids that `localeCompare` would order differently, e.g. `chat-Zed` vs `chat-abc`).
14. Test files are **not** excluded inside `analyze` — the exclusion is `cli.mjs`'s job; assert that
    `analyze` faithfully reports whatever `sourceFiles` it is handed.

`render.test.mjs`
15. `renderUnused` header states the date and all three counts, contains no "STALE" string, keeps the
    caveat blockquote, groups by surface with `## <surface> (<n>)` headings, and marks templated
    families with `${…}`.
16. `renderGapReport` emits the Summary / Dead selectors / Per-spec health / Untested surfaces sections
    and contains none of the dropped narrative headings.
17. Both renderers end with exactly one `\n` and are pure (same input → identical string twice).

**Verify:** `pnpm --filter @qlan-ro/mainframe-e2e exec node --test scripts/testid-inventory/` fails with
module-not-found errors for `extract.mjs`, `analyze.mjs`, `render.mjs` — and for no other reason.

### 2. Implement `extract.mjs`

**File:** `packages/e2e/scripts/testid-inventory/extract.mjs`

Implement `stringLiterals`, `collectDefinitions`, `collectReferences` per the contract. Regex-based
scanning over raw text is acceptable and intended — do not add a parser dependency. Keep the file under
300 lines and every function under 50.

**Verify:** `pnpm --filter @qlan-ro/mainframe-e2e exec node --test scripts/testid-inventory/__tests__/extract.test.mjs`
passes (cases 1–7). The other two suites still fail on missing modules.

### 3. Implement `analyze.mjs`

**File:** `packages/e2e/scripts/testid-inventory/analyze.mjs`

Implement `displayId`, `matchesDefinition`, `isLiveReference`, `analyze`. Imports `collectDefinitions`
/ `collectReferences` from `./extract.mjs`. No file I/O.

**Verify:** `... node --test scripts/testid-inventory/__tests__/analyze.test.mjs` passes (cases 8–14).

### 4. Implement `render.mjs`

**File:** `packages/e2e/scripts/testid-inventory/render.mjs`

Implement `renderUnused` and `renderGapReport` per the output contract. Pure string building; no I/O,
no `Date` access (the date is a parameter).

**Verify:** `... node --test scripts/testid-inventory/__tests__/render.test.mjs` passes (cases 15–17),
and `... node --test scripts/testid-inventory/` is fully green.

### 5. Implement `cli.mjs` and wire the package scripts

**Files:** `packages/e2e/scripts/testid-inventory/cli.mjs`, `packages/e2e/package.json`

Implement the file walking, the exclusion rules, the date-preservation logic, `--check`, `--date=`,
and `--today` per the contract. Add the three scripts (`testids`, `testids:check`, `test:tools`) to the
e2e package's script block, leaving the existing entries untouched.

**Verify:**
- `pnpm --filter @qlan-ro/mainframe-e2e run testids` writes both files and exits 0.
- Running it a second time leaves `git diff` on those two files empty (idempotent, date preserved).
- `pnpm --filter @qlan-ro/mainframe-e2e run testids:check` exits 0; after `printf 'x\n' >> packages/e2e/UNUSED-TESTIDS.md`
  it exits 1 and names the file — then restore with `pnpm --filter @qlan-ro/mainframe-e2e run testids`.
- `node scripts/testid-inventory/cli.mjs --check` run from the repo root also works (cwd independence).
- The scan finds definitions in the ~770-id range and reports no id containing `${` in its static set.

### 6. Regenerate and commit the two mechanical artifacts

**Files:** `packages/e2e/UNUSED-TESTIDS.md`, `packages/e2e/COVERAGE-GAP-REPORT.md`

Run `pnpm --filter @qlan-ro/mainframe-e2e run testids -- --today` (2026-08-11) and commit the results.
Both files are fully overwritten — the previous hand-written banners and narrative sections disappear
with them.

Then audit the output by hand before committing:

- Spot-check 10 ids from the new inventory with `grep -rn 'data-testid="<id>"' packages/ui/src` — every
  one must exist in non-test source.
- `grep -nE 'chat-header-|chat-session-bar|answer-pill|inspector-|main-toolbar-files' packages/e2e/UNUSED-TESTIDS.md`
  must return nothing. Those ids belong to retired surfaces; their absence is the **expected**
  outcome, not a regression to file follow-up work on.
- `grep -c 'STALE' packages/e2e/UNUSED-TESTIDS.md packages/e2e/COVERAGE-GAP-REPORT.md` returns 0 for both.
- `grep -n 'app-electron\|packages/core\b\|packages/desktop' packages/e2e/COVERAGE-GAP-REPORT.md`
  returns nothing (the deleted packages must not be referenced).
- Pick three ids that specs reference only as bare helper arguments (e.g. `files-root-toggle`,
  `files-refresh`) and confirm they are **absent** from the unused list — proof the broad reference set
  works.
- Confirm at least one section covers each of `session`, `sessions`, `workspace`, and `gate`, so the
  post-v2 surfaces are represented.

**Verify:** `pnpm --filter @qlan-ro/mainframe-e2e run testids:check` exits 0 on the committed tree, and
`git status --short packages/e2e` shows only these two files modified.

### 7. Rewrite `FLOW-MAP.md`

**File:** `packages/e2e/FLOW-MAP.md`

Hand-authored analytical prose — no generator can produce it. Rewrite it against the current tree,
anchored on the refreshed `UNUSED-TESTIDS.md` from task 6.

Structure to keep: the header (regenerate the date to 2026-08-11, drop the STALE banner, repoint the
anchor link to `./UNUSED-TESTIDS.md`), the `P0/P1/P2` priority key, and per-surface sections listing
**edges** — sequences, preconditions, conditional rendering that test-ids alone do not encode.

Sections to **delete outright** (surfaces retired; annotate nothing): the chat-header PR pills, the
toolbar Files toggle, the session bar / answer pill and their `chat-header-*` family, the app-level
inspector pane, and the "Exclude — test-only fixture IDs" block (now handled mechanically by the
generator's test-file exclusion). Re-verify each entry in "Dormant / unwired code" against the current
tree; keep only what still exists and is still unwired.

Sections to **cover**, derived by reading `packages/ui/src/features/*` and `packages/ui/src/layout/*`
and cross-checking against the refreshed inventory. The five starred ones are required by the brief:

| Section | Source dirs | Current spec(s) to name |
|---|---|---|
| Sessions list & filters | `features/sessions` | `sessions.spec.ts`, `sessions-rows.spec.ts`, `sessions-filters.spec.ts`, `sessions-tags.spec.ts`, `sessions-draft.spec.ts` |
| ★ Session panel | `features/session-panel` | `session-panel.spec.ts` |
| ★ Session tabs | `features/session-tabs` | `session-tabs.spec.ts` |
| ★ Workspace surface + floating Files panel | `layout/`, `layout/surfaces`, `features/files` | `workspace-surface.spec.ts`, `files-tree.spec.ts`, `layout.spec.ts` |
| ★ Spotlight / command palette | `features/palette` | `spotlight.spec.ts` |
| ★ Gates (permission / plan / question) | `features/chat/gates` | `gates.spec.ts` |
| Chat transcript & tool cards | `features/chat`, `features/chat/tools` | `chat.spec.ts`, `transcript.spec.ts`, `tool-cards.spec.ts` |
| Composer | `features/chat/composer` | `composer.spec.ts`, `composer-advanced.spec.ts` |
| Editor, diff & review | `features/editor`, `features/review` | `editor.spec.ts`, `editor-diff.spec.ts`, `editor-comments-review.spec.ts`, `review-panel.spec.ts` |
| Git & worktrees | `features/git` | `git-branch.spec.ts` |
| Tasks / todos | `features/tasks` | `tasks.spec.ts` |
| Automations | `features/automations` | (none — say so) |
| Viewers & preview | `features/viewers`, `features/preview` | `viewers.spec.ts`, `preview.spec.ts` |
| Daemon picker & connection | `features/daemon`, `app/ConnectionOverlay.tsx` | `daemon-picker.spec.ts` |
| Settings, skills & tour | `features/settings`, `features/skills`, `features/tour` | `settings.spec.ts`, `sidebar-chrome.spec.ts` |
| Terminal, run & URL tabs | `features/terminal`, `features/run`, `features/url-tab` | (none — say so) |

Every spec filename mentioned anywhere in the document must exist in `packages/e2e/tests-tauri/`; the
numbered scheme (`19-todos.spec.ts`, `14-editor.spec.ts`, …) is gone. Where a surface has no spec, say
"no spec" rather than naming a plausible-looking file. Update the closing "Recommended authoring order"
against the new sections. Prose follows the `writing-clearly-and-concisely` skill: concrete, active,
no puffery.

**Verify:**
- `grep -oE '[0-9a-z-]+\.spec\.ts' packages/e2e/FLOW-MAP.md | sort -u` — pipe each name through
  `ls packages/e2e/tests-tauri/<name>`; every one resolves.
- `grep -n 'STALE\|app-electron\|chat-session-bar\|answer-pill\|chat-header-\|inspector-pane' packages/e2e/FLOW-MAP.md`
  returns nothing.
- Every backticked testid in the file resolves: for each, `grep -rq` it in `packages/ui/src` excluding
  test files (templated families matched by prefix).
- The five starred sections are present.

### 8. Repoint and banner `COVERAGE-GAPS.md`

**File:** `packages/e2e/COVERAGE-GAPS.md`

This is the hand-authored triage companion. It is not regenerated in this pass, so it gets an accurate
staleness banner instead of reading as current — and one real fix.

- Replace the `## How to regenerate the raw list` body (`node /tmp/testid-gap.mjs`) with
  `pnpm --filter @qlan-ro/mainframe-e2e run testids` and a note that `testids:check` verifies the
  committed files are current. This is the `/tmp` leftover the brief calls out; fixing it here rather
  than deferring satisfies the no-leftovers rule.
- Add a dated banner under the title stating that the triage buckets below were written on 2026-05-31
  against the pre-v2 tree, that the id counts they quote no longer match `UNUSED-TESTIDS.md`, and that
  re-triaging the refreshed inventory is separate work.
- Update the header's "the 164 unused test-ids" figure to reference `UNUSED-TESTIDS.md` as the live
  source rather than quoting a stale number.

Do **not** re-triage the buckets and do **not** open follow-up todos for the gaps the refreshed
inventory reveals — explicitly out of scope per the brief.

**Verify:** the file's regeneration command matches the package script exactly (`grep -n 'testids'
packages/e2e/COVERAGE-GAPS.md`), no `/tmp` reference remains, and the banner names 2026-08-11 as the
date the inventory moved past it.

### 9. Wire the generator's unit tests into CI

**File:** `.github/workflows/ci.yml`

Add a third entry to the existing `test` job matrix (which today has `ui` and `types`):

```yaml
          - name: e2e-tools
            command: pnpm --filter @qlan-ro/mainframe-e2e run test:tools
```

The root `test` script excludes `@qlan-ro/mainframe-e2e` (its `test` script is Playwright), so without
this the generator's tests never run anywhere. Do **not** add `testids:check` to CI: the inventory
legitimately changes whenever a UI testid is added, and gating on it would fail unrelated PRs.

**Verify:** `node -e "const y=require('node:fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!y.includes('e2e-tools')) process.exit(1)"`
and the matrix block still parses as valid YAML (`npx --yes yaml-lint .github/workflows/ci.yml`, or
push and read the Actions run). Confirm `pnpm --filter @qlan-ro/mainframe-e2e run test:tools` passes
locally — that is the exact command CI runs.

### 10. Changeset and final verification

**Files:** `.changeset/<generated>.md`

Run `pnpm changeset`, select **only** `@qlan-ro/mainframe-e2e`, bump **patch**. A script lands in that
package, so the brief's `--empty` fallback does not apply. `@qlan-ro/mainframe-e2e` is not in the
changeset `fixed` group (types + ui only) and private packages are configured `tag: false`, so this
bump cannot produce the "Tag exists" failure mode.

**Verify, in this order:**
1. `pnpm --filter @qlan-ro/mainframe-e2e run test:tools` — green.
2. `pnpm --filter @qlan-ro/mainframe-e2e run testids:check` — exit 0 (committed artifacts current).
3. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — unaffected but confirms nothing in `packages/ui`
   was touched.
4. `npx prettier --check .` — passes (Markdown is ignored; the `.mjs` files are not).
5. `pnpm changeset status --since=origin/main` — reports the pending patch.
6. `git status --short` — only the files listed in the "Files touched" table appear.
7. Read all four e2e Markdown files once end to end: no STALE banner on `UNUSED-TESTIDS.md`,
   `COVERAGE-GAP-REPORT.md` or `FLOW-MAP.md`; the dated banner present on `COVERAGE-GAPS.md`; no
   mention of `app-electron`, `packages/core`, or numbered spec filenames anywhere.

Do **not** run the Playwright suite for this change — nothing under `tests-tauri/` is modified.

---

## Decisions

1. **The gap report is folded in; the triage doc is bannered.** The brief's Decisions section
   recommends exactly this as an explicit scope extension, and the report is the same mechanical diff
   read in the other direction (referenced − defined = dead selectors), so one scan serves both. Its
   stale hand-written narrative is dropped rather than regenerated.
2. **The generator is plain ESM `.mjs`, not TypeScript.** `packages/e2e` has no `typecheck` or `lint`
   script, so a `.ts` generator would need a build step or a runner to be "covered by the package's
   existing checks". `.mjs` on Node 24 runs directly and is covered by `node:test` instead — with a CI
   matrix entry (task 9) so it actually runs.
3. **Byte-for-byte reproducibility is achieved by preserving the recorded date.** The generator reads
   the date back from the file it is about to overwrite unless `--today` or `--date=` is passed. A
   generator that stamped `new Date()` unconditionally could never satisfy "running it on a clean
   checkout leaves the committed file unchanged".
4. **The 300-line file cap governs code, not generated Markdown.** The refreshed inventory will run to
   several hundred lines (≈770 definitions scanned); that is the artifact's purpose. The generator
   itself is split across four modules to stay under the cap.
5. **No prettier chaining.** `.prettierignore` lists `*.md`, verified against the current tree — the
   generated Markdown is never reformatted, so there is no formatter/`--check` conflict to design
   around.
6. **`testids:check` is not a CI gate.** It would fail every unrelated PR that adds a UI testid. The
   check exists for the author of this change and for anyone regenerating deliberately.
7. **No follow-up todos for revealed gaps, and no re-adding retired-surface ids.** Both are explicitly
   out of scope in the brief; the audit step in task 6 asserts their absence as the correct outcome.

## Risks

- **Regex-based extraction has a false-negative tail.** Testids assembled from constants
  (``{`${PREFIX[surface]}-unlink-${n}`}``) carry no matchable literal and are dropped by design (rule 6).
  The inventory's existing caveat prose already frames the numbers as directional; task 6's spot-checks
  bound the error rather than eliminating it.
- **Task 7 is the only genuinely large piece of judgement work** — roughly 16 surface sections read from
  source. It is one file, so it cannot be parallelized; if it runs long, cut depth per section before
  cutting sections, since the brief's acceptance criterion is coverage of the current surfaces.
- **`analyze`'s `dead` list may surface real broken selectors in live specs.** Reporting them is the
  point; repairing them is out of scope (the brief excludes writing or repairing tests). Leave them in
  the report.
