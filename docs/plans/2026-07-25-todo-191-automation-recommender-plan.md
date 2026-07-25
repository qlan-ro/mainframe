# Implementation plan — Setup Advisor (todo #191)

**Spec (contract):** `docs/specs/2026-07-25-todo-191-automation-recommender.md` (committed `cc5d7a6c`).
**Worktree:** `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-191-automation-recommender`, branch `todo/191-automation-recommender`.
All paths below are relative to that worktree unless written absolute.

## Goal

Ship a read-only Setup Advisor: a Rust-daemon module at
`packages/core-rs/crates/mainframe-server/src/setup_advisor/` fingerprints a project root
(manifests, dependency names, config presence, directory structure, git remote host) and maps
the detected signals through a static rules dataset into at most two recommendations per
category across five categories (mcp, skills, hooks, subagents, plugins); one new route,
`GET /api/projects/{id}/automation-recommendations`, returns
`{fingerprint, recommendations}` in the house `ok` envelope; and `packages/ui` renders it in
the approved variant-B sheet — category tabs with count badges, a collapsed evidence
disclosure, and a per-recommendation copy button whose only claim is "copied". The feature
never writes to the analyzed project, never executes a command, and never lets
fingerprint-derived text reach a `command` string.

## Constraints this plan encodes

| Constraint | Where it is enforced |
|---|---|
| `command` is a rule constant, never fingerprint-derived | T14 (`command: &'static str` on `Rule` — type-level), T17 (injection fixture) |
| Canonicalize before containment — on the walk **and** on every root read | T10 (reuses `fs_utils::walk_project_files`, which canonicalizes per entry then calls `path_utils::is_within_base`), T8 (`read_contained_root_file` for manifests, configs, `.git/config`), T7/T9 (symlink-escape tests) |
| Copy state in-memory, per project, per app session; footer says "copied" | T23/T24 (store), T25/T26 (footer copy) |
| Skill bundle not vendored; provenance in rules-file headers + per-rule comments | T2, T15, T16 |
| Report bound to its project (keyed store, drop/refetch, stale guard, counter = copied ∩ report) | T23/T24, T27/T28 |
| Worktree checkouts yield `gitHost: null` (do not follow `gitdir:`) | T9/T10 (explicit test) |
| No caching — every open re-fingerprints | T27/T28 (rising-edge refetch, no memo) |
| Route + testids keep `automation-recommender`; code/dirs use `setup-advisor`/`setup_advisor` | T4, T19, T25–T28 |
| Max 300 lines/file, 50/function | Every task's verification step |
| `data-testid` on every interactive element | T25, T27 |
| Changeset before commit | T29 |

Rust CI gates every daemon task must satisfy (`.github/workflows/rust-port.yml`):
`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and
`tools/verify-gate.sh` — which forbids `unwrap()`/`expect()`/`panic!`/`todo!`/`unsafe`/
`anyhow`/`std::thread::spawn` outside `#[cfg(test)]`.

## Decisions made while planning (surface these — they are additions to the spec, not deviations)

1. **Add `toml` as a workspace dependency.** The spec requires reading dependency names from
   `pyproject.toml` and tolerating malformed TOML without failing. No TOML parser exists in
   `packages/core-rs` today (`grep '^name = "toml' Cargo.lock` → no match), and hand-rolling
   one to scan `[project].dependencies` / `[tool.poetry.dependencies]` would be a fragile
   reimplementation that a reviewer would rightly reject. T8 adds `toml` to
   `packages/core-rs/Cargo.toml` `[workspace.dependencies]` and to
   `crates/mainframe-server/Cargo.toml`. Pin the current stable line (`toml = "0.8"` unless a
   newer major has landed) and record the resolved version in the changeset body.
   *This is a new third-party dependency — the user may want to approve it before T8 runs.*
2. **The route needs an existence check the shared helper does not do.** `resolve_base`
   (`crates/mainframe-server/src/routes/files.rs:76-92`) 404s `"Project not found"` when the
   project row is missing, but it never stats the registered path. The spec's second 404,
   `"Project path not found"`, therefore requires an explicit `tokio::fs::metadata(..).is_dir()`
   check in the new handler (T19). Do not change `resolve_base` — other routes depend on its
   current behavior.
3. **Bound display-only strings at the daemon boundary.** The spec makes `signal`/`why`
   display-only and leaves truncation to the UI. A dependency name is attacker-controlled and
   unbounded, so `recommend()` additionally strips control characters (including newlines) and
   truncates each evidence string to 160 **characters** before it reaches the wire (T14). This is
   consistent with Decision 20, not a change to it — the UI still truncates for layout.
   **Truncate on a char boundary** (`s.chars().take(160).collect::<String>()`), never
   `String::truncate(160)` — the latter panics mid-codepoint, dependency names are
   attacker-controlled UTF-8, and neither clippy nor `verify-gate.sh` catches it.
4. **`recommend()` is TDD'd against a synthetic test-local rule set; the shipped dataset gets a
   characterization suite after it exists.** Writing "test-first" assertions for a data table
   would just transcribe the table twice. So T13/T14 drive ordering, the per-category cap, and
   the empty-category rule with fixture rules; T17 then asserts the real dataset's expected
   ids/adapters and the injection AC. T17's injection case must assert both that no `command`
   contains the malicious substring **and** that at least one recommendation actually fired —
   otherwise it passes vacuously.
5. **The toolbar button imports the feature store directly, not a `window` custom event.**
   `layout/MainToolbar.tsx` already imports from `features/` (`:9-10`), the "no feature imports
   `layout/`" rule points the other way, and the "no `getState()` reach-through" rule is
   satisfied by a plain hook selector. The `mf:open-tasks` event pattern exists because
   `SidebarHeader` needed it; a typed import is stricter here.
6. **Worktree install is unavoidable for UI verification — see T1.** This worktree has no
   `node_modules` at any level, so `packages/ui` typecheck/tests cannot run at all, and the
   new `@qlan-ro/mainframe-types` symbols would otherwise resolve from the *main* checkout's
   stale `packages/types/dist`. T1 spells out the install plus the lockfile-restore guard.
7. **Reuse the existing contained walk instead of writing a second one.**
   `fs_utils::walk_project_files` (`crates/mainframe-server/src/fs_utils.rs:190-242`) already
   implements the exact iterative stack, `IGNORED_DIRS` skip, and canonicalize-then-
   `is_within_base` ordering this feature needs; duplicating it would fork the one piece of code
   most likely to be got wrong. T10 promotes it to `pub(crate)` with an explicit `limit: usize`
   parameter (existing call sites pass `WALK_LIMIT`; the fingerprint passes 5,000).
   **Do not** call the public `fs_utils::list_project_files` instead: with `include_ignored:
   false` it shells out to `git ls-files` (`fs_utils.rs:169-183`), which would put an `exec_git`
   subprocess inside a module whose AC-18 audit (T29 step 4) forbids exactly that, and would
   count only git-tracked files.

## Task list

