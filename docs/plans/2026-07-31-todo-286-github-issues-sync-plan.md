# GitHub Issues sync for the tasks board — implementation plan

Todo #286 · route:full · branch `todo/286-github-issues-sync`
Spec: [`docs/specs/2026-07-31-todo-286-github-issues-sync.md`](../specs/2026-07-31-todo-286-github-issues-sync.md)
Design direction: settled 2026-07-29 in the todo body (prototype `proto/286-github-issues-sync` @ `d87df80c`).

## Goal

Give the tasks board an explicit, two-way link to a GitHub repository: a project links to one repo, individual
tasks pair with individual issues by an explicit import or publish, and a manual "Sync now" run reconciles every
pair's title, body, state, and syncable labels in both directions. Change detection is a three-way comparison
against a stored per-pair baseline; when both sides changed the same scalar, the more recent change wins (GitHub
wins ties and unresolvable remote stamps) and the replaced value is preserved verbatim in a per-run report. Local
recency comes from a new per-field-family touch map, never from the task row's general `updated_at`. Mainframe's
own pipeline labels never leave the daemon and are never accepted back. Everything lands in the Rust daemon (the
todos plugin plus a GitHub issues client and a new git remote read) and in `packages/ui`'s tasks feature.

## Constraints that bind this plan

- **Max 300 lines/file, 50 lines/function.** `packages/core-rs/crates/mainframe-plugins/src/todos.rs` is already
  **1376 lines** and `packages/ui/src/features/tasks/TaskListRow.tsx` is **310 lines**. No new logic may be added
  to either beyond dispatch-only call sites, and both edits are paired with an extraction task that keeps the file
  from growing (task 11 extracts `warn_open_dependencies` out of `move_todo`; task 38 extracts the row's hover
  cluster into `TaskRowActions.tsx`).
- **Plugin routes return RAW JSON bodies**, not the `ApiResponse` envelope — the UI client uses
  `requestPlugin`/`requestPluginNoContent`. Routes on the daemon's own surface use `ok`/`ok_empty`/`fail`.
- **Validation is typed deserialization plus explicit checks** (spec Decisions). There is no Zod runtime in the
  Rust daemon; the root CLAUDE.md rule naming Zod predates the cutover.
- **No shell interpolation**; every derived `owner/repo` is validated against a strict shape before it reaches a
  URL or a process argument.
- **No secret material** in any log line, error string, report row, or DB column. `Credentials` already carries a
  redacting `Debug`; the new client must not defeat it.
- **Tests required** for every new route, data-layer method, and piece of core logic. `data-testid` on every new
  interactive element, `<surface>-<element>` kebab-case, keyed by the task's **board number** or by the **issue
  number** — never by array index.
- **A changeset is required** (task 55). Never commit to `main`.
- **Do not set `CARGO_TARGET_DIR`** when running cargo in this worktree.

Acceptance criteria 1–37 in the spec are the definition of done; each task below names the criteria it discharges.

## Verified facts this plan is built on

All paths are relative to `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-286-github-issues-sync`.

1. `packages/core-rs/crates/mainframe-plugins/src/todos.rs:383-384` — `patch_todo` builds its UPDATE starting with
   `sets = vec!["updated_at = ?"]` / `vals = vec![text(now_iso8601())]`, **before any field is examined**. This is
   why `updated_at` can never be the local recency clock (spec Decision 2, AC14).
2. `todos.rs:372-377` — `patch_todo` already fetches `existing` (for the status-change notification) before
   writing, so the pre-write values needed for value-comparison stamping are already in hand.
3. `todos.rs:485-531` — `move_todo` issues `UPDATE todos SET status = ?, updated_at = ? WHERE id = ?` **without**
   fetching the row first; the prior status must be read before the write to stamp a state change. The function is
   already 46 lines, so the dependency-warning block must be extracted to make room.
4. `todos.rs:540-549` — `delete_todo` is a bare `DELETE FROM todos WHERE id = ?`; the pairing cascade attaches
   here (AC24).
5. `todos.rs:331-341` — `post_todo` allocates `number` via
   `(SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?)`, so board numbers are reused after a
   deletion — pairings must key on `todo_id`, never on `number` (AC9).
6. `todos.rs:740-787` — `run_migrations` runs `MIGRATION` then probes `PRAGMA table_info(todos)` and applies
   additive `ALTER TABLE`s. New tables hook in here with `CREATE TABLE IF NOT EXISTS`, which is idempotent on a
   database where the migration already ran (AC31).
7. `todos.rs:85` — `safe_json_array(raw, column, todo_id)` is the tolerant JSON-column parser (warns, falls back
   to `[]`); label reads must go through it (AC/edge case: malformed label array).
8. `todos.rs:791-814` — `activate()` runs migrations, registers panels/actions, and returns
   `routes().with_state(ctx)`; `todos.rs:831` opens a full `#[cfg(test)] mod tests` harness (`FakeHostDb`,
   `setup()`, `read()`, `state()`, `create_todo()`, `notifications()`) that new tests reuse.
9. `packages/core-rs/crates/mainframe-types/src/plugin.rs:37-38` — `PluginCapability::HttpOutbound`
   (`"http:outbound"`) **already exists in the enum and is consulted nowhere**. The GitHub port gates on it; no
   types-crate change is needed.
10. `packages/core-rs/crates/mainframe-plugins/src/context.rs:202-213` (`PluginContext`), `:234-242`
    (`PluginContextDeps`), `:245-…` (`build_plugin_context`, one `if has(cap) { real } else { guard }` arm per
    surface, guards in `mod guards` returning `PluginError::CapabilityRequired`) — the injection point for a new
    handle.
11. `packages/core-rs/crates/mainframe-daemon/src/builtin_plugins.rs:51-57` — `TODOS_MANIFEST` declares
    `["storage", "chat:create", "ui:panels", "ui:notifications"]`; `packages/core-rs/crates/mainframe-daemon/src/main.rs:336`
    constructs `PluginManager::new(PluginManagerDeps { host_db, daemon_bus, emit, adapters: None })` — the
    composition root.
12. `packages/core-rs/crates/mainframe-plugins/Cargo.toml` — the plugins crate depends on **neither**
    `mainframe-automations` **nor** `mainframe-git`, and has `reqwest` only as a dev-dependency. It does have
    `dashmap` (used for the one-run-per-project guard).
13. `packages/core-rs/crates/mainframe-automations/src/actions/github.rs:20-30` — `GITHUB_API`,
    `API_VERSION = "2022-11-28"`, and `with_auth()` adding `Accept: application/vnd.github+json` + the version
    header + `bearer_auth(&creds.token)`. `wiremock` is a dev-dependency of this crate only.
