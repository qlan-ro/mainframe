# Todo #243 addendum — Browse/Installed tabs and the manifest parse fix

Delta plan folded into PR #563, on top of
`docs/plans/2026-08-01-todo-243-skills-management-ui-plan.md`. It does three things: fixes a
confirmed bug that makes the installed list always empty, replaces the section's project/global
switcher with Browse and Installed tabs, and gives Browse a real catalog to browse.

The base plan stands except where a step below supersedes it. The spec's
`declined — Browsing, searching, inspecting` line is overturned by user decision on 2026-08-03
and is amended in the spec's Revision section, not silently ignored.

## Why

Three findings, in the order they were established.

**1. The installed manifest never parses.** `run.rs`'s `captured_output` concatenates the child's
stdout and stderr into one string, and `manifest.rs`'s `parse_entries` hands that whole string to
`serde_json::from_str`. When the `skills` executable is absent, `resolve.rs` falls back to
`npx skills`, and `npx` writes `npm warn Unknown project config …` to stderr. The concatenated
string is therefore not valid JSON, the parse fails, and the route returns `entries: []` while the
host has skills installed. Reproduced against the running daemon: `GET …/skills-cli/manifest`
returned an empty list while `npx skills list --json --global` on the same host listed 20+ real
entries. `probe_parse.rs` scans line by line and is unaffected.

**2. `skills find` is a thin wrapper over a public HTTP API.** `vercel-labs/skills`'s `src/find.ts`
calls `GET https://skills.sh/api/search?q=<query>&limit=<n>` — unauthenticated, plain JSON,
returning `{id, skillId, name, installs, source}` per skill. Discovery does not need the CLI at
all, and routing it through the CLI would inherit exactly the stdout-parsing fragility that
produced finding 1.

**3. The skills.sh homepage server-renders its entire ranked catalog.** `https://www.skills.sh/`
(the apex 308-redirects to `www`) embeds an `initialSkills` array in the flight payload of its
`SkillsLeaderboardBySource` component: **600 skills, pre-sorted by installs descending, across 90
sources**, each with `source`, `skillId`, `name`, `installs`, `weeklyInstalls` (an 8-point weekly
sparkline) and `isOfficial` (present on 157 entries; omitted rather than `false`). No `/api/*`
endpoint serves this — every guess 404s on both hosts — so the Trending and Hot tabs are almost
certainly server actions and are out of reach. All-time ranking is what is reachable.

## Decisions

1. **Search always goes to `/api/search`; the catalog is only the default list.** `hard-to-reverse`
   — user ruling. Filtering the cached 600 locally would silently cap discovery at the leaderboard,
   and the search index covers more than 600 skills. The catalog answers "what should I look at",
   the API answers "find me this".
2. **Browse shows the top 50 of the catalog before any query.** `reversible` — user ruling. 600
   rows is a scroll, not a browse.
3. **Both remote calls are proxied by the daemon, never made from the renderer.**
   `hard-to-reverse` — the renderer runs under the Tauri webview CSP, a remote daemon's host is the
   one that should reach the registry, and every other skills call in this feature is already
   daemon-side. A direct fetch would need a CSP `connect-src` grant and would break CORS-first.
4. **Catalog extraction is a scrape with a typed fallback, not a contract.** `reversible` — the
   payload is an implementation detail of someone else's Next.js page. The parser lives behind a
   fixture-backed unit test, a failed extraction logs and returns an `unavailable` status, and
   Browse degrades to search-only rather than erroring. The fragility stays server-side.
5. **The catalog is cached in daemon memory with a 6h TTL, keyed by nothing.** `reversible` — it is
   global, not per project or per daemon-client. One fetch serves every project.
6. **The source-and-probe install path survives, as a secondary affordance inside Browse.**
   `reversible` — it is the only way to install from a private, unlisted or self-hosted repository,
   which the registry cannot offer. Dropping it would be a capability regression disguised as a
   redesign.
7. **Scope moves from a top-level switcher to a control on the install action.** `reversible` —
   Browse and Installed take the tab slot; you choose where a skill lands at the moment you install
   it, which is also where the choice is meaningful.