Implementer key: **core-dev** = Rust / daemon / shared types · **ui-dev** = React ·
**test-writer** = dedicated test authoring.

---

### T1 — Bootstrap the worktree and capture baselines · core-dev

**Why first:** nothing in `packages/ui` or `packages/types` can be verified until dependencies
resolve inside this worktree.

**Do:**
1. `cd <worktree> && cp pnpm-lock.yaml /tmp/mf-191-lock.yaml`
2. `pnpm install --ignore-scripts`
3. `git checkout -- pnpm-lock.yaml` and confirm `git status --short pnpm-lock.yaml` is clean.
   (`packages/mobile` is an empty dir here — the submodule is not checked out — so a full
   install drops its lockfile importer entry. `node_modules/` is gitignored, so the restored
   lockfile is the only thing that matters.)
4. `pnpm --filter @qlan-ro/mainframe-types build` — establishes a `packages/types/dist` **inside
   this worktree**, which is what the worktree-local `node_modules/@qlan-ro/mainframe-types`
   symlink now points at.
5. Baselines: `cd packages/core-rs && cargo test` and `cargo clippy --all-targets -- -D warnings`;
   `pnpm --filter @qlan-ro/mainframe-ui typecheck`.
6. **Fallback:** if step 5's typecheck or any later UI vitest run fails on a missing native
   binary (a dev tool whose postinstall `--ignore-scripts` skipped), rerun `pnpm install`
   *without* `--ignore-scripts`, then repeat step 3's lockfile restore and re-verify
   `git status --short pnpm-lock.yaml` is clean.

**Verify:** all three baseline commands pass (or their pre-existing failures are recorded in the
task report so later tasks are not blamed for them); `git status --short` shows no tracked-file
changes.

---

### T2 — Verify skills.sh sources and record the command-provenance table · core-dev

**Why early:** the spec's first Risk says the registry coverage is unverified and must be checked
early, not last. T15 cannot be written without this.

**Do:** for each skills-category signal the spec lists, check whether a real skills.sh registry
entry exists. Produce a table (returned in the task report, and mirrored as the header comment
block T15 will paste) with one row per intended rule: signal → `npx skills add <source>` **or**
"no registry entry → custom-scaffold fallback". For fallbacks, transcribe the SKILL.md
frontmatter snippet from the local plugin cache at
`~/.claude/plugins/cache/claude-plugins-official/claude-code-setup/1.0.0/skills/claude-automation-recommender/references/skills-reference.md`
(api-doc, create-migration, gen-test, new-component, pr-check, release-notes,
project-conventions). Do the same verification pass for the MCP commands (`claude mcp add …`)
against each server's own documentation. For hooks, do **not** try to validate snippets — they
do not exist until T16 writes them; instead collect and record the authoritative Claude Code
hooks documentation references T16 will author against (event names, matcher syntax,
`settings.json` shape), so T16 has a citation per rule rather than an invented schema.

**Do not** vendor any file from that cache into the repo (Decision 9).

**Verify:** every planned rule has either a verified source URL or an explicit
"custom-scaffold fallback" marker. Rules with neither are dropped from the dataset — report
which, so T15/T16 scope is known.

---

### Contract amendment — provenance tier and source attribution (applies to T3–T5, T14, T15/T16, T25/T26)

The user's supply-chain ruling made third-party aggregator repos shippable **on condition that
each rule shows whose code it installs**. That turns provenance into part of the wire contract,
not a docs-only note. Added to `AutomationRecommendation` in both the TS and Rust types:

```ts
export type RecommendationProvenance = 'first-party' | 'vendor-official' | 'third-party';
export interface RecommendationSource { repo: string; installs: number }
// AutomationRecommendation gains: provenance (required), source?: RecommendationSource
```

Rust mirrors it as a `#[serde(rename_all = "kebab-case")]` enum plus
`#[serde(skip_serializing_if = "Option::is_none")] source: Option<RecommendationSource>`, so an
absent source is omitted rather than nulled — consistent with `targetPath`.

Tier assignment per category and the aggregator table live in
`docs/research/2026-07-25-todo-191-command-provenance.md`. T14's `Rule` struct carries both as
`&'static` data. The sheet UI (T25/T26) must render `third-party` visually distinct from the
other two; flattening the distinction defeats the ruling.

---

### T3 — TS type schema tests (red) · test-writer

**File:** `packages/types/src/__tests__/setup-advisor.test.ts` (new)

**Do:** write vitest cases against the not-yet-existing `../setup-advisor.js` module, modeled on
`packages/types/src/__tests__/suggestion.test.ts`:
- `AutomationRecommendationSchema` accepts a well-formed object and round-trips it unchanged.
- Rejects an unknown `category` (outside `mcp|skills|hooks|subagents|plugins`).
- Rejects a missing `command` and a missing `adapters`.
- Accepts an absent `targetPath` (optional).
- `ProjectFingerprintSchema` accepts `gitHost: null` and each of `'github'|'gitlab'|'other'`, and
  rejects `gitHost: 'bitbucket'`.
- `SetupAdvisorReportSchema` accepts `{fingerprint, recommendations: []}` and rejects a report
  missing `fingerprint`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/setup-advisor.test.ts`
fails on the missing module (red).

---

### T4 — Shared TS types + Zod schemas · core-dev

**Files:**
- `packages/types/src/setup-advisor.ts` (new)
- `packages/types/src/index.ts` — add `export * from './setup-advisor.js';` next to the
  `./suggestion.js` line (`:17`), keeping the explicit `.js` extension

**Do:** transcribe the three interfaces and the `RecommendationCategory` union from the spec's
Contract section verbatim, including the `command` INVARIANT doc comment. Follow
`packages/types/src/suggestion.ts` exactly for shape: interface first, then
`export const XSchema: z.ZodType<X> = z.object({...})`. Named `setup-advisor.ts` to avoid the
Automations v2 collision (`automation.ts`, `automation-domain/`).

**Verify:** T3's suite goes green; `pnpm --filter @qlan-ro/mainframe-types build` succeeds; file
under 300 lines.

---

### T5 — Rust mirror types with wire-shape tests · core-dev

**Files:**
- `packages/core-rs/crates/mainframe-types/src/setup_advisor.rs` (new)
- `packages/core-rs/crates/mainframe-types/src/lib.rs` — add `pub mod setup_advisor;` in
  alphabetical position (between `search` and `settings`, `:26-27`)

**Do:** mirror the TS types as serde structs with `#[serde(rename_all = "camelCase")]`, following
`crates/mainframe-types/src/suggestion.rs`. `RecommendationCategory` is a
`#[serde(rename_all = "lowercase")]` enum. `target_path` is `Option<String>` with
`#[serde(skip_serializing_if = "Option::is_none")]` only if the TS type keeps it optional on the
wire — otherwise serialize it as `null`; pick one and make the T3 schema and this agree.
`ProjectFingerprint` must `#[derive(Default)]` (alongside `Debug, Clone, Serialize, Deserialize`)
— T6's skeleton `fingerprint()` returns `Default::default()` and will not compile otherwise.
Write the `#[cfg(test)]` module **before** finalizing the struct bodies: hardcoded JSON literals
asserting the camelCase field names (`externalApis`, `hasClaudeConfig`, `hasEnvFiles`,
`hasLockFiles`, `fileCount`, `gitHost`, `targetPath`), a `gitHost: null` round-trip, and a
rejection of an unknown category. Do **not** add a `PORT STATUS` footer — this is new code, not
a port.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-types setup_advisor` green;
`cargo fmt --check`; file under 300 lines.

---

### T6 — Engine module skeleton · core-dev

**Files (all new, under `packages/core-rs/crates/mainframe-server/src/setup_advisor/`):**
`mod.rs`, `fingerprint.rs`, `manifests.rs`, `signals.rs`, `rule.rs`, `recommend.rs`,
`rules/mod.rs`, `rules/mcp.rs`, `rules/skills.rs`, `rules/hooks.rs`, `rules/subagents.rs`,
`rules/plugins.rs`
**Also:** `packages/core-rs/crates/mainframe-server/src/lib.rs` — register `mod setup_advisor;`
alongside the existing `mod suggestions;`

**Do:** create the module tree with the two public entry points compiling against empty bodies:
`pub async fn fingerprint(root: &Path) -> ProjectFingerprint` (returns `Default`) and
`pub fn recommend(fp: &ProjectFingerprint) -> Vec<AutomationRecommendation>` (returns `vec![]`).
`mod.rs` re-exports both, mirroring `suggestions/mod.rs`. `fingerprint()`'s signature must not
mention recommendations — todo #192 imports it standalone.

**Verify:** `cargo check -p mainframe-server` and `cargo clippy --all-targets -- -D warnings` pass
with no dead-code warnings (use `#[allow(dead_code)]` nowhere — wire the re-exports instead).