14. `packages/core-rs/crates/mainframe-automations/src/credentials.rs` — `Credentials { kind, token, extra }` with
    a hand-written redacting `Debug`, `trait CredentialStore`, and `FileCredentialStore` (0600, atomic
    temp+rename). `credentials.rs:70-78` — the store's `cache: RwLock<BTreeMap<..>>` is filled **once** by
    `load()`, and `credentials.rs:143-145` — `get` reads only that cache, so two stores over the same file do not
    see each other's writes. `packages/core-rs/crates/mainframe-automations/src/service.rs:80` holds
    `credentials: Arc<FileCredentialStore>` as a **private** field; `service.rs:209-228` exposes only
    `credential_labels` / `credential_kind` / `set_credential` / `delete_credential`, none of which returns a token
    or the store. The sole production instance is built at `mainframe-automations/src/service/build.rs:37`; no
    other crate constructs one. The link dialog's token reaches that instance through
    `PUT /api/automation-credentials/github` → `engine.set_credential`
    (`packages/core-rs/crates/mainframe-server/src/routes/automation_admin.rs:113-127`).
24. `packages/core-rs/crates/mainframe-daemon/Cargo.toml:25-38` — the daemon crate depends on `mainframe-plugins`
    and `mainframe-server` but **not** on `mainframe-automations`; the workspace already declares the path
    dependency (`packages/core-rs/Cargo.toml:70`), so adding it is one line.
25. `packages/core-rs/crates/mainframe-daemon/src/main.rs:299,312,336` — the automations engine is built (299) and
    started (312) **before** the `PluginManager` (336), and it is an `Option`: a build failure leaves `None` and
    the daemon serves on.
26. `packages/ui/tsconfig.json` — `{ "include": ["src"] }` with **no `exclude`** and `"noEmit": true`, and UI
    tests live at `src/**/__tests__/*.test.tsx`. `tsc --noEmit` therefore typechecks every red-phase test file
    along with the source.
15. `packages/core-rs/crates/mainframe-automations/src/lib.rs:25-31` — the house pattern for a test module in its
    own file: `#[cfg(test)] mod credentials_tests;`. New Rust tests use this so test files and implementation
    files never collide.
16. `packages/core-rs/crates/mainframe-git/src/git_parse.rs:221-228` — `parse_remotes()` parses `git remote`,
    yielding **names only**. No remote URL is read or exposed anywhere today; the link dialog needs a new read.
17. `packages/core-rs/crates/mainframe-server/src/routes/git.rs:1-27,317-322` — the daemon-surface route pattern:
    `resolve_and_validate_path`, `get_effective_path`, `respond::{ok, fail}`, routes registered in `router()` and
    merged at `packages/core-rs/crates/mainframe-server/src/http.rs:44`.
18. `packages/ui/src/lib/api/todos.ts:1-9,68` — plugin client contract: raw bodies,
    `base = ${apiBase(port)}/api/plugins/todos/todos`, `expectField`. `Todo` keeps raw snake_case columns.
19. `packages/ui/src/features/tasks/TasksBoard.tsx:77-137` — the 52px header: close button first (left), then
    glyph/title/count, then `ml-auto` List/Board switch and `tasks-board-new`. The sync control joins that
    **right-aligned trailing group** (spec "Brief-vs-code notes").
20. `packages/ui/src/features/tasks/TaskListRow.tsx:17-26` and `TaskCard.tsx:34-40` — **neither receives `port` or
    `projectId`**. Row-level sync controls therefore cannot thread them from props; the GitHub sync store holds
    them instead (see Decision D4).
21. `packages/ui/src/features/tasks/TaskListRow.tsx:185` and `TaskCard.tsx:181` — the single
    `opacity-0 group-hover:opacity-100` action cluster holding start/edit/delete, testids
    `tasks-list-row-*-${todo.number}` / `tasks-card-*-${todo.number}`. The unlink control joins this cluster
    (AC26).
22. `packages/ui/src/components/ui/hint.tsx:6,20` — the `Hint` prop is **`label`**, not `content`.
23. `packages/ui/src/features/tasks/use-todos-store.ts:36-37,67-79` — the zustand store threads `port`/`projectId`
    per call and uses a module-level `_loadSeq` stale-completion guard, the pattern the new store mirrors.

## Decisions taken while planning

- **D1 — the GitHub issues client lives in `mainframe-automations`, behind a port trait owned by
  `mainframe-plugins`.** The plugins crate depends on neither automations nor git (fact 12), so it declares
  `trait GitHubIssues` and the daemon injects the implementation at the composition root (fact 11). The client
  itself goes in the automations crate because the credential store, `reqwest`, `wiremock`, and the GitHub header
  conventions are already there (facts 13, 14); a new crate would have to depend on automations for credentials
  anyway. The naming mismatch ("automations" hosting a todos client) is the accepted cost.
- **D2 — the port is gated on the existing `http:outbound` capability** (fact 9), added to `TODOS_MANIFEST`. No
  new capability variant, no types-crate change.
- **D3 — the touch map records `title`, `body`, and `state` only.** Labels are reconciled three-way and consult no
  clock (spec), so a label change time would never be read. This also makes AC14's "workflow-label-only write
  moves nothing" structural rather than conditional.
- **D4 — the GitHub sync store holds `port` and `projectId`**, seeded by `TasksBoard` via `init(port, projectId)`,
  diverging from `use-todos-store`'s per-call threading. Forced by fact 20: `TaskListRow`/`TaskCard` receive
  neither, and prop-drilling them would change three files this plan otherwise leaves alone.
- **D5 — the report dialog and the publish dialog are mounted once in `TasksBoard` and opened through store
  actions**, not through callbacks drilled to rows. This keeps the row components free of new props and lets the
  amber glyph open the report without touching `TaskListView`/`TaskBoardView`.
- **D6 — the issues client is built with `redirect::Policy::none()`.** A transferred issue answers `301`; following
  it would silently re-point a pair at a repository the project is not linked to (AC25).
- **D7 — Rust tests live in their own files** (`*_tests.rs`, fact 15) but are written by the same group that writes
  the implementation, test task first. A red-phase Rust test file that references a not-yet-existing module fails
  the **whole crate's** compilation, which would block every other Rust group; keeping the pair inside one group
  confines the red phase. UI tests have no such coupling (vitest fails per file), so they are a separate
  red-phase group (group `ui-sync-tests`) that the UI implementation groups depend on.

## Wire contract (frozen — implementation and UI both build to this)