8. **`weeklyInstalls` is carried through the wire contract but not rendered in this pass.**
   `reversible` — the sparkline is the least load-bearing column in the screenshot and the row is
   already dense; carrying the field costs nothing and avoids a second contract change if we add it.

## Steps

### Step 1 — Split stdout from stderr in the runner

`packages/core-rs/crates/mainframe-server/src/skills_cli/run.rs`, `mod.rs`.

- Give `CliOutcome` separate `stdout` and `stderr` fields in place of `output`. `captured_output`
  returns the pair instead of concatenating.
- `map_outcome` returns the ANSI-stripped **stdout** on a clean exit. On failure it keeps building
  the tail from stdout **and** stderr joined — a diagnostic tail that dropped stderr would lose the
  actual error text.
- Update the four `mod.rs` call sites and the fake runner in the Rust tests to the new shape.

Test (`tests/skills_cli_unit.rs`): a fake outcome whose stderr carries three
`npm warn Unknown project config` lines and whose stdout carries a valid `list --json` array parses
to the full entry list. This test fails on the current code.

### Step 2 — Catalog fetch, parse and cache

New `packages/core-rs/crates/mainframe-server/src/skills_cli/catalog.rs` (< 300 lines; split the
parser into `catalog_parse.rs` if it approaches it).

- `fetch_catalog()` — `reqwest` GET `https://www.skills.sh/` with redirect-follow, a bounded
  timeout (10s) and a capped response body. `reqwest` is already a workspace dependency with
  `rustls-tls` and `json`.
- `extract_initial_skills(html) -> Result<Vec<CatalogEntry>>` — locate the `initialSkills` key in
  the escaped flight payload, unescape, then take the array by **bracket-matched scan, not a
  regex**, and `serde_json` it into typed entries. `isOfficial` deserializes as
  `#[serde(default)] bool` since it is omitted rather than `false`.
- In-memory cache behind the existing server state: `(fetched_at, Vec<CatalogEntry>)` with a 6h TTL
  and single-flight so concurrent opens do not fan out duplicate fetches.
- Every failure path logs via `tracing` and surfaces as `status: "unavailable"`. No silent catch.

Tests: a checked-in fixture of the real payload (trimmed to a few entries) parses to the expected
typed values including a missing `isOfficial`; a payload with no `initialSkills` key returns the
unavailable outcome rather than panicking or returning an empty success.

### Step 3 — Catalog and search routes

`packages/core-rs/crates/mainframe-server/src/routes/skills_cli.rs`, `routes/mod.rs`, `http.rs`.

- `GET /api/skills-cli/catalog` → `{ status: "available", entries: [...] }` or
  `{ status: "unavailable" }`. Not project-scoped: the catalog is global. Serves from cache.
- `GET /api/skills-cli/search?q=<query>` → proxies
  `https://skills.sh/api/search?q=<query>&limit=50`, returning the normalized entry shape. Rejects
  a query under 2 characters with a 400 before making any request — the upstream rejects it anyway
  and there is no reason to spend the round trip.
- Both return the standard `ok`/`fail` envelope, consistent with the four existing routes.

Tests: the search route rejects a 1-character query without an outbound call; the catalog route
returns the unavailable outcome when the fetcher fails.

### Step 4 — Wire contract

`packages/types/src/skills-cli.ts`.

- `SkillsCatalogEntrySchema` — `source`, `skillId`, `name`, `installs`, `weeklyInstalls`
  (`z.array(z.number()).nullish()`), `isOfficial` (`z.boolean().default(false)`).
- `SkillsCatalogSchema` — the `available` / `unavailable` discriminated union, matching the shape
  `SkillsCliManifestSchema` already uses.
- `SkillsSearchResultSchema` — the search row; the same entry shape minus `weeklyInstalls`, which
  the search API does not return.
- Keep the file's existing convention: `.loose()` on object schemas, `.nullish()` on anything the
  daemon may serialize as `null`.

Then `pnpm --filter @qlan-ro/mainframe-types build`.

### Step 5 — API client

`packages/ui/src/lib/api/skills-cli.ts` — add `getSkillsCatalog()` and `searchSkills(query)`
alongside the four existing wrappers, parsing through the new schemas. Unit-test both against the
existing test file's idiom.