---

### T7 — Tests: manifests and dependency detection (red) · test-writer

**File:** `packages/core-rs/crates/mainframe-server/src/setup_advisor/manifests.rs` —
`#[cfg(test)]` module

**Do:** `tempfile::tempdir()` fixtures, hardcoded expectations, no recomputation of the
implementation's own mapping:
- `package.json` with `next`, `react`, `@supabase/supabase-js` in `dependencies` and `vitest`,
  `@playwright/test`, `typescript` in `devDependencies` → `languages` contains `typescript`,
  `frameworks` contains `react` and `nextjs`, `databases` contains `supabase`, `testing` contains
  `vitest` and `playwright`.
- **TypeScript is claimed, never assumed** (user ruling, corrects this task's original
  expectation): `typescript` requires a root `tsconfig.json` **or** a `typescript` entry in
  `dependencies`/`devDependencies`. A `package.json` says JavaScript, not TypeScript. Three cases:
  `react` with no `typescript` dep and no `tsconfig.json` → `languages` does **not** contain
  `typescript` while `frameworks` still contains `react`; a `package.json` with no `typescript`
  dep plus a root `tsconfig.json` → claimed; a bare `tsconfig.json` with no `package.json` →
  claimed.
- Auth libraries `next-auth`, `@clerk/nextjs`, `@auth0/auth0-react`, `passport` land in
  `externalApis` (the security-reviewer subagent rule depends on this).
- `stripe`, `@aws-sdk/client-s3`, `@sentry/node`, `@anthropic-ai/sdk`, `openai`, `langchain` →
  `externalApis`; `prisma`, `drizzle-orm`, `convex`, `pg` → `databases`.
- `pyproject.toml`, **PEP 621 form** — `[project]` with `dependencies = ["fastapi", "django"]`
  and `pytest` → `languages` contains `python`, `frameworks` contains `fastapi`/`django`,
  `testing` contains `pytest`.
- `pyproject.toml`, **poetry form** — `[tool.poetry.dependencies]` with `fastapi = "^0.110"` and
  `[tool.poetry.group.dev.dependencies]` with `pytest = "^8"` → the same detections. Both forms
  are supported; Decision 1 justifies the `toml` crate partly on this second one, so it must be
  covered here or struck from the decision.
- Bare `Cargo.toml` → `languages` contains `rust`; `go.mod` → `go`; `pom.xml` → `java`.
- Malformed `package.json` (`{ not json`) and malformed `pyproject.toml` are tolerated: the call
  returns without error and simply detects nothing from that file.
- Manifests are read at the **root only** — a `package.json` inside `sub/` contributes nothing.
- **Root-manifest symlink escape:** the fixture root's `package.json` is a symlink to a
  `package.json` **outside** the root that declares `next` and `react`. Assert nothing is
  detected from it. A plain `read_to_string` follows the link, so this case fails until T8 adds
  the containment check — and T29's AC-18 grep cannot detect the escape, only this test can.

**Verify:** `cargo test -p mainframe-server setup_advisor::manifests` fails (red).

---

### T8 — Impl: manifests and dependency detection · core-dev

**Files:** `setup_advisor/manifests.rs`, `setup_advisor/fingerprint.rs`;
`packages/core-rs/Cargo.toml` (`[workspace.dependencies]` + `toml`),
`packages/core-rs/crates/mainframe-server/Cargo.toml` (`toml = { workspace = true }`)

**Do:** root-only manifest reads through a single shared helper —
`async fn read_contained_root_file(real_root: &Path, name: &str) -> Option<String>` — which
`tokio::fs::canonicalize`s the candidate path and returns `None` unless
`path_utils::is_within_base(real_root, &real)` holds, **before** reading. A bare
`read_to_string(root.join("package.json"))` follows a symlink out of the project and silently
reads an arbitrary file; every root read in T8 and T10 (manifests, dotfile configs, `.git/config`)
goes through this helper. JSON via `serde_json`, TOML via
the new `toml` crate — support both `[project].dependencies` (PEP 621) and
`[tool.poetry.dependencies]` / `[tool.poetry.group.*.dependencies]`. Parse errors log through
`tracing::warn!` and return an empty detection —
never propagate (the spec's "skipped, never fatal", and the repo's no-silent-catch rule). The
dependency-name → bucket mapping is a `const` table of `(&str, Bucket)` pairs plus a small set of
prefix rules for scoped families (`@supabase/`, `@aws-sdk/`, `@sentry/`, `@clerk/`, `@auth0/`);
keep it data, not a match arm per name.

**Verify:** T7 green; `cargo clippy --all-targets -- -D warnings`; `tools/verify-gate.sh`;
each file under 300 lines and each function under 50 (split the table into `manifests.rs` and the
orchestration into `fingerprint.rs` if either grows).

---

### T9 — Tests: config presence, dirs, git host, bounded contained walk (red) · test-writer

**File:** `setup_advisor/fingerprint.rs` — `#[cfg(test)]` module

**Do:**
- **Rich fixture (spec AC 1):** `package.json` (next/react/@supabase), `.prettierrc`,
  `tsconfig.json`, `docker-compose.yml`, `.env.example`, `pnpm-lock.yaml`, `tests/` dir,
  `.git/config` containing `[remote "origin"]\n\turl = git@github.com:acme/app.git`. Assert the
  whole `ProjectFingerprint` against hardcoded values: `tooling` contains `prettier`,
  `tsconfig`, `docker`; `dirs` contains `tests`; `hasEnvFiles == true`; `hasLockFiles == true`;
  `gitHost == Some(Github)`.