### Todos plugin sub-router — raw JSON bodies, base `/api/plugins/todos/github`

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/link?projectId=` | — | `{ link: Link \| null, running: boolean, latestRunId: string \| null }` |
| PUT | `/link` | `{ projectId, owner, repo, remoteName, credentialLabel }` | `{ link: Link }`, `409` if already linked |
| DELETE | `/link?projectId=` | — | `204` |
| GET | `/pairs?projectId=` | — | `{ pairs: Pair[] }` |
| DELETE | `/pairs/{todoId}` | — | `204` |
| GET | `/issues?projectId=` | — | `{ issues: RemoteIssue[] }` (open only) |
| POST | `/import` | `{ projectId, issueNumbers: number[] }` | `{ imported: [{ issueNumber, todoId, todoNumber }], skipped: [{ issueNumber, reason }] }` |
| POST | `/publish` | `{ projectId, todoId }` | `{ pair: Pair }`, `409` if already paired |
| POST | `/sync` | `{ projectId }` | `{ run: RunSummary }`, `409` while a run is in progress |
| GET | `/report?projectId=[&runId=]` | — | `{ report: Report \| null }` |

```
Link        { projectId, owner, repo, remoteName, credentialLabel, lastSyncedAt: string | null }
Pair        { todoId, todoNumber, issueNumber, issueUrl, pairState: 'clean'|'overwritten'|'errored'|'remotely-unlinked', stateReason: string | null }
RemoteIssue { number, title, labels: string[], pairedTodoNumber: number | null }
RunSummary  { runId, finishedAt, pairsReconciled, overwrites, failure: Failure | null, reached, total }
Failure     { kind: 'auth'|'rate-limit'|'network', message, reached, total }
Report      { runId, finishedAt, pairsReconciled, failure: Failure | null, rows: ReportRow[] }
ReportRow   { id, todoNumber, todoTitle, issueNumber, field: 'title'|'body'|'state',
              winner: 'github'|'mainframe', rule: 'recency'|'tie'|'in-progress-close',
              localAt: string | null, remoteAt: string | null, remoteCoarse: boolean,
              winningValue: string, replacedValue: string }
