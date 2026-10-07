# Development reference

Use the relevant section when changing code, running checks, or preparing a PR. Package scripts and Cargo manifests define the available commands.

## Commands and validation

Run pnpm commands from the repository root unless a directory is specified.

| Task | Command |
|---|---|
| Install JS dependencies | `pnpm install` |
| Build JS packages | `pnpm build` |
| Rebuild shared types after edits | `pnpm --filter @qlan-ro/mainframe-types build` |
| Typecheck shared types | `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit` |
| Typecheck UI | `pnpm --filter @qlan-ro/mainframe-ui typecheck` |
| Run one UI test file | `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` |
| Check daemon workspace | `cargo check --manifest-path packages/core-rs/Cargo.toml --workspace` |
| Check Tauri shell | `cargo check --manifest-path packages/app-tauri/src-tauri/Cargo.toml` |
| Run daemon tests for a crate | `cargo test --manifest-path packages/core-rs/Cargo.toml -p <crate> <test-filter>` |
| Start desktop app | `pnpm tauri:dev` in `packages/app-tauri` |
| Mock-adapter Playwright suite | `pnpm test:e2e` |

Typecheck affected TypeScript packages after code changes. Prefer focused test files while iterating; large combined UI runs have encountered cross-file `React.act` failures. The types package has no `typecheck` script. A pnpm test run does not cover the Rust workspaces.

New routes, database operations, and core behavior need behavior-focused tests. Preserve coverage thresholds. Report which checks ran and any failures; successful compilation does not establish runtime behavior.

For live branch testing, use the project's [test environment script](../../.agents/test-env.sh). Consult [Rust builds](rust-builds.md) when changing Cargo configuration or managing build artifacts.

## Backend boundaries

- The daemon uses Rust, axum, rusqlite, and tracing. Shared TypeScript interfaces belong in `packages/types`; client-side pure logic must remain usable by the client. Use [architecture](../ARCHITECTURE.md) for ownership decisions.
- For programmatic command execution, pass the executable and arguments separately. Never interpolate untrusted input into shell commands.
- Validate paths, identifiers, and request/message payloads at their input boundary using the owning module's validation. Preserve confinement and identifier restrictions when refactoring.
- Handle failures explicitly through the module's logging/error path; do not silently swallow errors. Keep blocking work off async execution threads using the module's existing pattern.
- Parse persisted JSON through the module's typed/error-handled conversion rather than assuming stored contents are valid.

## PRs and package boundaries

Every PR needs an appropriate changeset. Create or update one with `pnpm changeset`; use `pnpm changeset --empty` for changes without a changelog entry. Reuse an existing suitable changeset rather than adding one per commit. Keep hooks and CI checks enabled.

`packages/mobile` is a separate repository mounted as a submodule. Cross-cutting mobile changes need their own PR there; do not bump its pointer in a feature PR.
