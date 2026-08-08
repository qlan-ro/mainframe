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
- For Claude CLI behavior, use the `claude-source-researcher` skill (reads the CLI source directly). Protocol docs are in `docs/adapters/claude/`, verified against the 2026-03-31 source leak and CLI v2.1.220: [SESSIONS_JSONL](docs/adapters/claude/SESSIONS_JSONL.md) (transcript format, directory layout, worktree relocation), [HOOKS](docs/adapters/claude/HOOKS.md), [PERMISSIONS](docs/adapters/claude/PERMISSIONS.md), [SLASH_COMMANDS](docs/adapters/claude/SLASH_COMMANDS.md), [CLEAR](docs/adapters/claude/CLEAR.md). Two older docs are kept with staleness banners — read the five above first: [PROTOCOL_REVERSED](docs/adapters/claude/PROTOCOL_REVERSED.md) (v2.1.37; still the only coverage of the `--sdk-url` WebSocket transport) and [CLAUDE-JSONL-SCHEMA](docs/adapters/claude/CLAUDE-JSONL-SCHEMA.md) (v2.0.76–2.1.34 field frequencies, subordinate to SESSIONS_JSONL). For which fields Mainframe actually consumes, see the consumed-surface checklists ([Claude](docs/adapters/claude/CONSUMED-SURFACE.md), [Codex](docs/adapters/codex/CONSUMED-SURFACE.md)); verify a suspected live change against `.claude/skills/claude-protocol-debugger/` or `.claude/skills/codex-protocol-debugger/`.
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
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` — Typecheck the UI. Types has no `typecheck` script; use `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit`
- `pnpm tauri:dev` (from `packages/app-tauri`) — Tauri dev app; run in background with output to a log file
- `cargo check` (from `packages/app-tauri/src-tauri`) — Fast Rust validation
- `pnpm test:e2e` — Playwright E2E suite
- `pnpm changeset` — Required before committing (see [Git](#git))

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

- **Monorepo Structure**: pnpm workspaces with five packages (plus the mobile submodule):
    - `@qlan-ro/mainframe-types`: Shared TypeScript interfaces and domain models.
    - `@qlan-ro/mainframe-ui`: The shared React renderer, consumed by the Tauri shell. Its `package.json` version is what the release pipeline tags from (the old TS daemon package that used to carry it is deleted).
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
| Writing any markup or class names in `packages/ui` | `mainframe-design-system` |
| Open visual-design questions with no in-app template to mirror | `ui-ux-pro-max` |
| Writing docs, commits, PRs, error messages, or UI copy | `writing-clearly-and-concisely` |
| Checking whether new Claude Code / Codex releases affect Mainframe's adapters | `changelog-watch` |

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

## Disk Hygiene

Cargo never garbage-collects `target/`. Left alone, the two Rust target dirs reached 54 GB — every dependency, feature, or toolchain change strands the previous generation of artifacts permanently.

- **Keep the dev debuginfo caps.** Both Rust manifests pin `[profile.dev] debug = "line-tables-only"` and `[profile.dev.package."*"] debug = false`. Backtraces still carry file:line; dependencies carry nothing. The default `debug = 2` costs 4–6× the disk per build generation.
- **Sweep; don't wait for the disk to fill.** `cargo install cargo-sweep`, then `cargo sweep --installed && cargo sweep --time 14` in each target dir, drops stale fingerprints and leaves the current build warm. `cargo clean --profile dev` reclaims tens of GB at once and spares `release/`, so packaging doesn't rebuild cold.
- **Do not set `CARGO_TARGET_DIR`.** Five consumers hardcode `packages/core-rs/target/{release,debug}`: daemon discovery in `app-tauri/src-tauri/src/lib.rs`, `e2e/fixtures/daemon.ts`, `provision-rust-daemon.mjs`, `build-standalone.sh`, and `build-release-local.sh`. Redirecting the target dir breaks `tauri:dev`, the E2E suite, and packaging. Teaching those five to honor the variable is the prerequisite for sharing a target dir at all — including across worktrees, so until then every `.worktrees/*` checkout that runs `cargo` grows its own multi-GB `target/`.
- **`packages/core-rs` and `packages/app-tauri/src-tauri` are separate workspaces.** They share 142 dependencies by version but only 109 by resolved feature set, and those 109 are ~29% of shared source volume — the expensive crates (`tracing`, `tokio`, `libc`, `rustix`) differ. Do not merge the workspaces to dedupe them: profiles apply only at a workspace root, so src-tauri's `lto` and `panic = "abort"` would reach the daemon, and feature unification would hand it `tokio/test-util` and `libc/extra_traits` in production builds.
- **Measure before blaming the worktrees.** `du -sh packages/*/target` accounts for most of the repo's size; a worktree stays ~23 MB until someone builds in it.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DAEMON_PORT` | Daemon HTTP + WebSocket port | 31415 |
| `VITE_PORT` | Vite dev server port | 5173 |
| `MAINFRAME_DATA_DIR` | Data directory | `~/.mainframe` |
| `LOG_LEVEL` | Logging verbosity | info |