```

`localAt`/`remoteAt` are `null` whenever the decision did not compare that stamp (AC21): `recency` carries both;
`tie` carries both when the stamps were equal and `remoteAt: null` when the remote stamp was unresolvable;
`in-progress-close` carries neither.

### Daemon surface — `ok`/`fail` envelope

| Method | Path | Response |
|---|---|---|
| GET | `/api/projects/{id}/git/github-remotes?chatId=` | `ok({ remotes: [{ name, owner, repo }] })` |

Only remotes whose URL yields a valid `owner/repo` are returned (AC2).

## Database schema (todos plugin `data.db`, additive)

```sql
CREATE TABLE IF NOT EXISTS github_links (
  project_id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL,
  remote_name TEXT NOT NULL DEFAULT '', credential_label TEXT NOT NULL,
  last_synced_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS github_pairs (
  todo_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL, issue_url TEXT NOT NULL,
  pair_state TEXT NOT NULL DEFAULT 'clean', state_reason TEXT,
  base_title TEXT NOT NULL, base_body TEXT NOT NULL, base_state TEXT NOT NULL,
  base_labels TEXT NOT NULL DEFAULT '[]', base_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS github_pairs_issue
  ON github_pairs(project_id, owner, repo, issue_number);

CREATE TABLE IF NOT EXISTS github_touch (
  todo_id TEXT NOT NULL, field TEXT NOT NULL, changed_at TEXT NOT NULL,
  PRIMARY KEY (todo_id, field));

CREATE TABLE IF NOT EXISTS github_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL,
  pairs_reconciled INTEGER NOT NULL DEFAULT 0, reached INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0, failure_kind TEXT, failure_message TEXT);

CREATE TABLE IF NOT EXISTS github_report_rows (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, todo_id TEXT NOT NULL, todo_number INTEGER NOT NULL,
  todo_title TEXT NOT NULL, issue_number INTEGER NOT NULL, field TEXT NOT NULL,
  winner TEXT NOT NULL, rule TEXT NOT NULL, local_at TEXT, remote_at TEXT,
  remote_coarse INTEGER NOT NULL DEFAULT 0, winning_value TEXT NOT NULL, replaced_value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS github_report_rows_run ON github_report_rows(run_id);
```

`base_state` and the state projection use `'open'` / `'closed'`. `todo_id` is the pairing key, never `number`
(fact 5).

## UI module contract (frozen so the red-phase test group can be written first)

```ts
// features/tasks/github/sync-format.ts
export function statusLabel(s: TodoStatus): 'Open' | 'In progress' | 'Done';
export function syncedAgo(iso: string | null): string;              // 'never synced' | 'synced 3m ago'
export function ruleLine(row: ReportRow): string;                    // the three fixed strings + coarse suffix
export function fieldLabel(f: ReportRow['field']): 'Title' | 'Body' | 'State';
export function winnerLabel(w: ReportRow['winner']): 'GitHub won' | 'Mainframe won';
export function nowLine(row: ReportRow, todoNumber: number): string; // literal value, or 'the body shown on task #N'

// features/tasks/github/use-github-sync-store.ts  (zustand)
interface GitHubSyncState {
  port: number | null; projectId: string | null;
  link: Link | null; pairs: Record<string, Pair>;      // keyed by todoId
  running: boolean; lastRun: RunSummary | null; report: Report | null;
  issues: RemoteIssue[]; loading: boolean; error: string | null;
  dialog: null | { kind: 'link' } | { kind: 'import' } | { kind: 'publish'; todo: Todo } | { kind: 'report' };
  bannerDismissed: boolean;
  init(port: number, projectId: string): void;
  load(): Promise<void>;
  openDialog(d: GitHubSyncState['dialog']): void; closeDialog(): void;
  linkRepo(input: LinkInput): Promise<void>; unlinkRepo(): Promise<void>;
  loadIssues(): Promise<void>; importIssues(numbers: number[]): Promise<void>;
  publish(todoId: string): Promise<void>; unlinkPair(todoId: string): Promise<void>;
  sync(): Promise<void>; loadReport(runId?: string): Promise<void>; dismissBanner(): void;
}
```

`import`/`publish`/`sync`/`unlinkPair` refetch the todos store afterwards (`useTodosStore.getState().load(...)`),
mirroring its refetch-on-mutation contract.

### data-testid inventory

`tasks-github-link` · `tasks-github-pill` · `tasks-github-menu-sync` · `tasks-github-menu-import` ·
`tasks-github-menu-report` · `tasks-github-menu-unlink` · `tasks-github-link-dialog` ·
`tasks-github-remote-${name}` · `tasks-github-link-confirm` · `tasks-github-link-cancel` ·
`tasks-github-import-dialog` · `tasks-github-import-all` · `tasks-github-import-issue-${issueNumber}` ·
`tasks-github-import-confirm` · `tasks-github-publish-dialog` · `tasks-github-publish-confirm` ·
`tasks-github-publish-cancel` · `tasks-github-banner` · `tasks-github-banner-report` ·
`tasks-github-banner-dismiss` · `tasks-github-report-dialog` · `tasks-github-report-row-${id}` ·
`tasks-github-report-copy-${id}` · `tasks-list-row-publish-${number}` · `tasks-list-row-unlink-${number}` ·
`tasks-list-row-pair-${number}` · `tasks-card-publish-${number}` · `tasks-card-unlink-${number}` ·
`tasks-card-pair-${number}`.

---

## Tasks

Verification commands run from the worktree root unless stated. Rust:
`cd packages/core-rs && cargo test -p <crate> <filter>`. UI:
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`.

Two rules hold across every task below.

- **Every `*_tests.rs` file under `todos_github/` is declared `#[cfg(test)] mod <name>;` in `todos_github/mod.rs`
  by the task that creates it** (the house pattern, fact 15). A `.rs` file no `mod` declaration references is not
  compiled: `cargo test` reports 0 tests and exits 0, and `cargo clippy --all-targets` stays green, so a forgotten
  declaration is a silent false pass, not a red phase. `todos_github/mod.rs` and its `pub mod todos_github;` line
  in `mainframe-plugins/src/lib.rs` are created by task 6, before the first test file.
- **The UI typecheck gate runs exactly once, on task 37**, plus the final verification block. `packages/ui`'s
  tsconfig has no `exclude` (fact 26), so `tsc --noEmit` compiles the red-phase test files from tasks 25–29 too.
  Those tests import components that tasks 33–40 create, so any earlier gate fails with TS2307. Task 37 is the
  last UI task — its group `ui-header-link` depends on every other UI group — and is the first point at which the
  whole tree exists. Reordering cannot move the gate earlier: `ui-api-store` is by construction the first UI
  implementation group. Earlier UI tasks verify with vitest only.

### Group `rust-github-client` — the issues client, the port, and the daemon wiring

**Task 1 — extract the shared GitHub HTTP conventions.**
Create `packages/core-rs/crates/mainframe-automations/src/github_http.rs` holding `GITHUB_API`, `API_VERSION`, and
`pub fn github_headers(req: RequestBuilder) -> RequestBuilder` (Accept + version header only — auth stays at the
call site so `ActionCtx` does not leak into the new client). Repoint
`packages/core-rs/crates/mainframe-automations/src/actions/github.rs` at it (delete its local `GITHUB_API` /
`API_VERSION` and have `with_auth` call `github_headers`). Declare `pub mod github_http;` in
`packages/core-rs/crates/mainframe-automations/src/lib.rs`.
*Verify:* `cargo test -p mainframe-automations github` — all existing action tests still pass.

**Task 2 — failing tests for the issues client.**
Create `packages/core-rs/crates/mainframe-automations/src/github_issues_tests.rs` (declared
`#[cfg(test)] mod github_issues_tests;` in `lib.rs`), wiremock-backed, covering: list open issues (pagination
follows `Link: rel="next"`); get issue; `issue_field_times` reading the timeline for `renamed`/`closed`/`reopened`
and returning `None` per family when absent; create issue; update issue (title/body/labels); close-as-completed
(`state: "closed", state_reason: "completed"`) and reopen; `404` → `GitHubError::NotFound`; `301` → `Moved`
without following the redirect; `401` → `Auth`; `403` + `Retry-After` and `429` + `X-RateLimit-Reset` →
`RateLimited` carrying the wait; a network failure → `Network`; and an assertion that no error `Display` string or
`Debug` output contains the bearer token (AC29, AC30, AC25).
*Verify:* `cargo test -p mainframe-automations github_issues` fails to compile (red phase — the module does not
exist yet).

**Task 3 — implement the issues client.**
Create `packages/core-rs/crates/mainframe-automations/src/github_issues.rs` with `RepoRef { owner, repo }`,
`IssueSnapshot { number, title, body, labels, state, html_url, updated_at }`, `IssueState { Open, Closed }`,
`IssueFieldTimes { title_at, state_at }`, `CreateIssue`, `IssuePatch`, `GitHubError`, and
`struct GitHubIssuesClient { base_url, http }` built with `reqwest::redirect::Policy::none()` (D6) and a
`with_base_url()` constructor for wiremock. Split into `github_issues/` submodules if the file passes 300 lines.
Export from `lib.rs`.
*Verify:* `cargo test -p mainframe-automations github_issues` passes; `cargo clippy -p mainframe-automations`
clean.

**Task 4 — declare the port trait in the plugins crate.**
Create `packages/core-rs/crates/mainframe-plugins/src/github_port.rs` with a dyn-safe
`pub trait GitHubIssues: Send + Sync` over `BoxFuture` (`list_open_issues`, `get_issue`, `issue_field_times`,
`create_issue`, `update_issue`), plus crate-local mirrors of the DTOs above (the plugins crate must not depend on
automations — fact 12) and `GitHubPortError`. Add `pub github: Arc<dyn GitHubIssues>` to `PluginContext`
(`context.rs:202`) and `pub github: Option<Arc<dyn GitHubIssues>>` to `PluginContextDeps` (`context.rs:234`); in
`build_plugin_context`, wire the real handle when `has(PluginCapability::HttpOutbound)` **and** the dep is
`Some`, otherwise `guards::GuardGitHub` (D2, fact 10). The guard carries the reason it was installed and fails
every method with it: capability missing → `PluginError::CapabilityRequired("http:outbound")` (verbatim house
text); dependency absent → `PluginError::Message("GitHub sync is unavailable: the automations engine did not
start, so no credential store is available.")`. It never panics and never reaches the network. Export from
`lib.rs`. Add a test in a new `packages/core-rs/crates/mainframe-plugins/src/github_port_tests.rs` asserting both
guard texts — one manifest without the capability, one context built with `github: None`.
*Verify:* `cargo test -p mainframe-plugins github_port`.

**Task 5 — wire the adapter in the daemon over the engine's own credential store.**

*5a — expose the store the link dialog writes to.* Add
`pub fn credentials(&self) -> Arc<dyn CredentialStore>` to `AutomationsEngine`
(`packages/core-rs/crates/mainframe-automations/src/service.rs`), returning a clone of the private
`credentials` field coerced to the trait object. This accessor is the port's **only** permitted credential source.
Do not construct a second `FileCredentialStore` anywhere: the store caches the file once at `load()` and `get`
reads only that cache (fact 14), while the first-run flow writes the token through the engine's instance
(link dialog → `CredentialConnect` → `PUT /api/automation-credentials/github` → `engine.set_credential`). A
boot-time snapshot at the composition root would answer `get("github")` with `None` forever, failing AC1, AC3,
AC6 and AC8 on every fresh install until the daemon restarts.

*5b — the adapter.* Create `packages/core-rs/crates/mainframe-daemon/src/github_issues_port.rs` implementing the
plugins-crate trait over `mainframe_automations::github_issues::GitHubIssuesClient`. It takes
`Arc<dyn CredentialStore>` at construction, calls `get(label)` **per request** (so a token connected after boot
works without a restart), and maps `GitHubError` → `GitHubPortError`. A label with no stored credential is
`GitHubPortError::Auth` with the text `No GitHub credential is stored for '<label>'. Link the repository again to
connect one.` — a readable reason carrying no token material. Add
`mainframe-automations = { workspace = true }` to `packages/core-rs/crates/mainframe-daemon/Cargo.toml`
(fact 24; the workspace path entry already exists).

*5c — composition.* Add `"http:outbound"` to `TODOS_MANIFEST` (`builtin_plugins.rs:57`) and thread
`github: Option<Arc<dyn GitHubIssues>>` through `PluginManagerDeps` / `load_builtin` into `PluginContextDeps`. At
`main.rs:336` the engine already exists (fact 25) but is an `Option`: build the port inside
`if let Some(automations) = &automations` from `automations.credentials()`, and pass `github: None` otherwise. The
`None` arm is not an error path to hide — task 4's guard then answers every GitHub call with the
"automations engine did not start" message, the routes surface it as a `503`-class failure with that text, and the
daemon serves everything else.
*Verify:* `cargo check -p mainframe-daemon`; `cargo test -p mainframe-daemon`; `cargo test -p mainframe-automations
credentials` (the accessor must not disturb the existing store tests); the daemon boots
(`cargo run -p mainframe-daemon` with `DAEMON_PORT=31500 MAINFRAME_DATA_DIR=/tmp/mf-286`, `curl :31500/health`);
and, against that daemon, `PUT /api/automation-credentials/github` followed by a GitHub plugin call **in the same
process** resolves the token — no restart between the two.

### Group `todos-sync-store` — labels, schema, store, touch map

**Task 6 — the module root, then failing tests for the workflow-label denylist.**
First create `packages/core-rs/crates/mainframe-plugins/src/todos_github/mod.rs` (empty of submodules for now) and
add `pub mod todos_github;` to `packages/core-rs/crates/mainframe-plugins/src/lib.rs`. Without them no file under
`todos_github/` is compiled at all, and this task's red phase would be `cargo test` exiting 0 on 0 tests.
Then create `packages/core-rs/crates/mainframe-plugins/src/todos_github/labels_tests.rs`, declared
`#[cfg(test)] mod labels_tests;` in `mod.rs`: each of the seven prefixes
(`route:`, `gate:`, `approved:`, `rework:`, `pipeline:`, `pr:`, `wayfinder:`) and each of the seven exact labels
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, `parked`, `dispatched`) is a
workflow label; ordinary labels (`bug`, `routes`, `pr-review`) are not; `syncable(local)` strips them and
`merge_inbound(local, remote)` never introduces one; a test greps the crate source to assert the list is declared
exactly once (AC27, AC28).
*Verify:* `cargo test -p mainframe-plugins todos_github::labels` **fails to compile** — the declared test module
resolves `super::labels`, which does not exist yet. A run that compiles, or one reporting `0 tests`, means the
`mod` declarations were skipped and the red phase did not happen.

**Task 7 — implement `todos_github/labels.rs`.**
`WORKFLOW_LABEL_PREFIXES`, `WORKFLOW_LABELS`, `is_workflow_label`, `syncable_labels`, `keep_workflow_labels`,
declared `pub mod labels;` in the `todos_github/mod.rs` task 6 created.
*Verify:* `cargo test -p mainframe-plugins todos_github::labels` — green, with a non-zero test count.

**Task 8 — failing tests for the schema and store.**
Create `packages/core-rs/crates/mainframe-plugins/src/todos_github/store_tests.rs` reusing the `todos.rs` test
harness (fact 8): migration on a fresh DB, on a DB holding pre-existing todos with none of this feature's state,
and on a DB where it already ran (AC31); link upsert/read/delete; pair insert, read-by-todo, read-by-issue,
`UNIQUE` rejection of a duplicate issue pairing (AC4); baseline read/write; `pair_state` transitions; delete-todo
cascade (AC24); the renumbering case — delete the highest-numbered todo, create a new one that reuses the number,
assert the pair still resolves by `todo_id` and the new todo is unpaired (AC9); run + report-row insert, latest
report read, and pruning to ten runs (AC23).
*Verify:* red.

**Task 9 — implement the schema and store.**
`todos_github/schema.rs` (the DDL above + `run_github_migrations(&PluginContext)`, called from `run_migrations` in
`todos.rs:740` — one added line) and `todos_github/store/` split as `link.rs`, `pairs.rs`, `runs.rs`, `mod.rs`,
each under 300 lines. All label columns read through `safe_json_array` (fact 7).
*Verify:* `cargo test -p mainframe-plugins todos_github::store`.

**Task 10 — failing tests for the touch map.**
Create `packages/core-rs/crates/mainframe-plugins/src/todos_github/touch_tests.rs`, driving the real routes
through the `todos.rs` harness: creating a todo stamps title/body/state; a PATCH that changes the title stamps
only `title`; a PATCH that rewrites a field with the value it already holds stamps nothing; a PATCH that changes
only workflow labels stamps nothing; a PATCH that changes only `priority`/`milestone`/`assignees` stamps nothing;
`move` between `open` and `in_progress` stamps nothing; `move` to `done` and back stamps `state`; and an explicit
assertion that the stamped time is not simply the row's `updated_at` — i.e. a workflow-label PATCH advances
`updated_at` while every touch row is unchanged (AC14).
*Verify:* red.

**Task 11 — implement stamping and the delete cascade.**
Create `todos_github/touch.rs` with `stamp_create`, `stamp_patch(ctx, id, existing, body)`,
`stamp_move(ctx, id, prev_status, next_status)` (projection-aware: `done` ↔ not-`done` only),
`clear_for_todo(ctx, id)`, and `read_touch(ctx, id)`. Edit `todos.rs` **dispatch-only**: one call after the insert
in `post_todo`, one after the update in `patch_todo` (reusing the `existing` row from fact 2), a `fetch_row`
before the UPDATE in `move_todo` plus one call after it, and `clear_for_todo` + `DELETE FROM github_pairs WHERE
todo_id = ?` in `delete_todo`. Extract `move_todo`'s dependency-warning block into
`async fn warn_open_dependencies(ctx, todo)` so the function stays under 50 lines (fact 3).
*Verify:* `cargo test -p mainframe-plugins todos_github::touch` and `cargo test -p mainframe-plugins todos::` (the
existing suite must stay green); `wc -l` on the touched functions confirms the 50-line limit.

### Group `sync-engine` — reconciliation, run driver, report, pair creation

**Task 12 — failing tests for pure reconciliation.**
Create `packages/core-rs/crates/mainframe-plugins/src/todos_github/reconcile_tests.rs` against a pure
`reconcile(local, remote, baseline, touch) -> Reconciliation` with no I/O: one-sided title/body/state in each
direction with the timestamps deliberately set to the *losing* order, proving no clock was consulted (AC10);
neither side changed → empty plan (AC17, including an issue whose `updated_at` advanced with no field change);
both-changed title with local newer and with remote newer (AC11); both-changed body against the issue's coarse
`updated_at`, flagged `remote_coarse` (AC12); equal-to-the-second stamps → GitHub wins, rule `tie` with both
stamps; unresolvable remote stamp → GitHub wins, rule `tie` with `remote_at: None` (AC13); the three-way label
cases — added locally survives, removed remotely is removed locally, removed on both stays gone — with no report
row (AC16, AC22); workflow labels absent from every outbound set and never introduced inbound (AC27); an
`in_progress` local with a remote close → `done`, rule `in-progress-close`, both stamps `None` (AC20); an
`in_progress` local with no remote change → zero outbound writes (AC19); an applied inbound change producing a
new baseline that yields an empty plan on a second reconcile (AC15).
*Verify:* red.

**Task 13 — implement `todos_github/reconcile.rs`.**
Pure module: `LocalTask`, `RemoteIssueView`, `Baseline`, `TouchTimes` in, `Reconciliation { local_writes,
remote_writes, report_rows, next_baseline }` out. Timestamps compared truncated to whole seconds. Split into
`reconcile/{fields.rs, labels.rs, state.rs, mod.rs}` if over 300 lines.
*Verify:* `cargo test -p mainframe-plugins todos_github::reconcile`.

**Task 14 — failing tests for the run driver and report retention.**
Create `packages/core-rs/crates/mainframe-plugins/src/todos_github/run_tests.rs` with a `FakeGitHub` implementing
the port and recording every call: a run reconciles every pair and writes new baselines; **an unpaired todo never
appears in any recorded outbound call and is never fetched** (AC7); a per-pair `Request` error marks that pair
`errored` and the run continues (spec "Failures"); a `NotFound`/`Moved` marks the pair `remotely-unlinked`, leaves
the todo intact, and the pair is skipped by a following run (AC25); a `RateLimited` mid-run stops the run, leaves
unreached pairs untouched, keeps the baselines already written, honours `Retry-After` instead of retrying (AC29,
AC30); an `Auth` failure produces a readable message containing no token (AC29); a second run with nothing changed
issues zero outbound writes (AC19); eleven runs leave exactly ten reports (AC23); a run with no overwrites
produces an empty report (AC22).
*Verify:* red.

**Task 15 — implement `todos_github/run.rs`.**
The driver: read the link, load pairs, fetch each issue (+ field times only when a scalar dispute is possible),
call `reconcile`, apply local writes **without stamping the touch map** (D3/AC15) while still advancing
`updated_at`, apply remote writes, persist baselines per pair, accumulate report rows, prune to ten runs, update
`last_synced_at`. One run per project at a time via a `DashMap<String, ()>` guard (fact 12, AC35). Split into
`run/{fetch.rs, apply.rs, mod.rs}` as needed.
*Verify:* `cargo test -p mainframe-plugins todos_github::run`.

**Task 16 — failing tests for pair creation.**
Create `packages/core-rs/crates/mainframe-plugins/src/todos_github/pairing_tests.rs`: import creates one todo per
issue with the issue's title, body verbatim, `open` status, syncable labels only, plus a pair and a baseline
(AC3, AC5); re-import over the same issues creates no duplicate todo or pair and reports them as skipped (AC4);
publish creates the issue from the task's title/body/syncable labels, records pair + baseline (AC6); publishing a
`done` task creates the issue and closes it as completed (AC6); publishing an already-paired task is refused;
listing issues annotates already-paired ones with their `todoNumber` (AC4).
*Verify:* red.

**Task 17 — implement `todos_github/pairing.rs`.**
`list_remote_issues`, `import_issues`, `publish_task` — each returning the wire shapes above.
*Verify:* `cargo test -p mainframe-plugins todos_github::pairing`.

### Group `todos-sync-routes` — the plugin sub-router

**Task 18 — failing route tests.**
Create `packages/core-rs/crates/mainframe-plugins/src/todos_github/routes_tests.rs` exercising all ten routes
through the harness: happy paths and shapes exactly as frozen above; missing/blank `projectId` → `400`; a
non-object or wrong-typed body → `400`; a second link → `409`; publish of an already-paired todo → `409`; sync
while running → `409` with a readable message; report for a project with no runs → `{ report: null }`; delete
link removes every pair, baseline, and report for the project and touches no todo (AC1); unlink of a single pair
writes no field on either side and records no outbound call (AC26); every body is raw JSON with no `success`
envelope key (AC32).
*Verify:* red.

**Task 19 — implement `todos_github/routes.rs`.**
Axum handlers over `Arc<PluginContext>`, typed deserialization plus explicit checks, split into
`routes/{link.rs, pairs.rs, sync.rs, mod.rs}` to stay under 300 lines per file and 50 per handler. Errors map to
`400`/`404`/`409`/`500` with human strings carrying no credential material.
*Verify:* `cargo test -p mainframe-plugins todos_github::routes`.

**Task 20 — mount the sub-router.**
In `todos.rs`, merge `todos_github::routes::router()` into `routes()` under `/github` (one line) and confirm
`run_github_migrations` runs from `activate` via `run_migrations` (task 9).
*Verify:* `cargo test -p mainframe-plugins todos`; start the daemon and
`curl 'localhost:31500/api/plugins/todos/github/link?projectId=x'` returns `{"link":null,...}` raw.

### Group `git-remotes` — deriving `owner/repo`

**Task 21 — failing tests for remote-URL parsing and `owner/repo` derivation.**
Extend `packages/core-rs/crates/mainframe-git/src/git_parse.rs`'s test module: `parse_remote_urls` over
`git remote -v` output (dedupes the fetch/push pair, preserves order); `github_repo_from_url` accepting
`https://github.com/o/r`, `https://github.com/o/r.git`, `git@github.com:o/r.git`,
`ssh://git@github.com/o/r.git`, and rejecting a non-GitHub host, a path with fewer or more than two segments, a
`ext::`/`file::` transport, and any segment failing `^[A-Za-z0-9._-]+$` (AC2).
*Verify:* red.

**Task 22 — implement parsing and derivation.**
Add both functions to `git_parse.rs` and `pub async fn remotes_with_urls(&self)` to
`packages/core-rs/crates/mainframe-git/src/git_service.rs` running `argv!["remote", "-v"]` (array args, no shell
interpolation).
*Verify:* `cargo test -p mainframe-git remote`.

**Task 23 — failing test for the daemon route.**
Add a case to the `routes/git.rs` test module: `GET /api/projects/{id}/git/github-remotes` returns
`ok({ remotes: [...] })` with only valid GitHub remotes, an unknown project → `404`, and a repo with no GitHub
remote → `ok({ remotes: [] })`.
*Verify:* red.

**Task 24 — implement the route.**
Add the handler to `packages/core-rs/crates/mainframe-server/src/routes/git.rs` using `get_effective_path` +
`resolve_and_validate_path` and register it in `router()` (fact 17). Keep the file under 300 lines — extract the
handler into `routes/git_remotes.rs` and merge it in `http.rs` if it would push `git.rs` over.
*Verify:* `cargo test -p mainframe-server git`; `curl` against the running daemon for a real project.

### Group `ui-sync-tests` — red-phase UI tests (kind: test)

**Task 25 — tests for the API client and the store.**
Create `packages/ui/src/lib/api/__tests__/todos-github.test.ts` (every function hits the frozen path with the
frozen body; raw-JSON handling; error propagation) and
`packages/ui/src/features/tasks/github/__tests__/use-github-sync-store.test.ts` (init, load, each mutation
refetching the todos store, the stale-completion guard, `running` gating, dialog open/close).
*Verify:* both files fail (modules missing).

**Task 26 — tests for `sync-format.ts`.**
Create `packages/ui/src/features/tasks/github/__tests__/sync-format.test.ts`: `statusLabel` maps
`open|in_progress|done` → `Open|In progress|Done` and the raw key never appears (AC33); `syncedAgo(null)` →
`never synced`; the three fixed `ruleLine` strings plus the `(issue timestamp, to the minute)` suffix; a
`tie` with an unresolvable remote stamp renders the local stamp alone followed by `GitHub timestamp unavailable`;
`in-progress-close` renders no timestamp at all (AC21).
*Verify:* red.

**Task 27 — tests for the header control, link dialog, and banner.**
Create `packages/ui/src/features/tasks/github/__tests__/GitHubSyncControl.test.tsx`, `LinkRepoDialog.test.tsx`,
and `SyncRunBanner.test.tsx`: unlinked → `tasks-github-link` outline button; linked → `tasks-github-pill` showing
`owner/repo` and `syncedAgo`; the menu's four items with `tasks-github-menu-report` disabled until a run exists
and `tasks-github-menu-sync` disabled while `running` (AC35); the dialog lists only remotes the route returned,
one radio per remote, confirm disabled without a selection and without a credential; the banner renders the
counts, the amber partial-failure variant with its second line, and offers no report link when nothing was
overwritten.
*Verify:* red.

**Task 28 — tests for the pair glyph, publish dialog, and import dialog.**
Create `PairGlyph.test.tsx`, `PublishTaskDialog.test.tsx`, and `ImportIssuesDialog.test.tsx` in the same
directory: the five pair states from the spec's table render the right glyph/testid, amber only for
overwritten/errored/remotely-unlinked, and the overwritten glyph opens the report; the publish dialog shows
Title/Body/Labels and names the withheld workflow labels with the exact count sentence; the import dialog shows
select-all with the open count, a row per issue keyed by issue number, an already-paired row disabled with
"Already paired with task #N", and a footer reading "Import 5 issues" (AC3, AC4, AC26, AC34).
*Verify:* red.

**Task 29 — tests for the report dialog.**
Create `SyncReportDialog.test.tsx`: the header sentence, a row per overwrite with issue number, field label,
truncated task title and winner chip; expanding shows exactly the rule line plus the "Now" line and the amber
replaced-value block with `tasks-github-report-copy-${id}`; multiple rows expand independently; an empty report
renders "Nothing was overwritten in this run."; `in_progress` never reaches the DOM (AC33).
*Verify:* red.

### Group `ui-api-store` — client, formatting, store

**Task 30 — the API client.**
Create `packages/ui/src/lib/api/todos-github.ts` against the frozen plugin contract using
`requestPlugin`/`requestPluginNoContent`/`expectField`, and add `listGitHubRemotes(port, projectId, chatId?)` to
`packages/ui/src/lib/api/git.ts` (envelope route).
*Verify:* `vitest run src/lib/api/__tests__/todos-github.test.ts` green.

**Task 31 — `sync-format.ts`.**
Create `packages/ui/src/features/tasks/github/sync-format.ts` per the module contract. `syncedAgo` is
minute-granular and deliberately distinct from `TaskCard`'s day-granular `relativeTime` (two call sites, below
the extract-at-three threshold).
*Verify:* `vitest run src/features/tasks/github/__tests__/sync-format.test.ts` green.

