# Mainframe

AI-native development environment for orchestrating agents.

## Agent skills

### Issue tracker

Issues live in the Mainframe app's todos plugin (per-project SQLite, `~/.mainframe/plugins/todos/data.db`). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), stored in each todo's `labels` JSON column. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet — created lazily by `/domain-modeling`). See `docs/agents/domain.md`.

# Workflow

- Before any new bug/feature work, pull latest main and start a new branch on it
- Before any work, check needed skills to guide your development see [Skills](#skills)
- For Claude CLI behavior, use the `claude-source-researcher` skill (reads the CLI source directly). Protocol docs are in `docs/adapters/claude/`: [PROTOCOL_REVERSED](docs/adapters/claude/PROTOCOL_REVERSED.md), [COMPACTION](docs/adapters/claude/COMPACTION.md), [INTERRUPT](docs/adapters/claude/INTERRUPT.md), [CONTEXT_USAGE](docs/adapters/claude/CONTEXT_USAGE.md), [MODELS](docs/adapters/claude/MODELS.md), [TODOS](docs/adapters/claude/TODOS.md), [PR_TRACKING](docs/adapters/claude/PR_TRACKING.md)
- Be sure to typecheck when you're done making a series of code changes
- Prefer running single tests, and not the whole test suite, for performance
- For git workflow and commit practices, see [Git](#git)

## Tech Stack

- Language: TypeScript (strict mode, NodeNext modules) + Rust (Tauri shell, `packages/app-tauri/src-tauri`)
- Runtime: Rust `mainframe-daemon` (packages/core-rs); Tauri 2 desktop shell
- Package Manager: pnpm workspaces (+ Cargo for the Rust daemon and shell)
- Database: SQLite (`rusqlite`)
- UI: React + Tailwind v4 in `packages/ui`, consumed by the Tauri shell

## Commands

- `pnpm install` — Install dependencies
- `pnpm build` — Build all packages
- `pnpm --filter @qlan-ro/mainframe-types build` — Rebuild shared types after changing them
- `pnpm --filter @qlan-ro/mainframe-ui test` — Test a specific package
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` — Single test file (preferred; large multi-suite runs hit cross-file `React.act` failures)
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` — Typecheck the UI. Core/types have no `typecheck` script; use `pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit`
- `pnpm tauri:dev` (from `packages/app-tauri`) — Tauri dev app; run in background with output to a log file
- `cargo check` (from `packages/app-tauri/src-tauri`) — Fast Rust validation
- `pnpm test:e2e` — Playwright E2E suite
- `pnpm changeset` — Required before committing (see [Git](#git))

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

- **Monorepo Structure**: pnpm workspaces with six packages:
    - `@qlan-ro/mainframe-types`: Shared TypeScript interfaces and domain models.
    - `@qlan-ro/mainframe-core`: Orphaned TS daemon implementation (superseded by the Rust daemon; kept only for its `package.json` version, read by the release pipeline).
    - `@qlan-ro/mainframe-ui`: The shared React renderer, consumed by the Tauri shell.
    - `@qlan-ro/mainframe-app-tauri`: Tauri 2 desktop shell (Rust in `src-tauri/`). Ships the Rust daemon (`packages/core-rs`) as a bundled sidecar.
    - `@qlan-ro/mainframe-e2e`: Playwright end-to-end suite.
    - `@qlan-ro/mainframe-mobile`: Git submodule (separate repo — cross-cutting changes need their own PR there; don't bump the pointer in feature PRs).
- **Metadata Storage**: SQLite (`better-sqlite3`) for project tracking and chat metadata. Message history is NOT duplicated; CLI agents replay it via `--resume`.

## Terminology

**AgentAdapter** = a CLI tool integration (Claude, Gemini, Codex, OpenCode) the daemon spawns as a child process — interface in `packages/types/src/adapter.ts`. **Agent/Subagent** = a task worker spawned _within_ a session by the AI (the left-panel "Agents" tab), not a CLI adapter.

## Skills

Invoke the listed skill **before** taking the described action. No exceptions.

| Trigger | Skill |
|---------|-------|
| Any bug, error, or unexpected behavior — even when the cause looks obvious | `systematic-debugging` |
| Building a new feature, adding functionality, or changing behavior | `brainstorming` |
| Multi-step implementation task, or after brainstorming approval | `writing-plans` |
| Writing implementation code for any feature or bugfix | `test-driven-development` |
| About to claim work is done, commit, or open a PR | `verification-before-completion` |
| Building UI components, pages, or making visual design decisions | `ui-ux-pro-max` |
| Writing docs, commits, PRs, error messages, or UI copy | `writing-clearly-and-concisely` |

Domain skills (typescript-expert, nodejs-best-practices, vercel-react-best-practices, senior-architect, code-audit) are preloaded by the roster agents in `~/.claude/agents/` — delegate to core-dev/ui-dev/planner/test-writer/quality-reviewer instead of invoking them inline.

## Git

- **Never commit to `main`.** Always work on a feature or fix branch. Run `git branch --show-current` before any commit or reset to confirm you are not on `main`.
- **Check branch before destructive git ops.** Before `reset`, `rebase`, or `push --force`, verify the current branch with `git status` or `git branch`.
- **Never discard unstaged changes you didn't create.** They may be in-progress work from another session. When committing, stage only your own files by name. Do not `git checkout --`, `git restore`, or `git stash` other people's changes.
- **Changesets required.** Every PR must include a changeset file. Run `pnpm changeset` before committing, pick the affected packages and bump type (patch/minor/major). For PRs that don't need a changelog entry (CI, docs typos), run `pnpm changeset --empty`. The pre-push hook and CI will reject without one.

## Code Rules

Each rule exists because a violation required cleanup.

- **No shell interpolation** — `execFile`/`execGit` with array args; never `execSync` with template strings.
- **Validate input** — `resolveAndValidatePath()` for user-supplied paths; identifiers match `^[a-zA-Z0-9_-]+$`; Zod on every endpoint and WS message.
- **Max 300 lines/file, 50/function** — decompose before merging.
- **No silent catches; no console.* in core** — every catch logs via pino (`createChildLogger`); desktop fire-and-forget uses tagged `console.warn`; intentional silence needs an `/* expected */` comment.
- **No sync I/O in the daemon** — `node:fs/promises` + async `execGit`; sync calls block the event loop.
- **Single canonical type** — define once in `@qlan-ro/mainframe-types`; desktop depends on core via `workspace:*`; pure logic (parsing, status derivation, transforms) lives in core, not React.
- **Tests required** — new routes/DB methods/core logic get test files; don't lower coverage thresholds; parse JSON columns via `safeJsonArray`, never bare `JSON.parse`.
- **`data-testid` on every interactive element** — `<surface>-<element>` kebab-case, keyed by domain id not array index; `ui/` primitives stay passthrough.
- **Lazy-load heavy components** — editors/visualizations via `React.lazy` + `Suspense`.
- **Hygiene** — no `@ts-ignore` (use `@ts-expect-error` + reason); comments say *why*, not *what*; remove dead code; extract shared helpers at 3+ duplications.
- **No leftovers** — never close a feature with small deferred cleanups (dead code, stale comments); fix them in the same pass. "Deferred" is only for genuinely separate work.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DAEMON_PORT` | Daemon HTTP + WebSocket port | 31415 |
| `VITE_PORT` | Vite dev server port | 5173 |
| `MAINFRAME_DATA_DIR` | Data directory | `~/.mainframe` |
| `LOG_LEVEL` | Logging verbosity | info |
