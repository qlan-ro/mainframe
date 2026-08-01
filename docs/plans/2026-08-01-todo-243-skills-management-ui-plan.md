# Todo #243 — Install and uninstall skills from the Setup Advisor (implementation plan)

Spec: `docs/specs/2026-08-01-todo-243-skills-management-ui.md` (committed at `495c7469`, amended `dd06aa24`).
Branch: `todo/243-skills-management-ui-v2`. Route: full.

## Goal

Give the Setup Advisor dialog a second top-level section, Skills, that installs and uninstalls
skills by running the `skills` CLI on the daemon host. The dialog header gains a segmented
Recommendations/Skills control; the Skills section shows an Install band (source field → skill
picker → project/global scope → Install) over the CLI's own install manifest, one row per
CLI-installed skill with an Uninstall button. Both buttons perform the action through four new
Rust daemon routes keyed by project id — no command is ever rendered for the user to copy. The
daemon spawns the CLI with array arguments, the boot-resolved login-shell PATH, the project path
as cwd, stdin closed, a bounded timeout and capped output; it refuses a second concurrent
operation per project, and reports a summarized result whose failure carries the ANSI-stripped
output tail. After a successful operation the section's manifest, the composer `/` popover and
the sidebar Skills tab all revalidate off one shared nonce, with no app reload. When neither the
`skills` executable nor `npx` resolves on the daemon host, the section is replaced by an
explanatory block with no controls.

## Verified codebase facts

Every path below was read, not assumed.

**Advisor shell**

| File | Lines | What it is today |
|---|---|---|
| `packages/ui/src/features/setup-advisor/use-setup-advisor.ts` | 20 | Nav store: `{ open, openSheet(), closeSheet() }`. No section dimension. |
| `packages/ui/src/features/setup-advisor/SetupAdvisorHost.tsx` | 94 | Dialog frame + `DialogHeader` (`shrink-0 border-b border-border px-4 py-3 pr-9`) + `DialogTitle` (icon, "Setup Advisor", project name) + `<SetupAdvisorSheet …/>`. Open-rising-edge fetch effect keyed `[open, projectId, load, clearForProjectSwitch]`. `DialogContent` is `flex max-h-[85vh] w-full max-w-[640px] flex-col gap-0 p-0`. |
| `packages/ui/src/features/setup-advisor/SetupAdvisorSheet.tsx` | 129 | Props-driven body: loading / error / report, `CategoryTabs`, rows, footer. |
| `packages/ui/src/features/setup-advisor/use-setup-advisor-store.ts` | 76 | Report data store, `_loadSeq` stale guard. |
| `packages/ui/src/layout/MainToolbar.tsx` | 269 | Line 97 `const openSetupAdvisor = useSetupAdvisor((s) => s.openSheet);`, line 239 `onClick={openSetupAdvisor}` — the arity trap. Imports `CHIP_BASE` from `@/components/ui/chip` (line 15); defines `ICON_BTN` locally (line 34). |

Existing advisor `data-testid` values, verified by grep — **five literals and two prefixes**:
`automation-recommender-open`, `automation-recommender-sheet`, `automation-recommender-loading`,
`automation-recommender-retry`, `automation-recommender-evidence-toggle`,
`automation-recommender-tab-<category>`, `automation-recommender-copy-<recId>`.

**Skills surfaces**

- `packages/ui/src/features/skills/use-chat-skills.tsx` (136) — `SkillsProvider`, mount effect keyed `[port, adapterId, projectId]`.
- `packages/ui/src/features/context-panel/use-sidebar-skills.ts` (65) — effect keyed `[port, projectPath, adapter]`.
- `packages/ui/src/features/context-panel/SkillsList.tsx` (24) — read-only rows via `ScopedListRow`.
- `packages/ui/src/features/context-panel/BottomPanel.tsx` — count badge is `skills.length` from `useSidebarSkills`.
- `packages/ui/src/features/automations/fields/use-automation-trigger-sources.ts` — the third skills consumer the brief missed. **Not touched** (spec Decision 22).
- `packages/ui/src/lib/api/skills.ts` (10) — `getSkills(port, adapterId, projectPath)`. Unchanged by this work.
- `packages/ui/src/features/daemon/reset-daemon-scoped-stores.ts` (72) — daemon-switch reset; already resets `useSetupAdvisorStore`.

**Daemon (`packages/core-rs`)**

- `crates/mainframe-server/src/respond.rs` — `ok(data)` / `ok_empty()` / `fail(status, error)`.
- `crates/mainframe-server/src/routes/files.rs` — `resolve_base(ctx, project_id, chat_id) -> Result<String, Response>`; `Ok(None)` → `fail(404, "Project not found")`. This is the project-id → path resolver; the new routes use it.
- `crates/mainframe-server/src/ctx.rs` — `AppCtx.resolved_path: ResolvedPath` (the boot login-shell PATH), `AppCtx.adapter_registry`.
- `crates/mainframe-runtime/src/spawn_env.rs` — `ResolvedPath::{resolve, from_value, as_str}`.
- Spawn precedent: `crates/mainframe-automations/src/actions/shell.rs` — `stdin(Stdio::null())`, piped stdout/stderr, `kill_on_drop(true)`, `read_capped` with an 8 MiB cap and kill-on-exceed.
- Timeout precedent: `crates/mainframe-adapter-claude/src/quota_pull.rs` — `tokio::time::timeout` around `.output()`, `.env("PATH", path)`.
- Route mount table: `crates/mainframe-server/src/http.rs` lines 38–80, one `.merge(routes::X::router())` per module; module list in `crates/mainframe-server/src/routes/mod.rs`.
- Module-dir precedent for a large service: `crates/mainframe-server/src/setup_advisor/`.
- Integration-test precedent: `crates/mainframe-server/tests/routes_setup_advisor.rs` with `mod support; use support::{TestServer, spawn_test_server};`.
- No ANSI-strip crate is a dependency anywhere in the workspace. `dashmap` **is** a `mainframe-server` dependency.

**The CLI itself**

`which skills` fails on this machine and `~/.skills` does not exist, so the argument contract is
adopted from the brief (spec Decision 6). One artifact does exist and was read:
`/Users/doruchiulan/Projects/qlan/mainframe/skills-lock.json`, the project-scope lockfile this
repository's own skills were installed with. Its entry shape is
`"<name>": { "source", "sourceType", "skillPath", "computedHash" }` — that is where the manifest
entry's field names in this plan come from, rather than from a guess.

**Design system**

- `packages/ui/src/components/ui/chip.ts` (3 lines) already exports `CHIP_BASE`. `MainToolbar.tsx` only imports it.
- Stale pointers to fix (spec AC 22): `.claude/skills/mainframe-design-system/SKILL.md:82` (Chip / pill table row) and `.claude/skills/mainframe-design-system/references/recipes.md:93–101` (the `## Toolbar chrome — layout/MainToolbar.tsx` block, which defines both `ICON_BTN` and `CHIP_BASE`). `ICON_BTN` genuinely still lives in `MainToolbar.tsx:34`, so only the chip lines move.
- Segmented recipe to copy verbatim: `packages/ui/src/features/tasks/TasksBoard.tsx:108–115` — `ml-auto flex items-center gap-0.5 rounded-[6px] bg-muted p-0.5` track, each button `aria-pressed`, active `bg-background text-foreground shadow-sm`, idle `text-muted-foreground hover:text-foreground`.
- Primitives available: `button.tsx`, `input.tsx`, `select.tsx`, `checkbox.tsx`, `section-header.tsx`, `collapsible.tsx`, `count-badge.tsx`. Toasts via `mfToast` from `@/lib/toast`, never sonner directly.