**Task 32 — the store.**
Create `packages/ui/src/features/tasks/github/use-github-sync-store.ts` per the module contract, with the
`_loadSeq` stale guard (fact 23) and refetch-of-todos after every mutation.
*Verify:* `vitest run src/features/tasks/github/__tests__/use-github-sync-store.test.ts` green. No typecheck here:
the red-phase test files from tasks 27–29 are already committed and import components tasks 33–40 create, so
`tsc` would report TS2307 for each (see the standing rule above; the gate lives on task 37).

### Group `ui-report` — the report dialog

**Task 33 — `SyncReportRow.tsx`.**
Create `packages/ui/src/features/tasks/github/SyncReportRow.tsx`: collapsed summary, expanded rule line + "Now"
line + amber replaced-value block (`bg-mf-warning/10`, scrolls past a few lines, sized to content) with a copy
button. All strings come from `sync-format.ts`; the component assembles no prose of its own (AC21).
*Verify:* `vitest run src/features/tasks/github/__tests__/SyncReportDialog.test.tsx` — the row assertions pass.

**Task 34 — `SyncReportDialog.tsx`.**
Create the dialog reading `report` from the store, header sentence, failure sentence beneath it, flat rows with
independent expansion, and the three-line empty state.
*Verify:* the whole `SyncReportDialog.test.tsx` file green.

