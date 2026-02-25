# Comprehensive Testing Design

**Date:** 2026-02-20
**Status:** Approved

## Goal

Protect against refactoring regressions across the full stack — daemon, WebSocket layer, and desktop UI — with tests that verify real user-facing behavior rather than implementation details.

## What We're Removing

- `packages/core/src/__tests__/set-model-integration.test.ts` — requires a live Claude binary and network. Non-deterministic, slow, and unmaintainable in CI.

## Architecture

Three tiers:

```
Tier 1: Core Integration Flows (Vitest, PR CI)
  - Full adapter → EventHandler → WebSocket → client path
  - MockAdapter extends BaseAdapter, emits real events
  - Real HTTP+WS server, real ws client

Tier 2: Core + Desktop Unit Gaps (Vitest, PR CI)
  - Pure functions: frontmatter, context-tracker
  - FS operations: attachment-store, claude-skills
  - Route handlers: files, git
  - Behavior flows: plan-mode-handler

Tier 3: Desktop Components (Vitest+RTL + Playwright CT)
  - RTL: key interactive components (PR CI)
  - Playwright CT: visual/interaction validation (manual/separate CI)
```

## Tier 1: Core Integration Flows

**Pattern (from daemon-restart-messages.test.ts):**
1. `MockAdapter extends BaseAdapter` with `id = 'claude'`
2. Register in `AdapterRegistry`
3. Wire real `ChatManager` + real SQLite in-memory + real `WebSocketManager`
4. Spin up HTTP+WS server, connect `ws` client
5. Emit adapter events via `this.emit(eventName, ...)`
6. Assert WS client receives expected `DaemonEvent`

**New files:**

| File | Tests |
|------|-------|
| `__tests__/send-message-flow.test.ts` | sendMessage → adapter emits `message`+`result` → WS client gets `message.appended` + `chat.updated{processState:'idle'}` |
| `__tests__/permission-flow.test.ts` | AskUserQuestion event → WS gets `permission.requested`; yolo does NOT auto-approve AskUserQuestion; regular Bash permission IS auto-approved in yolo; WS respond → adapter.respondToPermission called |
| `__tests__/file-edit-flow.test.ts` | File-edit tool_result → DB modified_files updated → GET /diff?source=session returns file list |

## Tier 2: Core Unit Gaps

| File | Covers |
|------|--------|
| `__tests__/frontmatter.test.ts` | parseFrontmatter, buildFrontmatter round-trips, edge cases |
| `__tests__/context-tracker.test.ts` | extractMentionsFromText, trackFileActivity, extractPlanFilePathFromText |
| `__tests__/attachment-store.test.ts` | save/get/list/deleteChat with real tmpdir; sanitizeFileName security |
| `__tests__/claude-skills.test.ts` | createSkill/updateSkill/deleteSkill/listSkills with real tmpdir; same for agents |
| `__tests__/plan-mode-handler.test.ts` | handleClearContext (kill+reset+restart), handleEscalation, handleNoProcess |
| `__tests__/routes/files.test.ts` | Path traversal → 403; IGNORED_DIRS filter; 2MB limit; fuzzy search ranking |
| `__tests__/routes/git.test.ts` | git status parsing; branch detection; diff source=session |

## Tier 2: Desktop Component Tests (RTL)

**Setup changes:**
- Add `@testing-library/react`, `@testing-library/user-event`
- Update `vitest.config.ts`: include `*.test.tsx`, add coverage thresholds
- Extend `setup.ts` with RTL globals

**New files:**

| File | Tests |
|------|-------|
| `__tests__/components/PermissionCard.test.tsx` | Renders tool + input; approve fires respondToPermission('allow'); deny fires ('deny') |
| `__tests__/components/PlanApprovalCard.test.tsx` | Renders plan; approve/reject/escalate trigger correct callbacks |
| `__tests__/components/tools/BashCard.test.tsx` | Running state; completed state with output |
| `__tests__/components/tools/EditFileCard.test.tsx` | File path rendered; patch content shown |
| `renderer/components/chat/assistant-ui/message-parsing.test.tsx` | Sentinel parsing; clean text extraction |

## Tier 3: Playwright CT

**Runs:** manually or separate CI pipeline (not PR-blocking)

**Config:** `packages/desktop/playwright-ct.config.ts`

**New files:**

| File | Tests |
|------|-------|
| `__tests__/playwright/PermissionCard.ct.test.tsx` | Mount with mocked store; click approve; verify callback |
| `__tests__/playwright/AskUserQuestionCard.ct.test.tsx` | Select option; click submit; verify |
| `__tests__/playwright/BashCard.ct.test.tsx` | Running state; completed with output |
| `__tests__/playwright/EditFileCard.ct.test.tsx` | File path and patch rendered |

## Coverage Threshold Changes

| Package | Current | Target |
|---------|---------|--------|
| core lines | 40% | 65% |
| core branches | 30% | 55% |
| core functions | none | 60% |
| desktop lines | none | 50% |
| desktop branches | none | 40% |

## Package.json Script Changes

```json
// root package.json
"test": "pnpm -r run test",
"test:playwright": "pnpm --filter @mainframe/desktop run test:playwright"

// packages/desktop/package.json
"test:playwright": "playwright test -c playwright-ct.config.ts"
```
