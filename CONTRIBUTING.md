# Contributing to Mainframe

## Prerequisites

- Node.js 20+ (22 recommended)
- pnpm (`npm install -g pnpm`)
- Rust toolchain (`rustup`) — builds the daemon and the Tauri shell
- Xcode Command Line Tools (macOS) or the platform build tools Tauri requires ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## Setup

```bash
git clone https://github.com/qlan-ro/mainframe.git
cd mainframe
pnpm install
pnpm build
```

## Project Structure

Mainframe is a pnpm workspace with a Cargo-based Rust daemon, plus a mobile companion app as a git submodule.

| Package | Description |
|---------|-------------|
| `@qlan-ro/mainframe-types` | Shared TypeScript interfaces and domain models |
| `@qlan-ro/mainframe-ui` | Shared React renderer consumed by the Tauri shell |
| `@qlan-ro/mainframe-app-tauri` | Tauri 2 desktop shell (Rust in `src-tauri/`); bundles the Rust daemon as a sidecar |
| `@qlan-ro/mainframe-e2e` | Playwright end-to-end suite |
| `@qlan-ro/mainframe-mobile` | React Native companion app (git submodule — cross-cutting changes need their own PR there) |

The daemon itself lives in `packages/core-rs` (Rust, Cargo workspace, not a pnpm package). It's an Axum HTTP + WebSocket server that the Tauri shell spawns and supervises. See the root [`CLAUDE.md`](CLAUDE.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the Tauri dev app (from packages/app-tauri)
pnpm tauri:dev

# Fast Rust validation (from packages/app-tauri/src-tauri)
cargo check

# Rebuild shared types after changing them
pnpm --filter @qlan-ro/mainframe-types build
```

## Testing

```bash
# Test a specific package
pnpm --filter @qlan-ro/mainframe-ui test

# Run a single test file (preferred — large multi-suite runs hit cross-file React.act failures)
pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>

# Typecheck the UI (types has no dedicated script — use tsc directly)
pnpm --filter @qlan-ro/mainframe-ui typecheck
pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit

# Playwright end-to-end suite
pnpm test:e2e
```

Run typecheck after any series of code changes, and prefer a single test file over the full suite while iterating.

## Code Style

- TypeScript: strict mode, NodeNext module resolution
- Max 300 lines per file, 50 lines per function — decompose instead of growing
- No `@ts-ignore` — use `@ts-expect-error` with a reason
- Comments explain non-obvious *why*, never *what*; remove dead code instead of commenting it out
- Every interactive UI element needs a stable `data-testid` (`<surface>-<element>`, kebab-case)

## Commit & PR Process

- Work on a feature or fix branch — never commit directly to `main`
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- One logical change per commit; PR descriptions explain *why*, not just *what*
- Run `pnpm changeset` before committing and pick the affected packages and bump type. For changes that don't need a changelog entry (CI, docs typos), run `pnpm changeset --empty`. The pre-push hook and CI reject PRs without one.
- All PRs must pass `pnpm build` and the relevant package's tests

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DAEMON_PORT` | Daemon HTTP + WebSocket port | 31415 |
| `VITE_PORT` | Vite dev server port | 5173 |
| `MAINFRAME_DATA_DIR` | Data directory | `~/.mainframe` |
| `LOG_LEVEL` | Logging verbosity | info |