### Group `ui-header-link` — the header control, link dialog, banner

**Task 35 — `GitHubSyncControl.tsx`.**
Create `packages/ui/src/features/tasks/github/GitHubSyncControl.tsx`: the outline "Link GitHub repo" button with
`CircleDot` (lucide ships no GitHub brand mark — design direction) when unlinked, the connected pill + dropdown
menu when linked, `Hint` wrapping the trigger with the `label` prop (fact 22).
*Verify:* `vitest run src/features/tasks/github/__tests__/GitHubSyncControl.test.tsx` green.

**Task 36 — `LinkRepoDialog.tsx` and `SyncRunBanner.tsx`.**
The dialog: radio list of derived `owner/repo` with the remote name as secondary text, the credential row reusing
the `CredentialConnect` pattern under the `github` service label, confirm/cancel. The banner: counts, "View
report" text button, amber partial-failure variant, dismissable.
*Verify:* `vitest run src/features/tasks/github/__tests__/LinkRepoDialog.test.tsx
src/features/tasks/github/__tests__/SyncRunBanner.test.tsx` green.

**Task 37 — mount everything in `TasksBoard.tsx`.**
Call `init(port, projectId)` and `load()` on mount; render `GitHubSyncControl` in the right-aligned trailing group
before `tasks-board-new` (fact 19); render `SyncRunBanner` under the header; mount `LinkRepoDialog`,
`ImportIssuesDialog`, `PublishTaskDialog`, and `SyncReportDialog` once, driven by `store.dialog` (D5).
*Verify:* `pnpm --filter @qlan-ro/mainframe-ui typecheck` — the single UI typecheck gate, and the first task at
which it can pass (every component the red-phase tests import now exists); `vitest run src/features/tasks/__tests__`
green; `TasksBoard.tsx` stays under 300 lines.