- **Each `tooling` detection T16's hooks and plugins rules depend on, one case apiece** — without
  these, T10 could ship them broken and every later suite would still pass, because T17 builds its
  fingerprint by hand rather than running `fingerprint()`:
  `eslint.config.js` → `eslint`; `.eslintrc.json` → `eslint`; `ruff.toml` → `ruff`;
  `jest.config.ts` → `jest`; `pytest.ini` → `pytest`; a bare `Dockerfile` with no
  `docker-compose.yml` → `docker`.
- `.git/config` with a `gitlab.com` origin → `Gitlab`; with a `bitbucket.org` origin → `Other`;
  no `.git` at all → `None`; `.git` present with no `origin` remote → `None`.
- **`.git` symlinked out of the root** → `gitHost == None` and the out-of-root config is never
  read (same containment helper as T8).
- **Worktree case (spec Decision 22):** `.git` is a *file* containing
  `gitdir: /somewhere/outside/.git/worktrees/x` → `gitHost == None`, and the pointer target is
  never opened. This is deliberate; do not write a test that expects the remote to be found.
- `.claude/` dir present → `hasClaudeConfig == true`; `CLAUDE.md` present → likewise.
- **Symlink containment (spec AC 3):** an out-of-root directory holding a `package.json` and 12
  files, symlinked into the fixture root. Assert `fileCount` counts none of them **and** no
  signal derives from the out-of-root manifest.
- **Cap:** a fixture with more than 5,000 entries (generate cheaply) → `fileCount == 5000`.
- **Ignored dirs:** files under `node_modules/` and `target/` are not counted.
- **Near-empty fixture (spec AC 2):** single `main.py`, no manifest → `signals.len() < 3`.

**Verify:** `cargo test -p mainframe-server setup_advisor::fingerprint` fails (red).

---

### T10 — Impl: config presence, dirs, git host, bounded contained walk · core-dev

**Files:** `setup_advisor/fingerprint.rs` (plus a `setup_advisor/git_host.rs` if `fingerprint.rs`
approaches 300 lines); `crates/mainframe-server/src/fs_utils.rs` (signature change only)

**Do:**
- Config presence: glob-free `tokio::fs::metadata` probes at the root for `.prettierrc*`,
  `eslint.config.*`/`.eslintrc*`, `ruff.toml`, `tsconfig.json`, jest/pytest config,
  `docker-compose.yml`/`Dockerfile`, `.env*`, and the lock files. Prefix families
  (`.prettierrc*`, `.env*`) come from a single root `read_dir` pass, not N stats.
