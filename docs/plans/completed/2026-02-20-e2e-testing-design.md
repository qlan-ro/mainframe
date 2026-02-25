# E2E Testing — Design

**Date:** 2026-02-20

## Overview

Add two layers of automated testing to catch regressions across feature flows and UI interactions. The goal is to document and verify scenarios end-to-end so nothing gets forgotten during manual testing.

## Layers

### Layer 1 — Daemon API Tests (CI)

Vitest-based tests that exercise the daemon's REST API directly. No browser, no Electron. Fast (~seconds per suite), runs in CI alongside existing unit tests.

**Fixture:** A `beforeAll` helper that:
1. Picks a random free port (avoids conflict with the dev daemon on 31415)
2. Spawns the daemon via `tsx` with `PORT=<random>` and `MAINFRAME_DB=<tmpdir>/test-{pid}.sqlite`
3. Waits until the HTTP health endpoint responds
4. Provides a base URL and a WebSocket helper to tests

Each test file gets its own daemon instance and clean SQLite database. No Claude CLI is spawned — tests cover HTTP/WebSocket behavior only, not AI responses.

**First batch of tests:**

`tests/api/projects.test.ts`
- POST `/api/projects` — creates project
- POST `/api/projects` — returns existing project if path already added
- GET `/api/projects` — lists all projects
- DELETE `/api/projects/:id` — removes project and all chats
- DELETE `/api/projects/:id` — handles unknown id gracefully (no crash)

`tests/api/chats.test.ts`
- POST `/api/projects/:id/chats` — creates chat
- GET `/api/projects/:id/chats` — lists chats for project
- POST `/api/chats/:id/archive` — archives chat

`tests/api/delete-cascade.test.ts`
- Deleting a project with active chats removes all chats from the DB
- Deleting a project with no chats still succeeds

### Layer 2 — Playwright Electron Tests (local only)

`@playwright/test` tests that launch the real Electron app against a test daemon. Covers UI interactions that are hard to unit-test. Not run in CI (requires a display server); run manually on demand.

**Approach:** Before launching Electron, start a test daemon on a fixed test port (31999) with a temp DB. Pass `MF_DAEMON_URL=http://localhost:31999` as an env var. The Electron main process reads this env var to determine the daemon port instead of using the hardcoded 31415. In dev mode Electron already skips spawning its own daemon (it assumes one is running), so the renderer connects to the test daemon automatically.

This requires one small change to the Electron main process: read `MF_DAEMON_URL` (or `MF_DAEMON_PORT`) from env when building the WebSocket/HTTP URL used by the renderer.

**First batch of tests:**

`tests/e2e/projects.spec.ts`
- Add project via directory dialog → appears in ProjectRail
- Hover project button → ✕ badge appears
- Click ✕ → inline confirm/cancel flip appears
- Mouse leave → confirm state cancels
- Click ✓ → project removed from rail

`tests/e2e/chats.spec.ts`
- Select a project → chat list loads
- Create a new chat → chat appears in the list
- Switch project → different chat list shown

## File Structure

```
tests/
  api/
    helpers/
      daemon.ts           # start/stop daemon fixture, fetch helpers
      ws.ts               # WebSocket client helper
    projects.test.ts
    chats.test.ts
    delete-cascade.test.ts
  e2e/
    fixtures.ts           # Electron app launch/teardown
    projects.spec.ts
    chats.spec.ts
  vitest.config.ts        # for api/ tests
  playwright.config.ts    # for e2e/ tests
```

## Dependencies

| Layer | New Dependency |
|-------|---------------|
| API tests | None (uses Vitest already installed workspace-wide) |
| Electron tests | `@playwright/test`, `playwright` |

## Scripts

| Script | What it does |
|--------|-------------|
| `pnpm test:api` | Runs Layer 1 API tests via Vitest |
| `pnpm test:e2e` | Runs Layer 2 Playwright Electron tests |

## CI Changes

Add `pnpm test:api` to `.github/workflows/ci.yml` after the existing `pnpm test` step. Layer 2 (`test:e2e`) is excluded from CI and run locally on demand.

## Code Changes Required

One small change to support Layer 2: the Electron main process (and the renderer's API base URL) must read `MF_DAEMON_PORT` (or `MF_DAEMON_URL`) from env so tests can inject a test daemon port without rebuilding the app.
