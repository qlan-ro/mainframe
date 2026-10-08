# Mainframe

AI development environment for orchestrating coding agents. Use pnpm for TypeScript packages and Cargo for Rust.

- `packages/core-rs`: Rust daemon, API, adapters, and SQLite storage.
- `packages/ui`: shared React/Tailwind UI.
- `packages/types`: shared TypeScript contracts.
- `packages/app-tauri/src-tauri`: Tauri desktop shell; `packages/e2e`: Playwright tests.
- `packages/mobile`: mobile app in a separate repository, mounted as a git submodule.

## Working in this repository

- Reuse the assigned branch/worktree. Never commit to `main`; check the current branch before committing or running reset, rebase, or force-push.
- Preserve other sessions' changes. Stage only your own files by name; never restore, discard, or stash changes you did not create.
- Every PR needs an appropriate changeset, including an empty one for changes without a changelog entry.
- Fill [the PR template](.github/pull_request_template.md) for every PR, including CLI-created ones; keep its headings, order, and checklist, and put pipeline context in comments.

## Task-specific references

Read only what the current task needs. Keep information used in fewer than roughly 75% of repository tasks in conditional references, not this file.

- Code changes, commands, and validation: [development reference](docs/guides/development.md).
- Cargo configuration, packaging paths, or disk cleanup: [Rust build constraints](docs/guides/rust-builds.md).
- UI styling and component conventions: [Mainframe design skill](.agents/skills/mainframe-design-system/SKILL.md).
- Module ownership and runtime boundaries: [architecture](docs/ARCHITECTURE.md).
- CLI protocol work: [adapter references](docs/research/adapters/README.md); use the relevant protocol-debugger skill for live behavior.
- Tracker work: [issue tracker](docs/guides/issue-tracker.md) and [triage labels](docs/guides/triage-labels.md).