- `dirs`: probe `src`, `app`, `components`, `tests`, `api`.
- Git host: read `.git/config` (through T8's `read_contained_root_file`) **only when `.git` is a
  directory**. Parse the INI-ish file with a minimal section scanner (`[remote "origin"]` → the
  following `url = …` before the next `[`) and classify the host by substring on the parsed URL.
  If `.git` is a file (`gitdir:` pointer), return `None` immediately without reading it — one
  comment line saying *why*.
- Bounded walk: **reuse `fs_utils::walk_project_files`** (`fs_utils.rs:190-242`), which already
  does the iterative stack, the `IGNORED_DIRS` skip, and `canonicalize`-then-`is_within_base`
  in the #371-correct order. Change its signature to
  `pub(crate) async fn walk_project_files(project_path: &str, skip_ignored_dirs: bool, limit: usize)`,
  replacing the hardcoded `WALK_LIMIT` with the parameter; the two existing call sites
  (`fs_utils.rs:160` and `:182`) pass `WALK_LIMIT`, the fingerprint passes 5,000 with
  `skip_ignored_dirs: true`. **Pass the canonicalized root** (the `real_root` already computed for
  T8's `read_contained_root_file`), not the raw project path: `walk_project_files` canonicalizes
  each *entry* but compares against the base as-given, so a root reached through a symlink — every
  `tempfile::tempdir()` on macOS, where `/var → /private/var` — fails containment for every entry
  and yields `fileCount == 0`. Do not change the existing call sites' behavior; this is a
  caller-side choice. `fileCount` is the returned length. Do **not** hand-roll a second
  walk, and do **not** call the public `list_project_files` — with `include_ignored: false` it
  shells out to `git ls-files` (`fs_utils.rs:169-183`), putting a subprocess inside the module
  T29 step 4 audits for exactly that.
- No writes, no `Command`, no `exec_git` anywhere in `setup_advisor/`.

**Verify:** T9 green; the full `cargo test -p mainframe-server` green — the `walk_project_files`
signature change touches shared code, so existing `fs_utils`/files/search suites must stay green;
`cargo clippy --all-targets -- -D warnings`; `tools/verify-gate.sh`; line limits.

---

### T11 — Tests: signal chips (red) · test-writer

**File:** `setup_advisor/signals.rs` — `#[cfg(test)]` module

**Do:** hardcoded expectations mapping a fingerprint to its chip list — `"TypeScript"`,
`"Next.js"`, `"React"`, `"Supabase"`, `"Prettier"`, `"GitHub remote"`, `"Docker"`, `"Tests
directory"`. Assert order is deterministic and that a chip appears **once** even when two
detections would produce it. Assert the near-empty fingerprint yields fewer than 3 chips (the
thin threshold the UI reads).

**Verify:** `cargo test -p mainframe-server setup_advisor::signals` fails (red).

---

### T12 — Impl: signal chips · core-dev

**File:** `setup_advisor/signals.rs`; called from `fingerprint.rs` as the last step

**Do:** a pure `fn build_signals(fp: &ProjectFingerprint) -> Vec<String>` over the already-filled
detection vectors — a `const` table of `(detection_key, chip_label)`, deduplicated, in a fixed
declaration order. No I/O.

**Verify:** T11 green; T9's rich-fixture `signals` assertion also green; line limits.

---

### T13 — Tests: `Rule` evaluation, ordering, and the per-category cap (red) · test-writer

**File:** `setup_advisor/recommend.rs` — `#[cfg(test)]` module

**Do:** build a **test-local** fixture rule set (not the shipped dataset) and drive
`recommend_with(&rules, &fp)`:
- Output is ordered by canonical category (mcp, skills, hooks, subagents, plugins) and by
  `priority` within a category.
- At most 2 per category, even when 4 rules in that category fire.
- A category with no firing rule contributes zero recommendations (no padding).
- A rule whose predicate returns `None` never appears.
- The emitted `signal` is the string the predicate returned.
- Determinism: two calls on the same fingerprint produce identical output.
- Sanitization (planning decision 3): a predicate returning a 500-char string containing `\n`
  and `\r` yields a `signal` with no control characters and at most 160 **chars**.
- Sanitization, **multibyte**: a predicate returning 500 repetitions of a multibyte char (`é`, or
  an emoji) yields a `signal` of exactly 160 chars. This case is what forces a char-boundary-safe
  truncation — a naive `String::truncate(160)` panics here and passes on the ASCII case above.

**Verify:** `cargo test -p mainframe-server setup_advisor::recommend` fails (red).

---

### T14 — Impl: `Rule` type and `recommend()` · core-dev

**Files:** `setup_advisor/rule.rs`, `setup_advisor/recommend.rs`

**Do:**
```rust
pub struct Rule {
    pub id: &'static str,
    pub category: RecommendationCategory,
    pub title: &'static str,
    pub why: &'static str,
    /// INVARIANT (spec Decision 20): a rule constant. `&'static str` makes a
    /// fingerprint-derived command a compile error, not a review catch.
    pub command: &'static str,
    pub target_path: Option<&'static str>,
    pub adapters: &'static [&'static str],
    pub priority: u8,
    /// Returns the concrete evidence string when the rule fires.
    pub evidence: fn(&ProjectFingerprint) -> Option<String>,
}
```
`recommend(fp)` calls `recommend_with(&rules::all(), fp)`; `recommend_with(rules: &[&'static
Rule], fp: &ProjectFingerprint)` is the testable seam. Sanitize each evidence string at the point
it becomes `AutomationRecommendation::signal`:
`s.chars().filter(|c| !c.is_control()).take(160).collect::<String>()` — **never**
`String::truncate`, which panics on a non-char-boundary byte index (T13's multibyte case).
Keep `recommend_with` under 50 lines — the group/sort/cap step is its own helper.

**Verify:** T13 green; `cargo clippy --all-targets -- -D warnings`; `tools/verify-gate.sh`.

---

### T15 — Rules dataset: mcp + skills · core-dev

**Files:** `setup_advisor/rules/mcp.rs`, `setup_advisor/rules/skills.rs`,
`setup_advisor/rules/mod.rs`

**Provenance source of truth:** `docs/research/2026-07-25-todo-191-command-provenance.md` (T2).
Every `command`, source, and skill id comes from that file. Do not re-query skills.sh or re-derive
a command from vendor docs — if a row is missing there, the rule does not ship.

**Scope inversion vs. the spec's Risk #1.** The spec expected skills to be the thin, mostly-
fallback category. Measured: skills is the *large* category (17 first-party registry sources
across 37 signals) and **MCP is the thin one** — one rule dropped (docker, no vendor-documented
command), one moved to plugins (convex), one composed rather than transcribed (aws).

**Do:** transcribe the spec's category mappings. Each file opens with a header comment citing
the upstream plugin (`claude-code-setup v1.0.0`) and the reference file its mappings came from,
and each rule carries a one-line comment recording where its `command` was verified (T2's table).
- **mcp** (`adapters: ["*"]`): supabase → Supabase; postgres → Postgres; sentry → Sentry; aws →
  AWS; react/vue/nextjs → Playwright; `gitHost == Github` → GitHub; any framework → context7.
  **No docker rule** — dropped, no verifiable command. **No convex rule** — moved to plugins.
  **Priority is ordered by evidence specificity, narrowest first** (corrected 2026-07-25; this
  list was previously written broadest-first). Under the hard cap of 2, context7 fires on any
  framework at all, so ranking it first would spend a slot on every project and hide Supabase or
  Sentry from the projects that actually run them.
- **skills** (`adapters: ["*"]`): the 17 first-party sources in T2's table, each as the
  deterministic long form `npx skills add <owner/repo> --skill <skill-id> -a claude-code -g -y`.
  The bare `npx skills add <source>` is interactive on multi-skill repos and must never ship. The
  20 unmatched signals use the custom-scaffold fallback — `command` is the SKILL.md frontmatter
  snippet, `target_path` is `.claude/skills/<name>/SKILL.md`. There are **8** scaffolds, not 7:
  the reference file adds `setup-dev`.

Each category file exposes `pub static RULES: &[Rule] = &[ … ];`. `rules/mod.rs` exposes
`pub fn all() -> Vec<&'static Rule>` = `mcp::RULES.iter().chain(skills::RULES.iter())…collect()`,
in canonical category order. It returns owned references, not `&'static [Rule]` — five static
slices cannot be concatenated into one `'static` slice without a `LazyLock` or a leak, and the
`Vec<&Rule>` costs one small allocation per request against a filesystem walk.

**Verify:** `cargo test -p mainframe-server` green; `cargo fmt --check`; each rules file under
300 lines (split by sub-family if a file grows).

---

### T16 — Rules dataset: hooks + subagents + plugins · core-dev

**Files:** `setup_advisor/rules/hooks.rs`, `setup_advisor/rules/subagents.rs`,
`setup_advisor/rules/plugins.rs`

**Provenance source of truth:** `docs/research/2026-07-25-todo-191-command-provenance.md` (T2) —
the hooks event/matcher table, the 15 verified plugin names, and the per-category footer copy all
come from there.

**Footer copy is per category, not global.** `/plugin install` is a slash command typed inside
Claude Code, so the spec's single mandated footer ("Read-only — commands run in your terminal.")
is false for every plugins rule. Plugins get "Read-only — run this inside Claude Code."; mcp,
skills, hooks, and subagents keep the terminal wording.

**Do:** same header/provenance discipline.
- **hooks** (`adapters: ["claude"]`, `target_path: ".claude/settings.json"`): prettier →
  format-on-edit; eslint or ruff → lint-on-edit; tsconfig → typecheck-on-edit; `dirs` contains
  `tests` → run-related-tests; `hasEnvFiles`/`hasLockFiles` → block-edits. Each `command` is a
  multi-line `settings.json` snippet authored against the Claude Code hooks documentation, with
  the doc reference in the rule comment (spec Decision 19 — this is the one category with no
  upstream original).
- **subagents** (`adapters: ["claude"]`, `target_path: ".claude/agents/<name>.md"`):
  `fileCount > 500` → code-reviewer; `externalApis ∩ {stripe, next-auth, clerk, auth0, passport}`
  → security-reviewer; `languages` non-empty **and** `testing` empty **and** no `tests` dir →
  test-writer; `dirs` contains `api` or a backend framework → api-documenter; `databases`
  non-empty → performance-analyzer; a frontend framework → ui-reviewer.
- **plugins** (`adapters: ["claude"]`): frontend framework → frontend-design; `gitHost` non-null
  → pr-review-toolkit / commit-commands; `tooling` contains prettier/eslint/ruff/tsconfig →
  hookify; a detected language → `<lang>-lsp`; `databases` contains convex → convex (moved here
  from MCP — Convex documents a plugin, not an MCP server). 15 rules; all names verified against
  the official marketplace manifest in T2's table.

**Verify:** `cargo test -p mainframe-server` green; `cargo fmt --check`; line limits.

---

### T17 — Tests: shipped-dataset expectations and the injection fixture · test-writer

**File:** `setup_advisor/rules/mod.rs` — `#[cfg(test)]` module (or a sibling
`setup_advisor/rules/tests.rs` if `mod.rs` would exceed 300 lines)