### Group `ui-pair-actions` — row glyphs, publish, import

**Task 38 — extract the row action cluster.**
Move the start/edit/delete cluster out of `packages/ui/src/features/tasks/TaskListRow.tsx` (310 lines today) into
a new `packages/ui/src/features/tasks/TaskRowActions.tsx`, preserving every existing `data-testid` verbatim.
*Verify:* `vitest run src/features/tasks/__tests__` green — no testid changed; `TaskListRow.tsx` back under 300.

**Task 39 — `PairGlyph.tsx`.**
Create `packages/ui/src/features/tasks/github/PairGlyph.tsx` rendering the five states from the spec table,
reading the pair from the store by `todo.id`, keyed testids by `todo.number`, amber only for the three
needs-attention states, and opening the report from the overwritten state.
*Verify:* `vitest run src/features/tasks/github/__tests__/PairGlyph.test.tsx` green.

**Task 40 — `PublishTaskDialog.tsx` and `ImportIssuesDialog.tsx`.**
Per the spec's copy, including the exact withheld-workflow-labels sentence and the counted footer action.
*Verify:* `vitest run src/features/tasks/github/__tests__/PublishTaskDialog.test.tsx
src/features/tasks/github/__tests__/ImportIssuesDialog.test.tsx` green.

**Task 41 — wire the row and the card.**
Render `PairGlyph` in the trailing slot of `TaskListRow.tsx` and `TaskCard.tsx`, and add the unlink icon button to
`TaskRowActions.tsx` and to `TaskCard.tsx`'s cluster (fact 21), shown only for a paired task. No new props on
either component (D4).
*Verify:* `vitest run src/features/tasks/__tests__ src/features/tasks/github/__tests__/PairGlyph.test.tsx
src/features/tasks/github/__tests__/PublishTaskDialog.test.tsx
src/features/tasks/github/__tests__/ImportIssuesDialog.test.tsx` green; both files under 300 lines. Name those
three files rather than running the whole `github/__tests__` directory: the directory also holds the red-phase
tests for `GitHubSyncControl`, `LinkRepoDialog`, `SyncRunBanner` and `SyncReportDialog`, whose components belong to
`ui-report` and `ui-header-link` and do not exist yet. Do not create them here. No typecheck here either — same
reason (see the standing rule above; the gate lives on task 37).