### Step 6 — Browse store

New `packages/ui/src/features/setup-advisor/skills/use-skills-browse-store.ts`.

- State: `catalog`, `catalogStatus`, `query`, `results`, `searchStatus`, `searchError`.
- Catalog loads once per section mount; search debounces at 250ms and fires only at ≥2 characters.
- A module-level `_searchSeq` guard drops stale completions, matching the `_loadSeq`/`_probeSeq`
  idiom already in `use-skills-cli-store.ts`.
- Below 2 characters the store shows the catalog's top 50; at or above, it shows search results.
  The two lists never merge — which one is on screen is always unambiguous.

### Step 7 — Browse UI

New under `packages/ui/src/features/setup-advisor/skills/`:

- `BrowseTab.tsx` — search input, result list, empty and error states.
- `BrowseRow.tsx` — name, source, formatted install count (`2.8M` / `733.3K`, matching the
  registry's own formatting), an official marker, and an Install control carrying the scope choice.
- `ScopeChoice.tsx` — the project/global control, relocated out of the old install band.

Reuse `ManifestRow`'s row recipe rather than inventing a second one. Read the
`mainframe-design-system` skill before writing any markup or class names — it is mandatory for
`packages/ui` work and this section renders chips on the shared `CHIP_BASE` recipe.

`data-testid` on every interactive element, `<surface>-<element>` kebab-case, keyed by the skill's
`source`+`skillId`, never an array index: `skills-browse-search`, `skills-browse-row-<source>-<id>`,
`skills-browse-install-<source>-<id>`, `skills-browse-scope`.

### Step 8 — Restructure the section

`SkillsSection.tsx`, `InstallBand.tsx`.

- Two tabs, Browse and Installed, Browse default. Installed keeps today's `ManifestBody` unchanged.
- The install band loses its scope pair (now per-row in Browse) and becomes a secondary
  "install from a source" affordance inside Browse for repositories the registry does not list.
- `CliUnavailable` still replaces the whole section — with no CLI there is nothing to install *to*,
  so browsing would be a dead end.
- Keep `SkillsSection.tsx` under 300 lines; if the tab shell pushes it over, extract the shell.

### Step 9 — Tests

Per the repo's single-file rule
(`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` — batches hit cross-file `React.act`
failures). Delegate authoring to the test-writer agent.

- `BrowseTab.catalog.test.tsx` — top 50 render from a fixture; the 51st is absent.
- `BrowseTab.search.test.tsx` — typing ≥2 chars queries the API and renders its results; a result
  outside the catalog is reachable, which is the whole point of decision 1.
- `BrowseTab.catalog-unavailable.test.tsx` — an unavailable catalog degrades to search-only with no
  error surface.
- `BrowseTab.install.test.tsx` — install from a row passes that row's source, skill and scope.
- `SkillsSection.tabs.test.tsx` — tab switching; Installed still renders the manifest.
- Update the existing `SkillsSection.*` tests that assert the old scope switcher.

Rust: `cargo test -p mainframe-server`.

### Step 10 — Docs and changeset

- Amend the spec with a `## Revision — 2026-08-03` section: overturn the declined browsing line,
  record the new behavior, and add acceptance criteria for the parse fix, the catalog fallback and
  search reachability. Do not rewrite the original text — the record of what was decided when is
  worth keeping.
- Note in the base plan that steps touching the install band's scope control are superseded here.
- `pnpm changeset` — minor on `@qlan-ro/mainframe-ui`, `@qlan-ro/mainframe-types` and the daemon.

## Verification

- `cargo test -p mainframe-server`
- Each touched UI test file run individually
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` (it includes tests, unlike the build)
- Live: the installed list is non-empty on a host with skills installed, which it is not today
- Every touched file under 300 lines, every function under 50

## Risks

- **The scrape breaks.** Mitigated by decision 4: fixture-backed parser test, typed unavailable
  outcome, search-only degradation. It will break eventually; it should not take the panel with it.
- **The registry rate-limits the proxy.** The 6h catalog cache makes catalog traffic negligible.
  Search is debounced and user-driven, matching what the CLI itself does per keystroke.
- **Install counts go stale within the TTL.** Acceptable — they are a popularity signal, not data.