**Authoring rule (this is what keeps the suite from being a mirror):** T17 runs *after* T15/T16,
so every expected id, adapter list, and `target_path` must be derived from the **spec's category-
mappings section and T2's provenance table only** — do not open `rules/*.rs` while writing it. If
an expectation then fails, that is a T15/T16 bug to fix in the dataset, not an expectation to
adjust. A test transcribed from the implementation asserts nothing.

**Do (spec AC 4, 5, 6):**
- Representative fingerprint → expected recommendations in **each of the five categories**,
  asserted against hardcoded `id`s, with a non-empty `signal`/`why`/`command` and the correct
  `adapters` (`["*"]` for mcp/skills, `["claude"]` for hooks/subagents/plugins) per rule.
- Every skills rule's `command` either starts with `npx skills add ` or is a SKILL.md frontmatter
  snippet paired with a `.claude/skills/…/SKILL.md` `target_path`.
- Rule-id uniqueness across the whole dataset (ids feed testids).
- A fingerprint with no signal for a category yields nothing in that category.
- **Injection (AC 6, mandatory):** fingerprint whose `frameworks`/`externalApis` contain the
  literal `; rm -rf ~` (as a `package.json` dependency name would produce). Assert
  (a) `recommendations` is **non-empty** — otherwise the test passes vacuously — and (b) no
  recommendation's `command` contains `rm -rf`, and (c) the substring is allowed to appear only
  in `signal`/`why`. Add a second assertion that every shipped rule's `command` is byte-identical
  to its declared constant for **any** fingerprint, by evaluating the dataset against both a
  benign and the malicious fingerprint.

**Verify:** `cargo test -p mainframe-server setup_advisor` fully green.

---

### T18 — Tests: route integration (red) · test-writer

**File:** `packages/core-rs/crates/mainframe-server/tests/routes_setup_advisor.rs` (new)

**Do:** model on `tests/routes_suggestions.rs` — `mod support; spawn_test_server(None).await;
server.create_project(path)`, then `reqwest::get(server.http_url(...))`. Cases (spec AC 7):
- Registered fixture project (the rich tree from T9) → 200 and a body whose `success` is `true`
  and whose `data` has both `fingerprint` and `recommendations`; assert at least the
  `fingerprint.gitHost` and one hardcoded recommendation `id`, plus the camelCase field names on
  the wire.
- Unknown id → 404 `{"success":false,"error":"Project not found"}`.
- Registered project whose path was deleted after registration → 404
  `{"success":false,"error":"Project path not found"}`.
- Registered path that exists but is a **file**, not a directory → the same 404.

**Verify:** `cargo test -p mainframe-server --test routes_setup_advisor` fails (red).

---

### T19 — Impl: route handler and mount · core-dev

**Files:**
- `packages/core-rs/crates/mainframe-server/src/routes/setup_advisor.rs` (new)
- `packages/core-rs/crates/mainframe-server/src/routes/mod.rs` — register the module
- `packages/core-rs/crates/mainframe-server/src/http.rs` — `.merge(routes::setup_advisor::router())`
  next to `.merge(routes::suggestions::router())` (`:62`)

**Do:** mirror `routes/suggestions.rs:103-129`. The handler:
1. `resolve_base(&ctx, &id, None).await` — returns the 404 `"Project not found"` envelope itself.
2. `tokio::fs::metadata(&base)` → `fail(StatusCode::NOT_FOUND, "Project path not found")` when it
   errors or `!is_dir()`.
3. `let fp = setup_advisor::fingerprint(Path::new(&base)).await;`
4. `ok(SetupAdvisorReport { recommendations: setup_advisor::recommend(&fp), fingerprint: fp })`

Route path `"/api/projects/{id}/automation-recommendations"` (Axum 0.8 `{id}`, absolute path,
`.merge`d — there is no `nest`). No body, no query, so no `parse_body`; the `{id}` path param is
the entire input surface and the project lookup is its validation. No `PORT STATUS` footer. Keep
the handler under 50 lines.

**Verify:** T18 green; `cargo clippy --all-targets -- -D warnings`; `tools/verify-gate.sh`;
`cargo fmt --check`.

---

### T20 — Manual latency check (spec AC 8) · core-dev

**Do:** register the Mainframe repo itself as a project against a dev daemon and time the new
route (`curl -w '%{time_total}'`). Isolate the daemon —
`MAINFRAME_DATA_DIR=~/.mainframe_dev DAEMON_PORT=31500` — never point a test daemon at
`~/.mainframe` on `:31415`.

**Verify:** under 2 seconds. Record the measured number in the task report. If it exceeds the
budget, report it rather than silently lowering the 5,000-entry cap.

---

### T21 — Tests: API client shaping (red) · test-writer

**File:** `packages/ui/src/lib/api/__tests__/setup-advisor.test.ts` (new; `.test.ts` → node project)

**Do:** follow the sibling endpoint suites — assert **URL, method, and body shaping only**; the
envelope is already covered by `lib/api/__tests__/http-envelope.test.ts`. Cases: the call hits
`GET <base>/api/projects/<id>/automation-recommendations`, and the project id is
`encodeURIComponent`-escaped.

**Verify:** vitest run of that file fails (red).

---

### T22 — Impl: API client · ui-dev

**File:** `packages/ui/src/lib/api/setup-advisor.ts` (new)

**Do:** follow the newest convention in `lib/api/automations.ts:1-40` — **no `port` param**,
`const b = () => \`${apiBase()}/api\``, one exported function:
```ts
export const getAutomationRecommendations = (projectId: string): Promise<SetupAdvisorReport> =>
  request('GET', `${b()}/projects/${encodeURIComponent(projectId)}/automation-recommendations`);
```
`request<T>` throws on a `{success:false}` envelope (`lib/api/http.ts:52-58`), so the store
try/catches.

**Verify:** T21 green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

### T23 — Tests: feature store (red) · test-writer

**File:** `packages/ui/src/features/setup-advisor/__tests__/use-setup-advisor-store.test.ts` (new)

