# Setup Advisor — project automation recommender

Source: todo #191 (route:full). Design gate approved 2026-07-25 — **variant B, sheet with
category tabs** (`proto/design-gates` @ `cee842ef`,
`?prototype=automation-recommender&variant=B`). Variants A (full page), C (setup score),
and D (side panel) were rejected; this spec does not re-open that decision.

## Problem

Mainframe tracks projects and orchestrates CLI agents, but offers no guidance on which
agent automations a project should have. The knowledge exists as Anthropic's
`claude-automation-recommender` skill (claude-code-setup plugin v1.0.0) — prose usable
only inside a live Claude session, and Claude-only. Mainframe wants the same advice as a
product surface: project-level, on demand, adapter-aware by data, and independent of any
running session.

## Solution

A read-only **Setup Advisor**: the daemon fingerprints a project root (manifests,
dependencies, config presence, directory structure, git remote host), maps the detected
signals through a static rules dataset to recommendations in five categories (MCP
servers, skills, hooks, subagents, plugins), and the UI presents them in a dismissable
sheet with one tab per detected category. Every recommendation names the concrete signal
that produced it and carries a copyable install/create command. The feature never writes
to the project and never executes a command — copying is the entire action surface.

The fingerprint engine is a standalone daemon module with its own interface: todo #192
(CLAUDE.md onboarding) will consume `fingerprint()` later, so its API must not assume
the recommender is the caller.

## Brief-vs-code corrections