## Constraints from CLAUDE.md

- Max 300 lines per file, 50 per function — the file split below is designed around this.
- No shell interpolation: array args only, never a shell string.
- No silent catches; every daemon catch logs via `tracing`.
- No sync I/O in the daemon.
- `data-testid` on every interactive element, `<surface>-<element>` kebab-case, keyed by domain id.
- Tests required for new routes and core logic.
- A changeset is required before committing.
- `docs/plans/` is gitignored (`.gitignore:53`) — this plan is committed with `git add -f`, the same
  treatment the previous run applied (recorded as D9 on the todo).

## Wire contract (pinned — both sides implement exactly this)

Base path: `/api/projects/{projectId}/skills-cli/…`. `projectId` is resolved server-side through
`resolve_base`; no route accepts a filesystem path. `adapterId` is an optional query/body field,
looked up in `ctx.adapter_registry` and mapped through a fixed table; it is never forwarded as text.

```
GET  /api/projects/{id}/skills-cli/manifest?adapterId=claude
POST /api/projects/{id}/skills-cli/probe      { "source": "owner/repo", "adapterId": "claude" }
POST /api/projects/{id}/skills-cli/install    { "source": "owner/repo", "skills": ["a"], "scope": "project", "adapterId": "claude" }
POST /api/projects/{id}/skills-cli/uninstall  { "skills": ["a"], "scope": "project", "adapterId": "claude" }
```

Success bodies:

```jsonc
// manifest, CLI present
{ "success": true, "data": { "status": "available", "entries": [
  { "name": "shadcn", "scope": "project", "source": "shadcn/ui", "sourceType": "github", "skillPath": "skills/shadcn/SKILL.md" }
] } }

// manifest, CLI absent
{ "success": true, "data": { "status": "unavailable", "executable": "skills", "packageRunner": "npx skills" } }

// probe
{ "success": true, "data": { "status": "probed", "skills": [ { "name": "shadcn", "description": "…" } ] } }
{ "success": true, "data": { "status": "unparseable" } }

// install / uninstall
{ "success": true }
```

Failure bodies (all four routes):

| Case | Status | Body |
|---|---|---|
| Unknown project id, or a path where an id belongs | 404 | `{ "success": false, "error": "Project not found" }` |
| Rejected source / skill name / scope | 400 | `{ "success": false, "error": "<reason>" }` |
| Second operation for the same project | 409 | `{ "success": false, "error": "A skills operation is already running for this project" }` |
| CLI non-zero exit, spawn failure, timeout | 502 | `{ "success": false, "error": "<reason>", "tail": "<ANSI-stripped tail>", "exitCode": 1 \| null }` |

The 502 body carries two fields beyond the standard envelope. `respond::fail` cannot express them,
so `skills_cli` builds that response itself (`fail_with_tail`), keeping `success`/`error` byte-identical
to the standard shape. On the client, `lib/api/http.ts`'s `request()` discards unknown error fields,
so `lib/api/skills-cli.ts` uses raw `fetch` + `authHeaders()` — the sanctioned escape hatch documented
in `http.ts` for call sites the wrappers cannot serve (`createProject` is the existing one).

CLI argument vectors, built in one place (`args.rs`) and pinned by test:

| Operation | cwd | argv |
|---|---|---|
| manifest, project scope | project path | `["list", "--json"]` |
| manifest, global scope | project path | `["list", "--json", "--global"]` |
| probe | project path | `["add", "<source>", "--list"]` |
| install | project path | `["add", "<source>", "--skill", "<n1>", "--skill", "<n2>", "--agent", "claude-code", "--yes"]` (+ `"--global"` before `--yes` when scope is global) |
| uninstall | project path | `["remove", "--skill", "<n>", "--agent", "claude-code", "--yes"]` (+ `"--global"`) |

Program: the `skills` executable when a directory on `ResolvedPath` holds an executable file named
`skills`; otherwise `npx` with `["skills", …]` prepended to the argv above; otherwise the
CLI-unavailable outcome. Agent map: `claude → claude-code`; every other or absent adapter id →
`claude-code`. Neither `--metadata` (telemetry) nor any `--dangerously-accept-*` flag is ever emitted.

## Decisions taken while planning

Recorded here because they resolve a gap or a tension in the spec; the lane's reviewer should
challenge any of them.

- **D1 — Child-process outcomes are `fail(502)` with a `tail`, not a soft `success: true`.**
  Spec AC 15 says "non-zero-exit mapping to the failure envelope with the captured tail", so a
  non-zero CLI exit is an HTTP failure. The extra `tail`/`exitCode` fields force the raw-`fetch`
  client wrapper described above.
- **D2 — The runner is a function parameter of the service, not a new `AppCtx` field.**
  `AppCtx` is constructed in five places (`ctx.rs::test_ctx`, `mainframe-daemon/src/main.rs`, two
  daemon integration tests, `mainframe-server/tests/support/mod.rs`); adding a field costs all five
  and buys nothing here. `skills_cli::{manifest,probe,install,uninstall}` take `&dyn SkillsCliRunner`;
  route handlers pass `ProcessRunner::new(ctx.resolved_path.clone())`. Argument-vector, exit-mapping,
  manifest-merge and concurrency assertions therefore live in `tests/skills_cli_unit.rs` against a
  recording runner — daemon-side, as the ACs require. Cost: the route→service wiring itself is
  covered only by the route-level shape and rejection tests.
- **D3 — The per-project concurrency guard is a module-level `DashSet` with an RAII drop guard**,
  mirroring the module-level per-project write lock `mainframe_git` already uses. Refusal, not
  queueing: `acquire()` returns `None` while an operation is in flight.
- **D4 — ANSI stripping is hand-rolled** in `run.rs` (CSI + OSC + single-char escapes), not a new
  crate dependency. The workspace has no ANSI crate and the repo hand-rolls small parsers
  (`resolve_executable::parse_version` is the precedent).
- **D5 — Row testids keep the skill name verbatim**: `skills-section-row-<scope>-<name>` and
  `skills-section-uninstall-<scope>-<name>`. Names may contain spaces and dots (spec Decision 17);
  slugging them would collide two skills that differ only in punctuation.
- **D6 — Spec AC 2 says "all six existing advisor `data-testid` values"; the repo has five literals
  plus two prefixes.** The grep test asserts all seven tokens. Flagged rather than silently
  reinterpreted.
- **D7 — The advisor host renders the section body through a two-branch switch, not a lazy import.**
  Neither section pulls a heavy renderer, so `React.lazy` would add a Suspense boundary for nothing.
- **D8 — The recommendation report still fetches when a caller opens straight onto Skills**
  (spec Decision 21). `SetupAdvisorHost`'s effect is unchanged; only its render output branches.
- **D9 — `resetDaemonScopedStores` bumps the revalidation nonce rather than zeroing it.** A monotonic
  counter reset to 0 can equal the value a subscriber already saw and suppress the refetch the daemon
  switch requires.
- **D10 — The Skills section is mounted only while the dialog is open**, so its manifest fetch is a
  mount effect keyed on `[projectId, adapterId, nonce]`. No open-rising-edge machinery is needed.

## Risks