### Group `rust-acceptance` — cross-cutting acceptance tests (kind: test)

**Task 42 — the acceptance suite.**
Create `packages/core-rs/crates/mainframe-plugins/src/todos_github/acceptance_tests.rs` (declared in
`todos_github/mod.rs`) driving the real routes end-to-end against `FakeGitHub`, one test per criterion, each named
for it: AC1 (unlink leaves both sides byte-identical), AC7, AC8, AC9, AC14, AC15, AC17, AC18 (all four state
directions), AC19, AC20, AC22, AC23, AC24, AC25, AC27, AC28, AC29, AC30, AC31, AC35. Each test asserts against
the recorded outbound calls, not against internal state, so it survives refactoring.
*Verify:* `cargo test -p mainframe-plugins todos_github::acceptance`; `cargo clippy -p mainframe-plugins`;
every new Rust file under 300 lines (`find packages/core-rs/crates -name '*.rs' -newer …  | xargs wc -l`).

### Group `release-changeset`

**Task 43 — changeset.**
Run `pnpm changeset` and select `@qlan-ro/mainframe-ui` (minor) and `@qlan-ro/mainframe-core` (minor — the
package the release pipeline reads for the daemon version). Summary: "Tasks board: two-way GitHub Issues sync —
link a repo, import or publish tasks, and reconcile title, body, state, and labels with an after-the-fact
overwrite report."
*Verify:* the file exists under `.changeset/` and `git status` shows it staged.

## Final verification (run before the PR)

- `cd packages/core-rs && cargo test -p mainframe-plugins -p mainframe-automations -p mainframe-git -p mainframe-server`
- `cd packages/core-rs && cargo clippy --workspace --all-targets` clean
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `pnpm --filter @qlan-ro/mainframe-ui test`
- File-size sweep: no file added or edited by this plan exceeds 300 lines; no function exceeds 50.
- A changeset exists.