The approved brief predates the Rust daemon cutover (PR #510). Three claims are stale;
this spec supersedes them:

1. **"Route exists in both Node and Rust daemons (canary parity)"** — the Node daemon is
   retired. The route and engine ship in the Rust daemon only
   (`packages/core-rs`). There is no canary and no Node arm.
2. **"Core recommender module in `@qlan-ro/mainframe-core`"** — that package is orphaned.
   The engine lives in the Rust daemon (see Placement). The canonical **TypeScript
   types** still ship in `@qlan-ro/mainframe-types` as the UI-side contract.
3. **"Skill vendored under `docs/adapters/claude/automation-recommender/`"** — that
   folder does not exist anywhere in the repo or its history. The skill bundle exists
   locally at
   `~/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/skills/claude-automation-recommender/`
   (SKILL.md + 5 reference files, 1,463 lines). We do **not** vendor it (see Decision
   9): the bundle is Apache-2.0 prose in an MIT repo, and it does not actually contain
   the install commands — it supplies detection→recommendation *mappings* and tells the
   reader to web-search for specifics. Each rules-dataset file instead carries a header
   citing the plugin name, version, and source reference file, and each rule records
   where its `command` string was verified (see Rules dataset).

## Scope

- Shared types: `ProjectFingerprint`, `AutomationRecommendation`,
  `RecommendationCategory` in `@qlan-ro/mainframe-types`.
- Daemon: `fingerprint()` + rules dataset + `recommend()` as a pure, unit-tested module;
  one new GET route.
- UI: toolbar entry point + the approved variant-B sheet in `packages/ui`.

Mainframe already owns a skills/agents management domain (`packages/types/src/skill.ts`,
`packages/ui/src/features/skills/`, `lib/api/skills.ts`). The `skills` and `subagents`
recommendation categories overlap it only as advice text; the deferred apply follow-up
must build on that existing surface rather than reinvent it.

## Non-goals

- One-click apply / scaffolding `.claude/` config, `.mcp.json`, hooks, agents, or
  skills (follow-up todo).
- Executing or vendoring the skills CLI; any shelling out to `npx`.
- Web-search enrichment of the rules dataset.
- Adapter-based filtering UI (only the data field ships now).
- Auto-trigger on project add; scheduling or re-scan UI.
- Scoring, setup grades, or per-recommendation dismiss/snooze (rejected at the design
  gate — variant C).
- Caching or persisting fingerprints/recommendations; every open re-runs the analysis.
- Anything from #192 beyond keeping `fingerprint()` consumable by it.

## Contract

### Types (`@qlan-ro/mainframe-types`, new file `src/setup-advisor.ts` + barrel export)

Named `setup-advisor.ts` to avoid colliding with the existing `automation.ts` /
`automation-domain/` (the Automations v2 feature — an unrelated domain).

```ts
export type RecommendationCategory = 'mcp' | 'skills' | 'hooks' | 'subagents' | 'plugins';

export interface AutomationRecommendation {
  /** Stable kebab-case rule id, e.g. "mcp-supabase". Used in testids. */
  id: string;
  category: RecommendationCategory;
  title: string;
  /** The concrete detected evidence, e.g. "@supabase/supabase-js in package.json". */
  signal: string;
  /** One line: what the automation buys you, phrased off the signal. */
  why: string;
  /**
   * Copyable install/create text. Usually a single shell command
   * (`claude mcp add …`, `npx skills add …`). May be multi-line for
   * config-snippet recommendations (hooks); the UI renders the first line
   * truncated and copies the full text.
   * INVARIANT: a constant per rule — no fingerprint-derived substring ever
   * enters it. Fingerprint content (dependency names, git remote URLs) is
   * attacker-controlled for any cloned repo, and this string feeds a shell.
   */
  command: string;
  /** Where the artifact lives once created, e.g. ".claude/settings.json". */
  targetPath?: string;
  /** Adapter ids this applies to; ["*"] = any adapter. Enables later filtering as a data change. */
  adapters: string[];
}

export interface ProjectFingerprint {
  languages: string[];      // e.g. ["typescript"]
  frameworks: string[];     // e.g. ["react", "nextjs"]
  databases: string[];      // e.g. ["postgres", "supabase", "prisma"]
  externalApis: string[];   // e.g. ["stripe", "aws", "sentry", "anthropic", "openai"]
  testing: string[];        // e.g. ["jest", "playwright", "pytest"]
  tooling: string[];        // e.g. ["prettier", "eslint", "ruff", "tsconfig", "docker"]
  gitHost: 'github' | 'gitlab' | 'other' | null;
  hasClaudeConfig: boolean; // .claude/ or CLAUDE.md present (no MVP rule consumes it; detected for #192)
  hasEnvFiles: boolean;     // .env* present
  hasLockFiles: boolean;
  dirs: string[];           // detected of: src, app, components, tests, api
  fileCount: number;        // bounded approximation (see engine)
  /** Human-readable evidence chips, e.g. "TypeScript", "Next.js". */
  signals: string[];
}

export interface SetupAdvisorReport {
  fingerprint: ProjectFingerprint;
  /** Ordered: canonical category order (mcp, skills, hooks, subagents, plugins), then rule priority within a category. */
  recommendations: AutomationRecommendation[];
}
```

`signal` and `why` are display-only strings: the UI renders them as text (truncated,
newline-stripped), never interpolates them into commands, markup, or paths.

The Rust structs mirror these in `mainframe-types` (new `setup_advisor.rs` module —
precedent: `mainframe_types::suggestion::Suggestion`), serde
`rename_all = "camelCase"`.

The route is additive to the daemon contract; nothing existing changes, so the
mobile-co-owned contract is safe.

### Route (Rust daemon, `mainframe-server`)

`GET /api/projects/{id}/automation-recommendations` (Axum 0.8 `{id}` path syntax, as
in `routes/projects.rs`)

- **200** — `ok(SetupAdvisorReport)` (`{"success":true,"data":…}`).
- **404** — `fail(NOT_FOUND, "Project not found")` for an unknown project id (matches
  `projects::get_one`).
- **404** — `fail(NOT_FOUND, "Project path not found")` when the registered path no
  longer exists or is not a directory.
- **500** — `internal_error` envelope for unexpected fs/db failures.

Input surface is the `{id}` path param only (no body, no query). Validation = the
project lookup itself; the project's registered path is the trust boundary — the engine
never reads outside it (symlink containment via `path_utils::is_within_base`, see
Fingerprint engine). This satisfies
the "validate every endpoint" rule; there is no Zod because the daemon is Rust — serde
typing plus the lookup is the equivalent.

No WS events: the feature is a request/response read.

## Fingerprint engine

### Placement

A standalone module in the Rust daemon —
`packages/core-rs/crates/mainframe-server/src/setup_advisor/` (`fingerprint.rs`,
`recommend.rs`, `rules/` split per category, each file under 300 lines) — with
`fingerprint(root: &Path) -> ProjectFingerprint` and
`recommend(&ProjectFingerprint) -> Vec<AutomationRecommendation>` as pure public
functions; the route handler stays thin. Precedent: the closest existing feature, the
bounded read-only project scan behind `GET /api/projects/{id}/suggestions`, keeps its
pure logic in `mainframe-server/src/suggestions/`. `mainframe-services` was
considered and rejected: the helpers this module reuses —
`fs_utils::IGNORED_DIRS` and the symlink-contained `path_utils::is_within_base` —
live in `mainframe-server`, and `mainframe-server` already depends on
`mainframe-services`, so placing the engine lower would require either a dependency
cycle or moving `fs_utils` (which drags `mainframe_git` with it) down a crate.

Note `fs_utils`' *primary* file-listing path shells out to `git ls-files`; this
module must use the contained-walk fallback pattern only — no subprocess (hard
constraint below). #192, also a daemon feature, imports `fingerprint()` from
`mainframe-server` the same way `routes::suggestions` imports `suggestions::`;
nothing in its signature may reference recommendations.

### Behavior

`fingerprint()` is async-fs, read-only, and bounded:

- **Manifests**: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`
  at the root → `languages`.
- **Dependencies**: names from `package.json` (`dependencies` + `devDependencies`) and
  `pyproject.toml` → `frameworks`, `databases`, `externalApis`, `testing`. Detected
  names include at least: react, vue, angular, next, express, fastapi, django, prisma,
  drizzle, `@supabase/*`, convex, pg/postgres, stripe, `@aws-sdk/*`, `@sentry/*`,
  `@anthropic-ai/sdk`, langchain, openai, jest, vitest, playwright, pytest, and the
  auth libraries next-auth, `@clerk/*`, `@auth0/*`, passport (→ `externalApis`, so
  the security-reviewer rule has evidence to cite).
- **Config presence**: `.prettierrc*`, `eslint.config.*`/`.eslintrc*`, `ruff.toml`,
  `tsconfig.json`, jest/pytest config, `docker-compose.yml`/`Dockerfile`, `.env*`,
  lock files → `tooling`, `hasEnvFiles`, `hasLockFiles`.
- **Claude config**: `.claude/` dir or `CLAUDE.md` → `hasClaudeConfig`.
- **Directory structure**: presence of `src/`, `app/`, `components/`, `tests/`, `api/`
  → `dirs`.
- **Git host**: parse the `origin` remote from `.git/config` (read-only; no git
  subprocess needed) → `gitHost` (`github` / `gitlab` / `other` / `null` when no repo
  or no remote). Linked worktrees, where `.git` is a `gitdir:` pointer file whose
  target lies outside the project root, return `gitHost: null` — the engine does not
  follow `gitdir` (worktree projects exist: `Project` rows carry
  `parent_project_id`).
- **File count**: a bounded walk reusing `fs_utils::IGNORED_DIRS` (`node_modules`,
  `.git`, `target`, `dist`, …) and symlink containment via
  `path_utils::is_within_base`. That helper compares *already-canonicalized* paths
  (`real_base`/`real_target`), so the walk must realpath each entry before the check
  — as `fs_utils` does — or containment silently passes for everything (the exact
  search-fallback bug fixed in #371). Entries resolving outside the project root are
  neither counted nor read. Capped at 5,000 entries; `fileCount` is the capped
  count. This feeds the "large codebase" subagent rule (threshold: >500 files).
- **Signals**: every positive detection contributes one human-readable chip to
  `signals` (e.g. "TypeScript", "Next.js", "Supabase", "Prettier", "GitHub remote").
  Chip count is what the UI shows in "What we detected ({n})".

Hard constraints: no writes anywhere; no process execution; no reads outside the
project root; malformed manifests (bad JSON/TOML) are skipped, never fatal. The route
must respond in under 2 seconds on a repo the size of Mainframe itself.

## Rules dataset and `recommend()`

The dataset is **data, not code branching**: each rule declares `id`, `category`, a
predicate over `ProjectFingerprint` fields, `title`, `signal` (evidence template —
templates fill the display-only `signal`/`why` strings, never `command`, which is a
constant), `why`, `command`, optional `targetPath`, `adapters`, and a `priority` rank.

**Command provenance.** The upstream skill bundle supplies the detection→
recommendation *mappings* and rationale only — verified: its 1,463 lines contain one
`claude mcp add` example and zero `npx skills add` strings; the references say "use
web search" for specifics. So every `command` in the dataset is transcribed from the
recommended tool's own documentation, verified to be well-formed at implementation
time, and its source recorded in a comment beside the rule. Each rules file's header
cites the upstream plugin (claude-code-setup v1.0.0) and the reference file its
mappings were lifted from.

The category mappings:

- **MCP servers** (`adapters: ["*"]`): any detected framework (`frameworks`
  non-empty) → context7; React/Vue/Next → Playwright; `@supabase/*` → Supabase;
  convex → Convex; pg/postgres → Postgres; GitHub remote → GitHub; `@aws-sdk/*` →
  AWS; `@sentry/*` → Sentry; docker tooling → Docker. Commands are `claude mcp add …`
  strings (provenance rule above).
- **Skills** (`adapters: ["*"]` — skills.sh is cross-agent): detected signals →
  skills.sh registry entries surfaced as `npx skills add <source>`. Every registry
  source shipped in the dataset **must be verified to exist on skills.sh at
  implementation time** — the prototype fixtures' sources are illustrative, not
  verified. Where no real registry entry exists for a signal, fall back to the
  custom-skill scaffolds from the upstream bundle's `references/skills-reference.md`
  (api-doc, create-migration, gen-test, new-component, pr-check, release-notes,
  project-conventions): `command` is the SKILL.md frontmatter snippet and `targetPath`
  is `.claude/skills/<name>/SKILL.md`. These snippets are the one exception to the
  Command provenance rule — they have no tool documentation to transcribe from; their
  recorded source is the (unvendored) upstream reference file, transcribed at
  implementation time from the plugin cache.
- **Hooks** (`adapters: ["claude"]`): `tooling` contains prettier → format-on-edit;
  eslint or ruff → lint-on-edit; tsconfig → typecheck-on-edit; `dirs` contains tests
  → run-related-tests; `hasEnvFiles`/`hasLockFiles` → block-edits. The reference file
  carries no usable snippets, so `command` is a hand-authored `settings.json` hooks
  snippet (may be multi-line) validated against the Claude Code hooks documentation;
  `targetPath` is `.claude/settings.json`.
- **Subagents** (`adapters: ["claude"]`): `fileCount` > 500 → code-reviewer;
  `externalApis` intersects {stripe, next-auth, clerk, auth0, passport} →
  security-reviewer; `languages` non-empty with empty `testing` and no `tests` dir →
  test-writer; `dirs` contains api or a backend framework detected →
  api-documenter; `databases` non-empty → performance-analyzer; a frontend framework
  detected → ui-reviewer. `targetPath` is `.claude/agents/<name>.md`.
- **Plugins** (`adapters: ["claude"]`): frontend framework → frontend-design;
  `gitHost` non-null → pr-review-toolkit / commit-commands; any hooks-rule signal
  (`tooling` contains prettier, eslint, ruff, or tsconfig) → hookify; detected
  language → `<lang>-lsp`.

Every predicate above is stated over declared `ProjectFingerprint` fields; a rule
whose evidence the fingerprint cannot express does not ship.

`recommend()` behavior:

- Evaluates all rules against the fingerprint; a rule fires only when its predicate's
  signal is actually present — **no padding, ever**.
- Orders each category by `priority` and returns at most **2 recommendations per
  category** (the skill's "top 1–2, don't overwhelm" guideline; "3–5 on request" is
  out of scope with no per-category expand UI).
- A category with no firing rule contributes nothing (the UI then renders no tab).
- Output is deterministic for a given fingerprint.
- Every returned `signal` names concrete evidence ("`.prettierrc` at the repo root"),
  never a vague claim.

## UI

Feature directory: `packages/ui/src/features/setup-advisor/`. Follows the
`TasksModalHost` pattern: a feature-local zustand store, a host component mounted in
`AppShell`'s overlay block, project identity from `useActiveIdentity()` (in the host —
`MainToolbar` receives `projectId` as a prop and gates the button on it), daemon call
via a new `lib/api/setup-advisor.ts` using the shared `request<T>` wrapper.

Store shape: `open`, `reportProjectId` + `report`, `copiedByProject`. The report is
bound to the project it was fetched for: on `projectId` change while open, drop the
report and refetch; responses for a project other than the current one are ignored
(fetch-sequence guard — the `_loadSeq` pattern `useTodosStore` needed for the same
race). The header must never name project B over project A's rows. The footer's
`done` is the size of the intersection of the project's copied ids with the *current*
report's recommendation ids, so a stale copied id can never yield `3 of 2 copied`.

### Entry point

One trigger: an icon button in `MainToolbar`'s right group — `ScanSearch` icon,
`Hint` tooltip "Setup Advisor", testid `automation-recommender-open`. Rendered only
when a project is active. Clicking opens the sheet and starts the fetch. No hotkey, no
auto-open, no project-context-menu entry in this pass.

### Sheet (approved design — variant B, verbatim)

Rendered with the shared Dialog primitive (`DialogContent hideClose` — the prop
exists — with the header text in `DialogTitle` for Radix a11y), content classed to
the approved sheet look: `rounded-xl border border-border bg-card shadow-2xl`,
`max-w-[640px]`, over the workspace. `bg-card shadow-2xl` intentionally overrides the
primitive's `bg-popover` + modal-shadow defaults. Dismissed by Esc or clicking
outside; no explicit close button (the advisor is "a moment, not a place"). Container
testid `automation-recommender-sheet`.

- **Header** — `ScanSearch size-4 text-muted-foreground` + "Setup Advisor" at
  `text-heading font-semibold`, project name appended in
  `font-normal text-muted-foreground`. The project name comes from
  `useActiveIdentity()` and renders immediately, including during loading.
- **Evidence disclosure** — a `text-caption text-muted-foreground` toggle
  (`ChevronRight`/`ChevronDown` `size-3`) reading `What we detected ({n})`, collapsed
  by default; expands to signal chips
  (`rounded-full border border-border bg-mf-glass px-2 py-0.5`). Testid
  `automation-recommender-evidence-toggle`. `{n}` = `fingerprint.signals.length`.
- **Tab strip** — one tab per category **with at least one recommendation** (order:
  mcp, skills, hooks, subagents, plugins; icons `Plug`/`Sparkles`/`Webhook`/`Bot`/
  `Puzzle`, `size-3.5`). Active tab `border-b-2 border-primary font-medium
  text-foreground`; inactive `border-transparent text-muted-foreground`. Testid
  `automation-recommender-tab-<category>`. **Every tab carries a count badge**
  (`rounded-full bg-muted px-1.5 tabular-nums`) — the tabs must not ship without the
  counts. A category with zero recommendations gets no tab. The first rendered tab is
  active on open.
- **Body** — `max-h-[380px] overflow-y-auto`, rows `divide-y divide-border/60`. Each
  recommendation: title `text-body font-medium`; then a one-line rationale leading
  with the triggering signal as a mono chip
  (`rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption`) followed by ` — ` and
  the why.
- **Command row** — `rounded-md border border-border bg-muted/40`, the command in
  `select-text font-mono text-caption truncate` (first line only when multi-line),
  and a copy button (`Copy`/`Check` `size-3`) that copies the **full** `command` text
  and flips to `bg-mf-success-tint text-mf-success` + "Copied". Testid
  `automation-recommender-copy-<recId>`.
- **Footer** — `border-t border-border`, left: *"Read-only — commands run in your
  terminal."*; right: `{done} of {total} copied`, `tabular-nums`, `text-mf-success`
  once `done > 0`. Hidden while loading and when `total` is 0.

All named `mf-*` tokens (`bg-mf-glass`, `text-mf-success`, `bg-mf-success-tint`) and
type utilities (`text-heading`, `text-body`, `text-caption`) exist in
`packages/ui/src/styles/globals.css` — verified, no phantom tokens.

### States

1. **Loading** — skeleton blocks (`animate-pulse rounded-md bg-muted`, testid
   `automation-recommender-loading`) where the tab strip and body will be, and the
   header line "Fingerprinting your project…". Never an empty state while loading.
2. **Loaded** — header + evidence + tabs + body + footer as above.
3. **Thin** — when `fingerprint.signals.length < 3`, the header carries a
   plain-language note under the evidence toggle: *"Recommendations are sparse because
   little was detected — there's genuinely not much to automate yet."* The list is
   never padded to look useful.
4. **Empty** — zero recommendations overall: no tab strip; the body shows *"No
   recommendations for this project yet."*; the thin note renders if its condition
   holds; footer counter hidden.
5. **Error** — fetch failed (network or fail envelope): body shows *"Couldn't analyze
   this project."* with the error string in `text-caption text-muted-foreground` and a
   Retry button (testid `automation-recommender-retry`) that re-issues the fetch.
   (The approved design omits failure; this is the minimal completion of it.)

### Honesty constraints (design gate, binding)

- **Copy-count is the only progress the app may claim.** The footer says "copied" —
  never "installed", "done", or "configured". No checkmarks against project state.
- **Read-only surface.** No install buttons, no writes, no MCP registration. The copy
  button is the entire action surface.
- Copied state lives in the feature store keyed by project id for the app session
  (survives close/reopen of the sheet; resets on app reload). Nothing is persisted.

### Data flow

Opening the sheet always re-fetches (no cache). Copying uses
`navigator.clipboard.writeText` via a small local helper (no shared clipboard hook
exists; do not create a cross-feature abstraction for one consumer). If the write
rejects, the button briefly shows "Copy failed" and reverts; the copied set and
footer counter do not change.

### Testids

| Element | data-testid |
|---|---|
| Toolbar button | `automation-recommender-open` |
| Sheet container | `automation-recommender-sheet` |
| Evidence toggle | `automation-recommender-evidence-toggle` |
| Category tab | `automation-recommender-tab-<category>` |
| Copy button | `automation-recommender-copy-<recId>` |
| Loading skeleton | `automation-recommender-loading` |
| Retry button | `automation-recommender-retry` |

## Decisions

Brief-recommended answers, adopted (evidence did not contradict them):

1. **Read-only MVP** — apply/scaffolding is a follow-up todo. The design gate hardened
   this: the command row is the entire action surface.
2. **No adapter filtering in MVP** — but `adapters: string[]` (`["*"]` = any) ships on
   the type from day one, so filtering later is a data change. MCP + skills rules ship
   `["*"]`; hooks/subagents/plugins ship `["claude"]`.
3. **On-demand only** — toolbar button; no auto-run on project add.
4. **Static rules dataset** — mappings lifted from the skill's reference tables,
   commands independently sourced per the Command provenance rule; no web-search
   enrichment.
5. **Command strings only** — no shelling out to or vendoring the skills CLI; moot for
   a read-only MVP.
6. **Build despite the claude-code-setup overlap** — the skill needs a live Claude
   session and is Claude-only; Mainframe wants project-level, in-app, adapter-aware
   advice. (Standing PM answer from the brief.)

Rulings made in this spec (no user gate — surface these):

7. **Rust-only engine and route** — the brief's Node-daemon/`mainframe-core` placement
   and canary-parity AC are stale after PR #510; there is no Node arm to be parallel
   to. Types stay in `@qlan-ro/mainframe-types`.
8. **Engine placement** — `mainframe-server/src/setup_advisor/`, following the
   `suggestions/` precedent for bounded read-only project scans. `mainframe-services`
   would need the `fs_utils`/`path_utils` helpers that live in `mainframe-server`
   (dependency cycle) or a helper relocation that drags `mainframe_git` down a crate.
   #192 imports from `mainframe-server` the same way `routes::suggestions` does.
9. **Do not vendor the skill bundle** — the brief assumed it was already vendored; it
   is not, and copying it would put 1,463 lines of Apache-2.0 prose (upstream ships a
   LICENSE) into this MIT repo for content that does not even contain the command
   strings we need. What we lift is the detection→recommendation mappings; provenance
   lives in rules-file headers (plugin + version + reference file) and per-rule
   command-source comments.
10. **Entry point** — a single `MainToolbar` icon button. The project-row context menu
    and hotkeys stay clean; more entry points can follow demand.
11. **Skills sources must be real** — every `npx skills add <source>` in the dataset is
    verified against skills.sh during implementation; unverifiable signals fall back to
    the reference custom-skill scaffolds. Prototype fixture sources are illustrative
    only.
12. **Multi-line commands** — `command` may be a config snippet (hooks); the row shows
    the first line truncated, copy copies everything. Keeps the approved command-row
    design without inventing a snippet viewer.
13. **Thin threshold** — fewer than 3 signals triggers the thin note. Exact copy in
    States; the prototype's per-project prose note becomes generic copy because the
    daemon should not compose UI prose.
14. **Empty and error states** — defined here (the design covered loading/loaded/thin
    only): empty body message, and an error body with retry. Minimal extensions, same
    visual language.
15. **Copy-state lifetime** — in-memory per project for the app session; not
    persisted. Mainframe never learns whether a command ran, so durable "progress"
    would be dishonest.
16. **No caching** — every open re-fingerprints. The scan is bounded and cheap; a
    cache would add staleness questions with no user benefit yet.
17. **Cap of 2 per category is a hard cap** — the skill's "3–5 when asked about one
    category" has no UI hook in this pass and is out of scope. Under this cap the
    mandatory tab count badges can only read 1 or 2; they ship anyway as the approved
    design's forward-compatible affordance for when the cap rises — recorded, not
    redesigned.
18. **Naming** — user-facing name "Setup Advisor"; the route and testids keep the
    `automation-recommender` prefix because the approved prototype's testids are part
    of the settled design gate; code directories/files use `setup-advisor` /
    `setup_advisor`. The types file is `setup-advisor.ts` to avoid colliding with the
    unrelated Automations v2 domain (`automation.ts`, `automation-domain/`).
19. **Hooks category stays in the MVP with hand-authored snippets** — the brief's
    acceptance criteria require all five categories, but the upstream reference file
    carries no usable format/lint/typecheck snippets; each hooks `command` is authored
    against the Claude Code hooks documentation and its source recorded.
20. **`command` is a constant per rule** — fingerprint content (dependency names,
    remote URLs) is attacker-controlled in any cloned repo and the copy button feeds
    a shell; no fingerprint-derived substring ever enters `command`, and
    `signal`/`why` are display-only.
21. **Report is bound to its project** — the store keys the report by project id,
    drops and refetches on project switch, ignores stale responses, and computes the
    footer counter as copied-ids ∩ current-report-ids, so the header, rows, and
    counter can never describe different projects.
22. **Worktree checkouts yield `gitHost: null`** — a linked worktree's `.git` is a
    `gitdir:` pointer to a path outside the project root, which the engine may not
    read; GitHub-remote rules simply do not fire there. Deliberate, not accidental.

## Acceptance criteria

Engine (Rust unit tests, fixture project trees, hardcoded expected values):

1. `fingerprint()` over a rich fixture (package.json with next/react/@supabase deps,
   `.prettierrc`, `tsconfig.json`, `docker-compose.yml`, `.env.example`, lock file,
   `tests/` dir, `.git/config` with a github origin) returns the expected
   `ProjectFingerprint` — languages, frameworks, databases, tooling, dirs, gitHost,
   hasEnvFiles, hasLockFiles, and the expected `signals` chips — asserted against
   hardcoded values.
2. `fingerprint()` over a near-empty fixture (single `main.py`, no manifest) returns a
   fingerprint whose `signals` length is under the thin threshold.
3. Over a fixture whose root contains a symlink to an out-of-root directory (holding
   a manifest and >10 files), `fingerprint()` counts none of the symlinked entries in
   `fileCount` and derives no signal from them; malformed
   `package.json`/`pyproject.toml` are tolerated without failing.
4. `recommend()` maps a representative fingerprint to expected recommendations in each
   of the five categories — each with the expected `id`, a `signal` naming the
   triggering evidence, a non-empty `why` and `command`, and correct `adapters` —
   asserted against hardcoded values. Skills entries use `npx skills add <source>`
   with sources that exist on skills.sh (verified at implementation time). Every
   shipped `command` has a recorded verified source beside its rule.
5. `recommend()` returns at most 2 recommendations per category, and a fingerprint
   with no signal for a category yields no recommendations in that category.
6. Over a fixture whose `package.json` contains a dependency named `; rm -rf ~`, no
   recommendation's `command` contains that substring (commands are rule constants;
   the malicious name may appear only in display-only `signal`/`why` text).

Route (Rust route test in `mainframe-server`):

7. `GET /api/projects/{id}/automation-recommendations` returns 200 with
   `{"success":true,"data":{fingerprint,recommendations}}` for a registered fixture
   project; 404 `{"success":false,"error":"Project not found"}` for an unknown id;
   404 with `"Project path not found"` when the registered path is missing.
8. The route responds in under 2 seconds against the Mainframe repo itself (manual
   check, not a CI assertion).

UI (vitest component tests in `packages/ui`):

9. The toolbar button (`automation-recommender-open`) renders when a project is active
   and opens the sheet; the sheet fetches on every open.
10. Loading shows the skeleton (`automation-recommender-loading`) and "Fingerprinting
    your project…"; no empty state flashes while loading.
11. With a rich report: tabs render only for categories present in the data, in
    canonical order, each with its count badge; the first tab is active; switching
    tabs (`automation-recommender-tab-<category>`) swaps the rows.
12. Each row shows the title, the signal chip + why line, and the command row;
    clicking copy (`automation-recommender-copy-<recId>`) writes the full command to
    the clipboard, flips the button to Copied, and increments the footer counter; the
    counter reads `{done} of {total} copied` across **all** categories and turns
    `text-mf-success` once non-zero.
13. Switching the active project while the sheet is open drops the old report,
    refetches, and ignores a late response from the previous project; the footer
    counter counts only copied ids present in the current report (a stale copied id
    never yields `done > total`).
14. The evidence toggle (`automation-recommender-evidence-toggle`) is collapsed by
    default and expands to one chip per fingerprint signal.
15. A thin report (< 3 signals) shows the thin note; a report with zero
    recommendations shows the empty message, no tab strip, and no footer counter.
16. A failed fetch shows the error state; `automation-recommender-retry` re-issues the
    request.
17. Every interactive element carries its scoped `data-testid` (Testids table in the
    UI section) and is a real `<button>` with an accessible name.

Cross-cutting:

18. The feature performs no writes to the analyzed project and executes no commands —
    nothing in the new code shells out or opens files for writing under the project
    root.
19. All new files respect the 300-line/50-line limits; the rules dataset is split per
    category.
20. The daemon contract change is additive only (one new GET route, new types); no
    existing route or event changes shape.

## Risks

- **skills.sh registry coverage is unverified.** If few real registry entries match
  our signal set, the skills category leans on custom-scaffold fallbacks — acceptable,
  but the implementer should verify sources early, not last.
- **Rules fidelity drift.** The dataset lifts mappings from claude-code-setup v1.0.0;
  upstream will evolve and nothing tracks it. The rules-file provenance headers make a
  manual refresh reviewable; no auto-sync is planned.
- **Hooks commands are hand-authored.** The upstream bundle carries no usable
  format/lint/typecheck snippets, so the hooks `command` snippets are written against
  the Claude Code hooks documentation — the one category whose copy text has no
  upstream original to diff against.
- **Fingerprint breadth vs. the 2s budget.** The bounded walk and root-only manifest
  reads keep this safe, but monorepos with huge roots are the case to test manually.
- **`command` strings for hooks are snippets, not commands.** The copy row treats them
  uniformly; if user feedback shows confusion, a follow-up can differentiate
  presentation — not in this pass.