- **R1 (largest, inherited from spec Decision 6) — the CLI argument contract is unverified.** The
  binary is absent from this machine. Every argv lives in `args.rs` behind four small functions with
  one test each, so a wrong flag is a one-line edit plus one test update rather than a rework. The
  probe's list-only flag (`--list`) is the least evidenced of the five: the brief names the behavior
  but not the flag.
- **R2 — the `list --json` payload shape is unverified.** `manifest.rs` parses defensively: accept a
  top-level array, or an object with a `skills` array, or an object whose values are entry objects
  (the lockfile's own shape); require only `name`; treat every other field as optional. An entry
  that yields no name is dropped with a `tracing::warn!`, never a panic.
- **R3 — probe output is TUI text.** `probe_parse.rs` strips ANSI and reads name/description line
  pairs; anything it cannot read returns `status: "unparseable"`, which the UI degrades to manual
  skill-name entry (never a printed command).
- **R4 — `npx skills` on a cold cache can exceed the timeout.** The install timeout is 180 s and the
  manifest/probe timeout 60 s, both constants at the top of `run.rs`.

---

# Tasks

Groups are listed in dependency order. Every task names its files and its verification command.
Red-phase test tasks are expected to fail; that failure is the acceptance criterion.

## Task index

Task numbers are assigned in document order and are what the lane's group extraction refers to.

| # | Task | Group |
|---|---|---|
| 1 | A1 Recording runner + argument-vector tests | A `rust-cli-tests` |
| 2 | A2 Validation, manifest, probe-parse, exit-mapping tests | A |
| 3 | A3 Concurrency-guard test | A |
| 4 | A4 Route-level tests | A |
| 5 | B1 Module skeleton, types, runner seam | B `rust-cli-service` |
| 6 | B2 Binary resolution | B |
| 7 | B3 Argument construction | B |
| 8 | B4 Input validation | B |
| 9 | B5 Process runner, ANSI strip, tail | B |
| 10 | B6 Manifest and probe parsing | B |
| 11 | B7 Per-project concurrency guard | B |
| 12 | B8 Routes and mounting | B |
| 13 | B9 File-size sweep | B |
| 14 | C1 Zod schema tests | C `contract-and-api-tests` |
| 15 | C2 API wrapper tests | C |
| 16 | C3 Revalidation nonce store tests | C |
| 17 | D1 Shared types and schemas | D `contract-and-api` |
| 18 | D2 REST wrapper | D |
| 19 | D3 Revalidation nonce store | D |
| 20 | E1 Store tests | E `skills-section-tests` |
| 21 | E2 Manifest render tests | E |
| 22 | E3 Install band tests | E |
| 23 | E4 Operation outcome tests | E |
| 24 | E5 CLI-unavailable test | E |
| 25 | F1 Section store | F `skills-section` |
| 26 | F2 Manifest row | F |
| 27 | F3 Install band | F |
| 28 | F4 Unavailable block and failure tail | F |
| 29 | F5 Section container | F |
| 30 | G1 Nav store section tests | G `advisor-shell-tests` |
| 31 | G2 Host section tests | G |
| 32 | G3 Existing-testid guard | G |
| 33 | G4 Toolbar arity test | G |
| 34 | H1 Nav store gains a section | H `advisor-shell` |
| 35 | H2 Section switcher | H |
| 36 | H3 Host renders the section | H |
| 37 | H4 Toolbar call-site fix | H |
| 38 | I1 Composer provider revalidates | I `revalidation-tests` |
| 39 | I2 Sidebar hook revalidates | I |
| 40 | I3 Daemon-switch bump | I |
| 41 | I4 Sidebar tab stays read-only + manage link | I |
| 42 | J1 Subscribe the two read surfaces | J `revalidation-wiring` |
| 43 | J2 Bump on daemon switch | J |
| 44 | J3 Sidebar manage link | J |
| 45 | K1 Fix the chip-recipe pointers | K `docs-and-changeset` |
| 46 | K2 Pointer regression test | K |
| 47 | K3 Changeset | K |

Commands used below:

- Rust: `cd packages/core-rs && cargo test -p mainframe-server <filter>`
- UI single file: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <path>`
- UI typecheck: `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- Types build: `pnpm --filter @qlan-ro/mainframe-types build`

---

## Group A — `rust-cli-tests` (test, red)

Owns only `packages/core-rs/crates/mainframe-server/tests/skills_cli_unit.rs` and
`packages/core-rs/crates/mainframe-server/tests/routes_skills_cli.rs`. Both are expected to fail
to compile until Group B lands; that is the red state.

### A1 — Recording runner + argument-vector tests

**File:** `packages/core-rs/crates/mainframe-server/tests/skills_cli_unit.rs` (new)

Header comment states the file is red until `mainframe_server::skills_cli` exists. Define a
`RecordingRunner` implementing `mainframe_server::skills_cli::SkillsCliRunner`, holding
`Mutex<Vec<CommandSpec>>` and a queued `CliOutcome` per call.

Tests:

1. `install_argv_is_add_with_explicit_skills_agent_and_yes` — `install()` with source `owner/repo`,
   skills `["a", "b"]`, scope project, adapter `claude` records exactly
   `["add", "owner/repo", "--skill", "a", "--skill", "b", "--agent", "claude-code", "--yes"]`,
   cwd equal to the project path.
2. `install_global_scope_adds_the_global_flag` — argv contains `"--global"` immediately before `"--yes"`.
3. `uninstall_argv_is_remove_with_skill_agent_scope_and_yes`.
4. `manifest_runs_list_json_twice_once_per_scope` — two recorded specs, `["list","--json"]` and
   `["list","--json","--global"]`.
5. `probe_argv_is_add_source_list`.
6. `no_argv_contains_a_telemetry_or_dangerously_accept_flag` — over every spec recorded by 1–5,
   assert no argument starts with `"--metadata"` or `"--dangerously-accept"` (spec AC 8).
7. `no_argument_derived_from_user_input_starts_with_a_dash` — install with source `owner/repo` and
   skill `"my skill.v2"`; assert every argument after position 0 that is not one of the known
   literal flags does not start with `-` (spec AC 6).
8. `unknown_adapter_falls_back_to_claude_code` — adapter id `"codex"` and `None` both yield
   `--agent claude-code`.

**Verify:** `cargo test -p mainframe-server --test skills_cli_unit` — fails to compile
(`unresolved import mainframe_server::skills_cli`).

### A2 — Validation, manifest, probe-parse and exit-mapping tests

**File:** `packages/core-rs/crates/mainframe-server/tests/skills_cli_unit.rs` (extend)

1. `source_rejected_when_empty_dashed_local_path_or_off_allowlist` — table over `""`, `"   "`,
   `"--yes"`, `"-x"`, `"/etc/passwd"`, `"./local"`, `"~/skills"`, `"file:///tmp"`,
   `"https://evil.example.com/repo"`; each returns the rejection error **and** the recording runner
   has zero recorded specs (spec AC 9).
2. `source_accepted_for_shorthand_https_allowlist_and_ssh` — `"owner/repo"`,
   `"https://github.com/o/r"`, `"https://gitlab.com/o/r"`, `"https://github.com/o/r/tree/main/skills/x"`,
   `"git@github.com:o/r.git"`.
3. `skill_name_allows_spaces_and_dots_and_rejects_dash_prefix_and_control_chars` — accepts
   `"my skill"`, `"a.b"`; rejects `"-x"`, `"a\u{7}b"`, `""` (spec Decision 17).
4. `manifest_merges_project_and_global_entries` — runner returns two JSON payloads; result carries
   both scopes, each entry's `scope` set from which invocation produced it.
5. `manifest_parses_the_lockfile_shaped_object_and_the_array_shape` — both R2 shapes yield the same
   entries; an entry without a name is dropped and the rest survive.
6. `manifest_reports_unavailable_when_neither_binary_resolves` — `resolve_cli` over a `ResolvedPath`
   built from an empty `tempfile::tempdir()` returns the unavailable outcome naming `skills` and
   `npx skills`; the runner is never invoked (spec AC 13).
7. `manifest_prefers_the_skills_executable_over_the_package_runner` — a temp dir containing an
   executable `skills` file resolves to it; a temp dir containing only `npx` resolves to `npx` with
   `"skills"` prepended.
8. `nonzero_exit_maps_to_a_failure_carrying_the_ansi_stripped_tail` — runner returns exit 1 with
   `"\u{1b}[2K\u{1b}[1Ginstalling…\nerror: boom\n"`; the error carries `exit_code: Some(1)` and a
   tail containing `"error: boom"` and no `\u{1b}`.
9. `spawn_failure_and_timeout_map_to_failures_with_their_own_reasons` — distinct reason strings,
   both carrying whatever tail was captured.
10. `tail_is_capped` — a 100 KiB output yields a tail at or under the cap constant.
11. `probe_parse_reads_name_description_pairs_and_reports_unparseable_otherwise`.
12. `probe_with_no_skills_is_probed_with_an_empty_list_not_unparseable` (spec edge case).

**Verify:** same command; still a compile failure.

### A3 — Concurrency-guard test

**File:** `packages/core-rs/crates/mainframe-server/tests/skills_cli_unit.rs` (extend)

1. `second_operation_for_the_same_project_is_refused_while_one_is_in_flight` — hold the guard for
   project `p1`, call `install` for `p1` with a runner that would record, assert the refusal error
   and zero recorded specs (spec AC 10).
2. `a_different_project_is_not_blocked` (spec edge case: per-project guard).
3. `the_guard_is_released_when_the_operation_finishes_and_when_it_fails`.

**Verify:** same command; compile failure.

### A4 — Route-level tests

**File:** `packages/core-rs/crates/mainframe-server/tests/routes_skills_cli.rs` (new)

Modeled on `tests/routes_setup_advisor.rs`: `mod support; use support::{TestServer, spawn_test_server};`.
These exercise only paths that spawn nothing.

1. `manifest_unknown_project_id_is_404_project_not_found`.
2. `manifest_rejects_a_filesystem_path_in_place_of_a_project_id` — `GET …/skills-cli/manifest` with
   the id `%2Ftmp` returns 404 and the body never echoes the path (spec AC 14, Decision 2).
3. `install_rejects_a_local_path_source_with_400_and_the_standard_envelope`.
4. `install_rejects_an_empty_skills_array_with_400` (spec Decision 9 — no install-everything).
5. `install_rejects_a_skill_name_beginning_with_a_dash_with_400`.
6. `uninstall_rejects_an_unknown_scope_value_with_400`.
7. `all_four_routes_answer_the_standard_envelope_shape` — every response body has a boolean
   `success`, and every failure body has a string `error` (spec AC 14).

**Verify:** `cargo test -p mainframe-server --test routes_skills_cli` — 404s on unmounted routes /
compile failure.

---

## Group B — `rust-cli-service` (core, green for Group A)

Depends on `rust-cli-tests`.

### B1 — Module skeleton, types and the runner seam

**Files:**
- `packages/core-rs/crates/mainframe-server/src/skills_cli/mod.rs` (new)
- `packages/core-rs/crates/mainframe-server/src/lib.rs` (edit: `pub mod skills_cli;` after `pub mod setup_advisor;`)

`mod.rs` declares the submodules and holds, under 200 lines:

```rust
pub struct CommandSpec { pub program: String, pub args: Vec<String>, pub cwd: String }
pub struct CliOutcome { pub started: bool, pub timed_out: bool, pub exit_code: Option<i32>, pub output: String }
pub trait SkillsCliRunner: Send + Sync {
    fn run(&self, spec: CommandSpec, timeout_ms: u64) -> BoxFuture<'_, CliOutcome>;
}
pub enum SkillsCliError { Rejected(String), Busy, Cli { reason: String, tail: String, exit_code: Option<i32> } }
pub enum Scope { Project, Global }
pub struct SkillsCliEntry { name, scope, source, source_type, skill_path }   // serde camelCase
pub enum ManifestOutcome { Available { entries: Vec<SkillsCliEntry> }, Unavailable { executable, package_runner } }
pub enum ProbeOutcome { Probed { skills: Vec<ProbedSkill> }, Unparseable }
```

plus the four service entry points `manifest`, `probe`, `install`, `uninstall`, each taking
`(&dyn SkillsCliRunner, &ResolvedPath, project_id: &str, project_path: &str, …) -> Result<_, SkillsCliError>`.
Each is under 50 lines: acquire the guard, validate, resolve the binary, build argv, run, map.

**Verify:** `cd packages/core-rs && cargo check -p mainframe-server`.

### B2 — Binary resolution

**File:** `packages/core-rs/crates/mainframe-server/src/skills_cli/resolve.rs` (new)

`resolve_cli(path: &ResolvedPath) -> Option<CliBinary>`: split `PATH` on `:`, and for each entry
test `<dir>/skills` then `<dir>/npx` for an existing file with any execute bit
(`tokio::fs::metadata` + `std::os::unix::fs::PermissionsExt`, async, no sync I/O). `skills` wins;
`npx` yields `CliBinary { program: "npx", prefix: vec!["skills"] }`; neither yields `None`, which
`manifest` renders as `ManifestOutcome::Unavailable { executable: "skills", package_runner: "npx skills" }`.

**Verify:** `cargo test -p mainframe-server --test skills_cli_unit resolve` — A2 tests 6 and 7 pass.

### B3 — Argument construction

**File:** `packages/core-rs/crates/mainframe-server/src/skills_cli/args.rs` (new)

`agent_for_adapter(Option<&str>) -> &'static str` (fixed map, default `claude-code`),
`list_args(Scope)`, `probe_args(&str)`, `add_args(source, &[String], agent, Scope)`,
`remove_args(&[String], agent, Scope)`. A one-line comment above each names the brief as the source
and R1 as the risk. No function builds a string that is later split.

**Verify:** `cargo test -p mainframe-server --test skills_cli_unit argv` — A1 tests 1–8 pass.

### B4 — Input validation

**File:** `packages/core-rs/crates/mainframe-server/src/skills_cli/validate.rs` (new)

`validate_source(&str) -> Result<(), String>`: reject empty/whitespace; reject a leading `-`; reject
anything starting with `/`, `./`, `../`, `~`, or a `file:`/`git+file:` scheme; accept
`owner/repo` (two non-empty segments, no scheme, no whitespace), `https://<host>/…` where host is in
`ALLOWED_HOSTS = ["github.com", "www.github.com", "gitlab.com", "www.gitlab.com"]`, and
`git@<allowed-host>:owner/repo(.git)?`. Everything else rejected with a sentence naming what is
allowed. `validate_skill_name(&str) -> Result<(), String>`: reject empty, a leading `-`, and any
`char::is_control`; allow spaces and dots.

**Verify:** `cargo test -p mainframe-server --test skills_cli_unit source_ skill_name` — A2 tests
1–3 pass.

### B5 — Process runner, ANSI strip and tail

**File:** `packages/core-rs/crates/mainframe-server/src/skills_cli/run.rs` (new)

`ProcessRunner { path: ResolvedPath }` implementing `SkillsCliRunner`:
`tokio::process::Command::new(program).args(args).current_dir(cwd).env("PATH", path).env("NO_COLOR","1")`,
`stdin(Stdio::null())`, stdout and stderr piped and read with the `read_capped` idiom from
`actions/shell.rs` (cap `MAX_CAPTURE_BYTES = 256 * 1024`), `kill_on_drop(true)`,
`tokio::time::timeout` around the wait. Combined output is stdout followed by stderr. A spawn error
yields `started: false`; a timeout yields `timed_out: true` and whatever was captured. Constants:
`INSTALL_TIMEOUT_MS = 180_000`, `READ_TIMEOUT_MS = 60_000`, `TAIL_CHARS = 4_000`.
`strip_ansi(&str) -> String` removes CSI (`ESC [ … final-byte`), OSC (`ESC ] … BEL|ST`) and
two-character escapes; `tail(&str, TAIL_CHARS)` takes the last N chars on a char boundary.

**Verify:** `cargo test -p mainframe-server --test skills_cli_unit tail ansi nonzero spawn timeout`
— A2 tests 8–10 pass.

### B6 — Manifest and probe parsing

**Files:**
- `packages/core-rs/crates/mainframe-server/src/skills_cli/manifest.rs` (new)
- `packages/core-rs/crates/mainframe-server/src/skills_cli/probe_parse.rs` (new)

`manifest.rs`: `parse_entries(raw: &str, scope: Scope) -> Vec<SkillsCliEntry>` accepting the three
R2 shapes; unnameable entries dropped with `tracing::warn!(scope, "skills CLI manifest entry had no name")`.
`merge(project, global)` concatenates, project first, and does **not** dedupe — two skills with the
same name in different scopes are distinct rows (spec edge case).
`probe_parse.rs`: `parse_probe(raw: &str) -> ProbeOutcome` — strip ANSI, drop spinner-only and
box-drawing lines, read `name — description` / `name: description` / bare-name lines; return
`Probed { skills: [] }` when the output is readable but lists nothing, `Unparseable` when no line
yields a name and the output is non-empty.

**Verify:** `cargo test -p mainframe-server --test skills_cli_unit manifest probe` — A2 tests 4, 5,
11, 12 pass.

### B7 — Per-project concurrency guard

**File:** `packages/core-rs/crates/mainframe-server/src/skills_cli/locks.rs` (new)

`static IN_FLIGHT: LazyLock<DashSet<String>>`; `pub fn acquire(project_id: &str) -> Option<Guard>`
inserting and returning `None` when already present; `Guard` removes on `Drop`. Module doc cites the
module-level per-project write lock in `mainframe_git` as the precedent and states why refusal beats
queueing (the CLI writes a project lockfile).

**Verify:** `cargo test -p mainframe-server --test skills_cli_unit guard` — A3 passes.

### B8 — Routes and mounting

**Files:**
- `packages/core-rs/crates/mainframe-server/src/routes/skills_cli.rs` (new)
- `packages/core-rs/crates/mainframe-server/src/routes/mod.rs` (edit: `pub mod skills_cli;`)
- `packages/core-rs/crates/mainframe-server/src/http.rs` (edit: `.merge(routes::skills_cli::router())` after `routes::skills::router()`)

Four handlers. Each resolves the path with `resolve_base(&ctx, &id, None)`, builds
`ProcessRunner::new(ctx.resolved_path.clone())`, calls the service, and maps `SkillsCliError` to the
table in the wire contract via a local `fail_with_tail(status, error, tail, exit_code)` that emits
`{"success":false,"error":…,"tail":…,"exitCode":…}`. Every `Cli` error is logged
`tracing::warn!(project_id, operation, exit_code, "skills CLI operation failed")` before responding —
no silent catch. Bodies are parsed with `routes::projects::parse_body`, `adapterId` looked up in
`ctx.adapter_registry` and passed to `agent_for_adapter` as `Option<&str>`.

**Verify:** `cargo test -p mainframe-server --test routes_skills_cli` (Group A4 green) and
`cargo test -p mainframe-server` overall; then `cd packages/core-rs && cargo fmt --check && cargo clippy -p mainframe-server`.

### B9 — File-size sweep

No file listed above may exceed 300 lines or hold a function over 50. Run
`wc -l packages/core-rs/crates/mainframe-server/src/skills_cli/*.rs packages/core-rs/crates/mainframe-server/src/routes/skills_cli.rs`
and split any offender (the likely one is `routes/skills_cli.rs` — extract the error mapping into
`skills_cli/response.rs` if so).

**Verify:** the `wc -l` output; `cargo test -p mainframe-server` still green.

---

## Group C — `contract-and-api-tests` (test, red)

Depends on nothing.

### C1 — Zod schema tests

**File:** `packages/types/src/__tests__/skills-cli.test.ts` (new)

Import `SkillsCliManifestSchema`, `SkillsCliProbeSchema`, `SkillsCliFailureSchema` from
`../skills-cli`. Assert: the `available`/`unavailable` discriminated union parses both wire bodies
from the contract table; an entry missing `name` fails; unknown extra fields are tolerated; the
failure schema parses `{ success:false, error, tail, exitCode }` and also `{ success:false, error }`
with `tail` absent.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/skills-cli.test.ts` — fails (module missing).

### C2 — API wrapper tests

**File:** `packages/ui/src/lib/api/__tests__/skills-cli.test.ts` (new)

Stub `global.fetch`. Assert for each of `getSkillsCliManifest`, `probeSkillsSource`,
`installSkills`, `uninstallSkills`:
- the URL is `/api/projects/<encoded id>/skills-cli/<op>` and the id is URL-encoded;
- POST bodies match the contract exactly, including `skills` as an array;
- a 502 body's `tail` and `exitCode` survive onto the thrown error (this is why the wrapper does not
  use `request()`);
- a 409 throws an error whose message is the daemon's refusal sentence;
- a manifest `unavailable` body resolves (does not throw) and is distinguishable by `status`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/api/__tests__/skills-cli.test.ts` — fails.

### C3 — Revalidation nonce store tests

**File:** `packages/ui/src/features/skills/__tests__/use-skills-revalidation.test.ts` (new)

Assert `useSkillsNonce()` starts at 0, `bumpSkillsRevalidation()` called from outside React
increments it, and two bumps produce two distinct values (monotonic, never reset to 0 — D9).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/skills/__tests__/use-skills-revalidation.test.ts` — fails.

---

## Group D — `contract-and-api` (core, green for Group C)

Depends on `contract-and-api-tests`.

### D1 — Shared types and schemas

**Files:**
- `packages/types/src/skills-cli.ts` (new)
- `packages/types/src/index.ts` (edit: `export * from './skills-cli';`)

Zod schemas mirroring the wire contract verbatim, with inferred types
`SkillsCliEntry`, `SkillsCliManifest`, `SkillsCliProbe`, `SkillsCliScope`. Schemas are permissive on
unknown fields (the daemon may add some) and strict on `name`/`status`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types build` then C1's vitest command — green.

### D2 — REST wrapper

**File:** `packages/ui/src/lib/api/skills-cli.ts` (new)

Four functions over raw `fetch` + `apiBase()` + `authHeaders()`, each parsing the envelope with the
D1 schemas. A `success:false` body throws `SkillsCliError extends Error` carrying `tail?: string`
and `exitCode?: number | null`. Module doc states why `request()` is bypassed and points at the
`createProject` precedent in `http.ts`.

**Verify:** C2's vitest command — green. Then `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### D3 — Revalidation nonce store

**File:** `packages/ui/src/features/skills/use-skills-revalidation.ts` (new)

A zustand store `{ nonce: number }` with `useSkillsNonce()` selector and a module-level
`bumpSkillsRevalidation()` callable outside React. Doc comment names its three subscribers and
records D9 and spec Decision 22 (the automations trigger field deliberately does not subscribe).

**Verify:** C3's vitest command — green.

---

## Group E — `skills-section-tests` (test, red)

Depends on `contract-and-api` (these files `vi.mock('@/lib/api/skills-cli')`, which requires the
module to exist).

### E1 — Store tests

**File:** `packages/ui/src/features/setup-advisor/skills/__tests__/use-skills-cli-store.test.ts` (new)

Against a mocked `@/lib/api/skills-cli`:
1. `loadManifest` sets loading, then entries, then clears loading.
2. An `unavailable` manifest sets the unavailable state, not the error state.
3. `install` success bumps the revalidation nonce **and** re-reads the manifest, in that order.
4. `install` failure sets `{ message, tail }` and still re-reads the manifest — the rendered list
   equals what the daemon returned on re-read, never a locally mutated list (spec AC 12).
5. `uninstall` mirrors 3 and 4.
6. A stale in-flight manifest response for a previous project is discarded (`_loadSeq` idiom from
   `use-setup-advisor-store.ts`).
7. Switching project resets manifest, probe and failure state.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/setup-advisor/skills/__tests__/use-skills-cli-store.test.ts` — fails.

### E2 — Manifest render tests

**File:** `packages/ui/src/features/setup-advisor/skills/__tests__/SkillsSection.test.tsx` (new)

1. Loading renders skeleton rows (`skills-section-skeleton`), not a spinner.
2. Populated renders one row per entry with name, source chip and scope chip, project and global
   entries in one list, testids `skills-section-row-project-shadcn` and
   `skills-section-row-global-my skill` (spec AC 5, D5).
3. Empty renders `skills-section-empty` with the copy "No skills installed by the CLI".
4. Two entries sharing a name across scopes render two distinct rows with distinct testids.
5. The Uninstall slot is present in the DOM for every row whether or not any row is running (the
   reserved slot — assert the trailing cell exists on all rows while one shows the running state).
6. The section renders `skills-section-adapter-note` when `adapterId` is present and is not
   `claude` — one line saying the composer and sidebar skill lists show Claude's skills (spec
   "the app's own skill views reflect Claude today", and the edge case at spec:155–157). Implemented
   by F5.
7. The note is absent when `adapterId` is `claude` and when `adapterId` is undefined (an unknown or
   absent adapter is treated as Claude, spec:104–105).

**Verify:** vitest on that file — fails.

### E3 — Install band tests

**File:** `packages/ui/src/features/setup-advisor/skills/__tests__/InstallBand.test.tsx` (new)

1. Empty source: picker and `skills-section-install` are disabled.
2. Typing does **not** call `probeSkillsSource`; blur calls it once; Enter calls it once
   (spec Decision 10).
3. While probing, the picker shows a spinner and Install stays disabled.
4. Probed: the picker lists returned names; Install enables only after a selection; a single-entry
   list still requires an explicit selection (spec edge case).
5. `status: 'unparseable'` swaps the picker for `skills-section-skill-name-input` (manual entry) and
   renders no element whose text contains `npx` (no printed command).
6. A probe that returns zero skills says so and leaves Install disabled, and does **not** show the
   manual-entry input (spec edge case).
7. A rejected source (`-x`, `/tmp/x`, `https://evil.example.com/r`) renders
   `skills-section-source-error` and never calls the probe or install wrapper.
8. While installing, every control in the band and every row's Uninstall is `disabled`.

**Verify:** vitest on that file — fails.

### E4 — Operation outcome tests

**Files:**
- `packages/ui/src/features/setup-advisor/skills/__tests__/SkillsSection.install.test.tsx` (new)
- `packages/ui/src/features/setup-advisor/skills/__tests__/SkillsSection.uninstall.test.tsx` (new)
- `packages/ui/src/features/setup-advisor/skills/__tests__/SkillsSection.failure.test.tsx` (new)

Install: pressing Install calls `installSkills` with the typed source, the selected names and the
chosen scope; on success `mfToast.success` fires (assert against a mocked `@/lib/toast`, never
sonner) and the manifest re-reads. Uninstall: pressing a row's Uninstall calls `uninstallSkills`
with that row's name and the scope the row records (assert a global row sends `global`). Failure:
a thrown `SkillsCliError` with a tail raises `mfToast.error` **and** renders
`skills-section-failure-tail` inside the section; dismissing the toast (unmounting the toast mock)
leaves the tail block in the DOM; the tail block contains no ANSI escape; the rendered rows equal
the re-read manifest, not an optimistic mutation.

**Verify:** vitest on each file separately — all fail.

### E5 — CLI-unavailable test

**File:** `packages/ui/src/features/setup-advisor/skills/__tests__/SkillsSection.unavailable.test.tsx` (new)

1. `status: 'unavailable'` renders `skills-section-cli-unavailable` naming both `skills` and
   `npx skills`.
2. `queryByTestId('skills-section-install')` and every `skills-section-uninstall-*` are absent from
   the DOM (absent, not disabled).
3. No element in the section has a copy affordance or text matching `/npm i|npm install|copy/i`
   beyond the two names (spec AC 13).
4. The section is not rendered as an error and is not hidden — the explanatory block is present.
5. With a remote active daemon (mock `getActiveDaemon()` returning `kind: 'remote'`), the copy names
   the daemon host; with a local one it does not.

**Verify:** vitest on that file — fails.

---

## Group F — `skills-section` (ui, green for Group E)

Depends on `skills-section-tests` and `contract-and-api`. Load the `mainframe-design-system` skill
before writing any markup in this group.

### F1 — Section store

**File:** `packages/ui/src/features/setup-advisor/skills/use-skills-cli-store.ts` (new)

Zustand store: `{ status, entries, probe, installing, uninstallingKey, failure }` plus
`loadManifest`, `probe`, `install`, `uninstall`, `reset`. Stale-response guard via a module-level
`_seq` counter, the `use-setup-advisor-store.ts` idiom. Every operation, success or failure,
re-reads the manifest; success also calls `bumpSkillsRevalidation()`.

**Verify:** E1's vitest command — green.

### F2 — Manifest row

**File:** `packages/ui/src/features/setup-advisor/skills/ManifestRow.tsx` (new)

One line: name (`text-body font-medium truncate` on a `min-w-0` parent), source and scope chips on
`CHIP_BASE` from `@/components/ui/chip`, then a fixed-width trailing slot holding the Uninstall
button whether or not it is running. Testids per D5.

**Verify:** E2's vitest command — rows and reserved-slot assertions green.

### F3 — Install band

**Files:**
- `packages/ui/src/features/setup-advisor/skills/InstallBand.tsx` (new)
- `packages/ui/src/features/setup-advisor/skills/SkillPicker.tsx` (new)

Row: `Input` (`flex-1 min-w-0`, testid `skills-section-source`), `SkillPicker`, a project/global
segmented pair (`skills-section-scope-project` / `-global`), and `Button` `skills-section-install`.
`flex-wrap` so the row wraps to two lines at a narrow width and never scrolls horizontally. Probe
fires on `onBlur` and on Enter, never on change. Inline error under the field in
`text-label text-destructive`. `SkillPicker` renders a multi-select list when probed and an `Input`
(`skills-section-skill-name-input`) when unparseable.

**Verify:** E3's vitest command — green.

### F4 — Unavailable block and failure tail

**Files:**
- `packages/ui/src/features/setup-advisor/skills/CliUnavailable.tsx` (new)
- `packages/ui/src/features/setup-advisor/skills/FailureTail.tsx` (new)

`CliUnavailable` renders one explanatory block naming `skills` and `npx skills`, appending the
daemon-host qualifier when `getActiveDaemon().kind === 'remote'`. No controls, no copy affordance.
`FailureTail` is a `Collapsible` (`skills-section-failure-tail`) holding the tail in a `<pre>` with
`whitespace-pre-wrap break-words`.

**Verify:** E5's vitest command — green; E4's failure file's tail assertions green.

### F5 — Section container

**File:** `packages/ui/src/features/setup-advisor/skills/SkillsSection.tsx` (new)

Props: `{ projectId, adapterId }`. Mount effect keyed `[projectId, adapterId, nonce]` (D10) calling
`loadManifest`. Renders, inside `flex-1 min-h-0 overflow-y-auto` with no `max-h`: the Install band,
the adapter note, a `SectionHeader` eyebrow, then the manifest (skeletons / rows / empty notice),
then `FailureTail` when a failure is held. When the store's status is `unavailable`, the whole body
is replaced by `CliUnavailable`. Keep the component under 50 lines by extracting `ManifestBody` into
the same file or `ManifestList.tsx` if it grows.

**The adapter note.** Rendered directly under the Install band, and only when `adapterId` is present
and is not `claude` — an unknown or absent adapter is treated as Claude and shows nothing
(spec:103–105). It is one static line of `text-label text-muted-foreground` on a
`data-testid="skills-section-adapter-note"` element: "The composer and sidebar skill lists show
Claude's skills." No control, no link, no copyable text. It sits in the available branch, so the
`unavailable` branch never renders it.

**Verify:** E2 and E4's vitest commands — green, including E2 tests 6 and 7. Then
`pnpm --filter @qlan-ro/mainframe-ui typecheck` and `wc -l` on every file in `skills/` (each under
300).

---

## Group G — `advisor-shell-tests` (test, red)

Depends on nothing.

### G1 — Nav store section tests

**File:** `packages/ui/src/features/setup-advisor/__tests__/use-setup-advisor.section.test.ts` (new)

1. Initial state is `{ open: false, section: 'recommendations' }`.
2. `openSheet()` with no argument opens on `recommendations`.
3. `openSheet('skills')` opens on `skills`.
4. `openSheet(<a React-synthetic-event-shaped object>)` normalizes to `recommendations` — the exact
   arity trap (spec AC 3).
5. `openSheet('nonsense' as never)` normalizes to `recommendations`.
6. `closeSheet()` leaves the section value alone; a later bare `openSheet()` still lands on
   `recommendations` (no persistence, spec Decision 20).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/setup-advisor/__tests__/use-setup-advisor.section.test.ts` — fails.

### G2 — Host section tests

**File:** `packages/ui/src/features/setup-advisor/__tests__/SetupAdvisorHost.section.test.tsx` (new)

Mock `@/lib/api/setup-advisor`, `@/features/sessions/use-active-identity`, `../SetupAdvisorSheet`
and `../skills/SkillsSection` the way the existing `SetupAdvisorHost.test.tsx` does. All store
mutations wrapped in `act()`.

1. Opening renders the segmented control (`setup-advisor-section-recommendations` /
   `setup-advisor-section-skills`) inside the header row, with `aria-pressed` on the active one.
2. The default open renders the recommendations body and not the skills stub.
3. Clicking Skills swaps the body; clicking back restores it.
4. `openSheet('skills')` renders the skills stub on first paint.
5. Opening straight onto Skills still calls `getAutomationRecommendations` exactly once (spec AC 4, D8).
6. Switching `projectId` while open on Skills still calls `clearForProjectSwitch` and refetches
   (spec AC 4).
7. The switcher shares the header's flex row with the title (not stacked below it) and the title
   still truncates.

**Verify:** vitest on that file — fails.

### G3 — Existing-testid guard

**File:** `packages/ui/src/features/setup-advisor/__tests__/advisor-testids.test.ts` (new)

Read `SetupAdvisorHost.tsx`, `SetupAdvisorSheet.tsx`, `EvidenceDisclosure.tsx`, `CategoryTabs.tsx`,
`RecommendationRow.tsx` and `layout/MainToolbar.tsx` off disk with `node:fs` and assert all seven
tokens from the verified list are still present (D6). The test names the count discrepancy with
spec AC 2 in a comment.

**Verify:** vitest on that file — passes today and must keep passing (this one is green from the
start; it is a regression guard, not a red test).

### G4 — Toolbar arity test

**File:** `packages/ui/src/layout/__tests__/MainToolbar.advisor.test.tsx` (new)

Render the toolbar (or, if its dependency graph is too heavy, assert on the extracted handler) and
click `automation-recommender-open`; assert the nav store's `section` is `recommendations`, never
a React event object (spec AC 3). Also assert the button's `data-testid` is unchanged.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__/MainToolbar.advisor.test.tsx` — fails on the current 0-arity store.

---

## Group H — `advisor-shell` (ui, green for Group G)

Depends on `advisor-shell-tests` and `skills-section` (the host imports `SkillsSection`).

### H1 — Nav store gains a section

**File:** `packages/ui/src/features/setup-advisor/use-setup-advisor.ts` (edit)

```ts
export type AdvisorSection = 'recommendations' | 'skills';
const SECTIONS: readonly AdvisorSection[] = ['recommendations', 'skills'];
const normalize = (v: unknown): AdvisorSection =>
  typeof v === 'string' && (SECTIONS as readonly string[]).includes(v) ? (v as AdvisorSection) : 'recommendations';
```

`openSheet: (section?: unknown) => set({ open: true, section: normalize(section) })`, plus
`setSection(section: AdvisorSection)`. The `unknown` parameter type is deliberate and commented:
it is what makes the click-event trap impossible to reintroduce.

**Verify:** G1's vitest command — green.

### H2 — Section switcher

**File:** `packages/ui/src/features/setup-advisor/SectionSwitcher.tsx` (new)

The `TasksBoard.tsx:108–115` segmented recipe verbatim: `ml-auto flex items-center gap-0.5
rounded-[6px] bg-muted p-0.5` track; each button `aria-pressed`, active
`bg-background text-foreground shadow-sm`, idle `text-muted-foreground hover:text-foreground`.
Testids `setup-advisor-section-recommendations` and `setup-advisor-section-skills`.

**Verify:** G2's assertions 1 and 7 — green.

### H3 — Host renders the section

**File:** `packages/ui/src/features/setup-advisor/SetupAdvisorHost.tsx` (edit)

Add `<SectionSwitcher …/>` inside the existing `DialogHeader`, in the same flex row as the
`DialogTitle` and pushed right with `ml-auto` so it stays clear of the `pr-9` close-button gutter;
give the title `min-w-0` so it truncates instead of squeezing the control. Branch the body:
`section === 'skills' ? <SkillsSection projectId={projectId} adapterId={adapterId} /> : <SetupAdvisorSheet … />`.
The fetch effect, the `reportForProject` gate, `copiedIds`, `copiedCount` and every existing
`data-testid` are untouched. `adapterId` comes from the already-consumed `useActiveIdentity()`.
Keep the file under 300 lines (it is 94 today; extract the header into `AdvisorHeader.tsx` if the
edit pushes it near the limit).

**Verify:** G2's vitest command green; the pre-existing
`src/features/setup-advisor/__tests__/SetupAdvisorHost.test.tsx` still passes **with no edits to its
assertions** (spec AC 2); G3 still green.

### H4 — Toolbar call-site fix

**File:** `packages/ui/src/layout/MainToolbar.tsx` (edit)

Line 239 becomes `onClick={() => openSetupAdvisor()}`. Nothing else in the file changes.

**Verify:** G4's vitest command — green. Then `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/setup-advisor/__tests__/SetupAdvisorSheet.test.tsx` and `…/SetupAdvisorSheet.copy.test.tsx` to confirm no advisor regression.

---

## Group I — `revalidation-tests` (test, red)

Depends on `contract-and-api` (imports `use-skills-revalidation`).

### I1 — Composer provider revalidates

**File:** `packages/ui/src/features/skills/__tests__/use-chat-skills.revalidate.test.tsx` (new)

Mount `SkillsProvider` with mocked `@/lib/api/skills`, `@/lib/api/agents`, `@/lib/api/projects` and
the chat-extras/draft hooks the existing `use-chat-skills.test.tsx` already mocks. Assert
`getSkills` is called once on mount, and once more after `bumpSkillsRevalidation()` inside `act()`,
with the same arguments (spec AC 11). Assert an unrelated re-render does not refetch.

**Verify:** vitest on that file — fails.

### I2 — Sidebar hook revalidates

**File:** `packages/ui/src/features/context-panel/__tests__/use-sidebar-skills.revalidate.test.tsx` (new)

Same shape over `useSidebarSkills`. Additionally render `BottomPanel` (or assert on the hook's
returned `skills.length`, which is what feeds the count badge) and prove the badge count changes
after a bump when the mocked API returns a shorter list — the badge is part of AC 11.

**Verify:** vitest on that file — fails.

### I3 — Daemon-switch bump

**File:** `packages/ui/src/features/daemon/__tests__/reset-daemon-scoped-stores.skills-nonce.test.ts` (new)

Assert `resetDaemonScopedStores()` **increases** the nonce rather than setting it to 0 (D9), and
that calling it twice yields two distinct values.

**Verify:** vitest on that file — fails.

### I4 — Sidebar tab stays read-only and gains one link

**File:** `packages/ui/src/features/context-panel/__tests__/SkillsList.manage-link.test.tsx` (new)

1. No element matching `/uninstall|install|delete/i` and no `skills-section-*` testid appears in the
   rendered `SkillsList` (spec AC 18).
2. Exactly one link, `sidebar-skills-manage`, is present.
3. Clicking it sets the advisor nav store to `{ open: true, section: 'skills' }`.
4. The link renders in the loading and empty states too, not only when rows exist.

**Verify:** vitest on that file — fails.

---

## Group J — `revalidation-wiring` (ui, green for Group I)

Depends on `revalidation-tests` and `advisor-shell` (I4 asserts `openSheet('skills')`, which needs H1).

### J1 — Subscribe the two read surfaces

**Files:**
- `packages/ui/src/features/skills/use-chat-skills.tsx` (edit)
- `packages/ui/src/features/context-panel/use-sidebar-skills.ts` (edit)

Add `const nonce = useSkillsNonce();` and append `nonce` to each effect's dependency array. Nothing
else changes — in particular the per-list fetch isolation is left alone (todo brief: "do not
restructure that hook beyond adding the subscription").

**Verify:** I1 and I2's vitest commands — green; the pre-existing
`src/features/skills/__tests__/use-chat-skills.test.tsx` still passes unedited.

### J2 — Bump on daemon switch

**File:** `packages/ui/src/features/daemon/reset-daemon-scoped-stores.ts` (edit)

Add `bumpSkillsRevalidation();` with a one-line comment recording D9 (bump, never zero).

**Verify:** I3's vitest command green; the pre-existing
`src/features/daemon/__tests__/reset-daemon-scoped-stores.test.ts` still passes unedited.

### J3 — Sidebar manage link

**File:** `packages/ui/src/features/context-panel/SkillsList.tsx` (edit)

Add one right-aligned caption text-button above the rows, rendered in every state,
`data-testid="sidebar-skills-manage"`, calling `useSetupAdvisor.getState().openSheet('skills')`.
Rows stay read-only. Keep the file under 50 lines per function.

**Verify:** I4's vitest command — green. Then `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

## Group K — `docs-and-changeset` (core)

Depends on nothing.

### K1 — Fix the chip-recipe pointers

**Files:**
- `.claude/skills/mainframe-design-system/SKILL.md` (edit line 82)
- `.claude/skills/mainframe-design-system/references/recipes.md` (edit the `## Toolbar chrome` block, lines 93–101)

`SKILL.md`'s Chip / pill row names `components/ui/chip.ts` as `CHIP_BASE`'s home. In `recipes.md`,
move the `CHIP_BASE` lines out of the `## Toolbar chrome — layout/MainToolbar.tsx` block into their
own short block headed `## Chip / pill — components/ui/chip.ts`, leaving `ICON_BTN` under the
toolbar heading (it genuinely still lives there). No line may name `MainToolbar` alongside
`CHIP_BASE` (spec AC 22).

**Verify:**
```
grep -n "CHIP_BASE" .claude/skills/mainframe-design-system/SKILL.md .claude/skills/mainframe-design-system/references/recipes.md
grep -rn "CHIP_BASE" packages/ui/src | grep -v import
```
The first must show no line also containing `MainToolbar`; the second must show definitions only in
`components/ui/chip.ts`, `TagFilterBar.tsx` and automations' `ChipButton.tsx`.

### K2 — Pointer regression test

**File:** `packages/ui/src/components/ui/__tests__/chip-recipe-pointer.test.ts` (new)

Read both design-system files with `node:fs` and assert: no line contains both `CHIP_BASE` and
`MainToolbar`; both files contain `components/ui/chip.ts`; `recipes.md` still resolves `ICON_BTN` to
`layout/MainToolbar.tsx` (spec AC 22).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/chip-recipe-pointer.test.ts` — green.

### K3 — Changeset

**File:** `.changeset/skills-management-ui.md` (new)

`pnpm changeset`, minor bump for `@qlan-ro/mainframe-ui` and `@qlan-ro/mainframe-types`, patch for
whatever the release pipeline needs for the Rust daemon. One sentence, user-facing: installing and
uninstalling skills from the Setup Advisor.

**Verify:** the file exists and names the packages; the pre-push hook accepts it.

---

## Final verification (run after every group lands)

1. `cd packages/core-rs && cargo fmt --check && cargo clippy -p mainframe-server --all-targets && cargo test -p mainframe-server`
2. `pnpm --filter @qlan-ro/mainframe-types build`
3. `pnpm --filter @qlan-ro/mainframe-ui typecheck`
4. Each new and touched UI test file run individually (large batches hit the cross-file
   `React.act` failure documented in CLAUDE.md).
5. `wc -l` over every file this plan creates or edits — none over 300; spot-check every new function
   under 50 (spec AC 20).
6. `grep -rn "npx skills" packages/ui/src/features/setup-advisor/skills` returns only
   `CliUnavailable.tsx`'s name string — no copy affordance anywhere in the section (spec AC 13).
7. A changeset exists.