**Do (spec AC 13, Decisions 15 and 21), mocking `lib/api/setup-advisor`:**
- `load(projectId)` sets `loading`, then stores `{report, reportProjectId}`.
- **Stale-response guard:** start `load('A')`, then `load('B')`; resolve A's promise **after**
  B's — A's result is discarded and `reportProjectId` stays `'B'`. Same assertion on the
  **failure** path (a late rejection from A must not overwrite B's state or set `error`).
- `clearForProjectSwitch()` (or equivalent) drops the report so the header can never name project
  B over project A's rows — **and leaves `copiedByProject` untouched**. Assert both halves: after
  the clear, `report` is `null` and project A's copied ids are still recorded. Copy state is
  per-app-session, so it must outlive the report it was recorded against.
- `markCopied(projectId, recId)` records per project; copied ids for project A are invisible while
  project B is active.
- **Counter:** `copiedCount` = |copied ids ∩ current report's recommendation ids|. Seed 3 copied
  ids, load a report containing only 2 of them, assert the count is 2 — never `3 of 2`.
- `error` is set on a rejected fetch and cleared by a subsequent successful `load`.
- The store is reset by `resetDaemonScopedStores()`.

**Verify:** the file fails (red).

---

### T24 — Impl: feature stores · ui-dev

**Files:**
- `packages/ui/src/features/setup-advisor/use-setup-advisor.ts` (new) — open/close nav store,
  modeled on `features/tasks/use-tasks-modal.ts` (25 lines)
- `packages/ui/src/features/setup-advisor/use-setup-advisor-store.ts` (new) — data store
- `packages/ui/src/features/daemon/reset-daemon-scoped-stores.ts` — register the data store's
  reset (`:26-57`)

**Do:** split nav from data exactly as `features/automations/AutomationsHost.tsx:17-56` does.
The data store carries `report`, `reportProjectId`, `loading`, `error`, and
`copiedByProject: Record<string, Set<string>>` (or `string[]` — pick one and keep it consistent
with the reset). Stale guard: a module-level `let _loadSeq = 0` **outside React and zustand**,
`const seq = ++_loadSeq` at the top of `load`, and `if (seq !== _loadSeq) return` on **both** the
success and the failure branch — the `features/tasks/use-todos-store.ts:36-37, :67-79` idiom.

**Verify:** T23 green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`; each file under 300 lines.

---

### T25 — Tests: sheet components (red) · test-writer

**File:** `packages/ui/src/features/setup-advisor/__tests__/SetupAdvisorSheet.test.tsx` (new;
`.test.tsx` → jsdom project)

**Do (spec AC 10, 11, 12, 14, 15, 16, 17), rendering the presentational sheet with prop-supplied
report fixtures:**
- **Loading:** `automation-recommender-loading` skeleton present and the header reads
  "Fingerprinting your project…"; the empty-state message is **absent** (no flash).
- **Tabs:** only categories present in the data get a tab, in canonical order
  (mcp, skills, hooks, subagents, plugins); every tab carries its count badge; the first tab is
  active; clicking `automation-recommender-tab-<category>` swaps the rows.
- **Rows:** title, the mono signal chip + ` — ` + why, and the command row. A multi-line
  `command` renders only its first line.
- **Copy:** clicking `automation-recommender-copy-<recId>` writes the **full** command (including
  every line of a multi-line snippet) to the clipboard, flips the button to "Copied", and bumps
  the footer counter. Install the clipboard mock per-test via
  `Object.defineProperty(navigator, 'clipboard', {...})` — see
  `features/shared/__tests__/ErrorState.test.tsx:44-53`. **Do not call `userEvent.setup()` in
  these cases**: it installs its own clipboard stub that silently overrides yours
  (`features/chat/parts/__tests__/markdown-text.test.tsx:280-288`); use `fireEvent`.
- **Copy failure:** a rejecting `writeText` shows "Copy failed", reverts, and leaves the counter
  unchanged.
- **Footer:** the left text is per category, not global (see "Footer copy is per category" above,
  which supersedes spec line 361). On the plugins tab it reads exactly "Read-only — run this
  inside Claude Code."; on mcp, skills, hooks, and subagents, "Read-only — commands run in your
  terminal." It is the surface's honesty claim, so assert both strings, and assert that switching
  to the plugins tab changes it. Derive it from the active category — the `Rule` contract
  deliberately carries no footer field. The right side reads
  `{done} of {total} copied` across **all** categories, `total` counts every recommendation, and
  it gains `text-mf-success` once `done > 0`. Hidden while loading and when `total` is 0. The
  word "installed"/"done"/"configured" appears nowhere.
- **Evidence:** `automation-recommender-evidence-toggle` is collapsed by default, reads
  `What we detected ({n})` with `n === fingerprint.signals.length`, and expands to one chip per
  signal.
- **Thin:** `signals.length < 3` renders the thin note.
- **Empty:** zero recommendations → the empty message, no tab strip, no footer counter. Plus the
  spec's State 4 combination no other case covers: zero recommendations **and** `signals.length
  < 3` renders the empty message **and** the thin note together.
- **Container:** the sheet root carries `data-testid="automation-recommender-sheet"` (spec's
  testid table, line 409) — assert it in the loaded case.
- **Error:** the error body plus `automation-recommender-retry`, whose click calls the retry
  handler.
- Every interactive element is a real `<button>` with an accessible name and its scoped testid.

**Verify:** the file fails (red).

---

### T26 — Impl: sheet components · ui-dev

**Files (all new under `packages/ui/src/features/setup-advisor/`):**
`SetupAdvisorSheet.tsx`, `EvidenceDisclosure.tsx`, `CategoryTabs.tsx`, `RecommendationRow.tsx`,
`categories.ts`, `copy-command.ts`

**Do:** build the approved variant-B sheet exactly as the spec's UI section specifies. The sheet
is presentational — it takes `report | null`, `loading`, `error`, `projectName`, `copiedIds`, and
`onCopy`/`onRetry` callbacks, so T25 can drive every state without the host.
- `categories.ts`: the canonical order and the icon/label map — `Plug`, `Sparkles`, `Webhook`,
  `Bot`, `Puzzle` at `size-3.5` (all confirmed present in the installed lucide-react 1.25.0).
- `copy-command.ts`: a small local `navigator.clipboard.writeText` helper. **Do not** create a
  cross-feature clipboard abstraction for one consumer.
- Tokens: `bg-mf-glass`, `text-mf-success`, `bg-mf-success-tint`, `text-heading`, `text-body`,
  `text-caption` — all verified in `packages/ui/src/styles/globals.css`. **Never** apply the
  `/opacity` modifier to these CSS-var colors. Success-pill precedent:
  `features/chat/messages/PlanBubble.tsx:35-40`.
- `signal`/`why` render as text with newlines stripped and truncation — never interpolated into
  markup, a path, or a command.
- If a `Hint` tooltip wraps a Popover/Dropdown trigger anywhere here, `Hint` must be the **outer**
  element (`layout/MainToolbar.tsx:171-175`).

**Verify:** T25 green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`; every file under 300 lines
and every function under 50.

---

### T27 — Tests: host and toolbar entry point (red) · test-writer

**Files:**
- `packages/ui/src/features/setup-advisor/__tests__/SetupAdvisorHost.test.tsx` (new)
- `packages/ui/src/layout/__tests__/MainToolbar.test.tsx` — extend, don't replace

**Do (spec AC 9, 13):**
- The toolbar button `automation-recommender-open` renders when `projectId` is set and is absent
  when it is not; clicking it opens the sheet. `projectId` arrives as a **prop** — do not add
  `useActiveIdentity()` under `layout/`.
- The host renders nothing when there is no active project.
- Opening fetches; closing and reopening fetches **again** (no cache — spec Decision 16). Assert
  the fetch happens on the open **rising edge** only, not on every render.
- **Copy state survives close/reopen for the same project:** copy a recommendation, close the
  sheet, reopen it (which refetches a report still containing that rec id) — the row still reads
  "Copied" and the footer counter still counts it. The refetch must not reset copy state.
- Switching the active project while the sheet is open drops the previous report, refetches for
  the new project, and ignores a late response from the previous one — the header, the rows, and
  the counter always describe the same project.
- The project name renders immediately, including during loading.
- The retry button re-issues the request.

**Verify:** the files fail (red) on the missing host/button.

---

### T28 — Impl: host, toolbar button, AppShell mount · ui-dev

**Files:**
- `packages/ui/src/features/setup-advisor/SetupAdvisorHost.tsx` (new)
- `packages/ui/src/layout/MainToolbar.tsx` — add the button to the right-hand group (`:214-253`)
- `packages/ui/src/app/AppShell.tsx` — mount `<SetupAdvisorHost />` in the "Single app-wide
  outlets" block (`:179-194`), alongside `<AutomationsHost />` (`:191`)

**Do:**
- **Host:** follow `features/tasks/TasksModalHost.tsx` — `useActiveIdentity()` for `projectId` and
  `projectName`, `if (!projectId) return null`, refetch on the open rising edge via a `prevOpen`
  ref (`:31, :46-52`), and `<Dialog><DialogContent hideClose className={...}>` with an `sr-only`
  `DialogHeader`/`DialogTitle` for Radix a11y (`:86-95`). Content classes:
  `rounded-xl border border-border bg-card shadow-2xl max-w-[640px] p-0 gap-0` — `className`
  merges last through `cn` (`components/ui/dialog.tsx:25-30`), so the `bg-card shadow-2xl`
  override of the primitive's `bg-popover` lands. Re-scope on project change the way
  `features/automations/AutomationsHost.tsx:17-56` does. Dismiss by Esc or outside click; no
  explicit close button.
- **Toolbar button:** `ScanSearch size={14}` inside the shared `ICON_BTN` class
  (`MainToolbar.tsx:32-33`), wrapped in `<Hint label="Setup Advisor">`, testid
  `automation-recommender-open`, placed in the right group with a
  `<span className="mx-[4px] h-[16px] w-px bg-border" />` divider consistent with its neighbors.
  Open via a hook selector from `use-setup-advisor` — **no `getState()` reach-through**.
  `MainToolbar.tsx` is 256 lines today; if this pushes it past 300, extract the right-hand group
  into a sibling component rather than exceeding the limit.

**Verify:** T27 green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`; re-run
`layout/__tests__/MainToolbar.test.tsx` and
`features/setup-advisor/__tests__/SetupAdvisorSheet.test.tsx` **individually** — large multi-suite
runs hit cross-file `React.act` failures.

---

### T29 — Close-out sweep and changeset · core-dev

**Do:**
1. `cd packages/core-rs && cargo fmt --check && cargo clippy --all-targets -- -D warnings &&
   cargo test && tools/verify-gate.sh`
2. `pnpm --filter @qlan-ro/mainframe-types build && pnpm --filter @qlan-ro/mainframe-types test`
3. `pnpm --filter @qlan-ro/mainframe-ui typecheck`, then the new UI test files one at a time via
   `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`
4. **AC 18 audit:** `grep -rn "Command::new\|exec_git\|OpenOptions\|fs::write\|create_dir" \
   packages/core-rs/crates/mainframe-server/src/setup_advisor/` returns nothing.
5. **AC 19 audit:** `find` the new Rust and TS files and confirm every one is under 300 lines;
   spot-check function lengths.
6. **AC 20 audit:** `git diff main -- packages/core-rs/crates/mainframe-server/src/routes
   packages/core-rs/crates/mainframe-server/src/http.rs
   packages/core-rs/crates/mainframe-server/src/fs_utils.rs packages/types/src` and read the diff, not
   just the file list. The only edits to pre-existing files may be: the `routes/mod.rs` module
   registration, the single `.merge(routes::setup_advisor::router())` line in `http.rs`, and the
   `export * from './setup-advisor.js'` line in the types barrel. No existing route path,
   response shape, or WS event may change. (The one other shared-code edit this plan authorizes
   is T10's `fs_utils::walk_project_files` signature — internal, not contract; confirm it is
   still `pub(crate)` and not exported from the crate.)
7. Remove every leftover: no dead code, no stale comment, no `@ts-ignore`, no TODO added by this
   work.
8. `pnpm changeset` — `@qlan-ro/mainframe-types: minor`, `@qlan-ro/mainframe-ui: minor`. Body:
   the new read-only `GET /api/projects/{id}/automation-recommendations` route, the shared
   `setup-advisor` types, and the Setup Advisor sheet; note the resolved `toml` crate version
   added to `packages/core-rs`.
9. `git status --short pnpm-lock.yaml` must be clean. If the lockfile shows a mass deletion,
   `git checkout -- pnpm-lock.yaml`.

**Do not commit and do not push** — the user handles both. `docs/plans/` is gitignored, so this
plan file will not appear in `git status`; that is expected.

---

## Acceptance-criteria coverage

| Spec AC | Task |
|---|---|
| 1 rich fixture fingerprint | T9 / T10 |
| 2 near-empty fixture, thin threshold | T9 / T10, T11 / T12 |
| 3 symlink containment, malformed manifests | T7 / T8, T9 / T10 |
| 4 five-category mapping with expected ids | T17 |
| 5 cap of 2, empty category | T13 / T14, T17 |
| 6 `; rm -rf ~` injection | T14 (type-level `&'static str` + sanitization), T17 (test) |
| 7 route 200 / two 404s | T18 / T19 |
| 8 under 2s on the Mainframe repo | T20 |
| 9 toolbar button opens, fetches on every open | T27 / T28 |
| 10 loading skeleton, no empty flash | T25 / T26 |
| 11 tabs, order, count badges, switching | T25 / T26 |
| 12 rows, copy full command, counter | T25 / T26 |
| 13 project switch, stale response, counter ∩ | T23 / T24, T27 / T28 |
| 14 evidence disclosure | T25 / T26 |
| 15 thin note, empty state | T25 / T26 |
| 16 error state and retry | T25 / T26, T27 / T28 |
| 17 testids and accessible buttons | T25, T27 |
| 18 no writes, no process execution | T10 (impl), T29 step 4 (audit) |
| 19 line limits, rules split per category | T15, T16, T29 step 5 |
| 20 additive contract change | T29 step 6 |

## Open risks carried from the spec

- **skills.sh coverage (T2).** If few registry entries match the signal set, the skills category
  leans on custom-scaffold fallbacks. Acceptable per the spec, but T2 must report the ratio so it
  is a known outcome rather than a surprise at review.
- **Hooks snippets are hand-authored (T16).** The one category with no upstream text to diff
  against. Every snippet needs its documentation reference recorded beside the rule.
- **2-second budget on huge monorepos (T20).** The 5,000-entry cap and root-only manifest reads
  are the defense; T20 measures rather than assumes.
- **Rules fidelity drift.** Nothing tracks claude-code-setup upstream. The provenance headers
  make a manual refresh reviewable; no auto-sync is planned.
