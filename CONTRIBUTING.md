# Contributing to Mainframe

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)

### Setup

```bash
git clone https://github.com/qlan-ro/mainframe.git
cd mainframe
pnpm install
pnpm build
```

### Development

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @mainframe/core build

# Run tests
pnpm --filter @mainframe/core test

# Dev mode
pnpm --filter @mainframe/core dev
pnpm --filter @mainframe/desktop dev
```

### Monorepo Structure

| Package | Description |
|---------|-------------|
| `@mainframe/types` | Shared TypeScript contracts (interfaces, event types) |
| `@mainframe/core` | Daemon process — chat orchestration, CLI adapters, persistence |
| `@mainframe/desktop` | Electron + React frontend |

---

## Architecture Rules

### Domain Structure (`packages/core/src/`)

| Directory | Responsibility |
|-----------|---------------|
| `chat/` | Session lifecycle, message routing, permissions, context tracking |
| `attachment/` | File attachment storage and formatting |
| `workspace/` | Git worktree management |
| `adapters/` | CLI tool integrations (Claude, future Gemini/Codex) |
| `db/` | SQLite persistence with repository pattern |
| `server/` | HTTP REST + WebSocket transport (thin layer, no business logic) |

### Dependency Direction

```
server/ ──> chat/ ──> adapters/
   │          │            │
   │          ├──> db/     └──> @mainframe/types
   │          ├──> attachment/
   │          └──> workspace/
   │
   └──> db/
```

- `server/` calls into `chat/` and `db/`, never the reverse
- `chat/` depends on `adapters/`, `db/`, `attachment/`, `workspace/`
- `adapters/` depends only on `@mainframe/types`
- WebSocket/HTTP handlers must be thin transport — business logic belongs in `chat/` services

### Decomposition Rules

- No file over 300 lines — split when approaching this limit
- No god objects — each class/module has a single clear responsibility
- New adapter event handling goes in `event-handler.ts`, not `chat-manager.ts`
- Permission logic goes in `permission-manager.ts`
- ExitPlanMode flows go in `plan-mode-handler.ts`
- `ChatManager` is a facade — it delegates, it doesn't implement

### Barrel Exports

- Each domain folder has an `index.ts` barrel
- External consumers import from barrels, not internal files
- Internal files within a domain can import each other directly

---

## Code Style

- TypeScript strict mode, NodeNext module resolution
- `.js` extensions in all relative imports (ESM requirement)
- No comments explaining absent/removed functionality
- Comments only for non-obvious behavior in present code
- No function over 50 lines — extract helpers

---

## Commit & PR Process

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- One logical change per commit
- PR description must explain *why*, not just *what*
- All PRs must pass: `pnpm build` + `pnpm test`

---

## Testing Standards

**Framework:** Vitest (`pnpm --filter @mainframe/core test`)

### Test File Location

- Tests live in `packages/core/src/__tests__/`
- Test file naming: `<feature>.test.ts`

### What to Test

- Every public method of every service class
- Every business logic path (happy path + error cases)
- Permission flows: approve, deny, YOLO auto-approve, ExitPlanMode (all three paths)
- Adapter event handling: each event type (init, message, tool_result, permission, result, exit, error)
- Edge cases: concurrent operations (dedup guards), missing data, process crashes

### How to Test

- Unit test services in isolation — mock their dependencies (DB, adapters, stores)
- Use `vi.fn()` for mocks, `vi.spyOn()` for partial mocks
- Each test should test ONE behavior — name it `should <verb> when <condition>`
- No shared mutable state between tests — use `beforeEach` for fresh instances
- Test through the public API, not private methods or internal state

### Test Structure

```typescript
describe('ChatManager', () => {
  describe('sendMessage', () => {
    it('should lazy-start process if not running', async () => { ... });
    it('should process attachments when attachmentIds provided', async () => { ... });
    it('should extract mentions from message text', async () => { ... });
  });
});
```

### What NOT to Do

- Don't test framework behavior (SQLite, Express, WebSocket library internals)
- Don't write integration tests that require real filesystem, real CLI processes, or real APIs
- Don't share test fixtures across test files — duplicate small helpers if needed
- Don't assert on exact error message strings — assert on error type or behavior
- Don't skip flaky tests — fix them or delete them

### When to Write Tests

- Every new service/module must have a corresponding test file
- Every bug fix must include a regression test
- Refactoring should verify existing tests still pass, not require new tests (unless coverage was missing)
