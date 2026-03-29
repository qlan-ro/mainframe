# External Session Import — Implementation Plan

Design: `2026-03-06-external-session-import-design.md`

## Steps

### Step 1: Types — ExternalSession + Adapter interface extension
**Files:** `packages/types/src/adapter.ts`, `packages/types/src/chat.ts`
- Add `ExternalSession` interface to `adapter.ts`
- Add optional `listExternalSessions?(projectPath: string, excludeSessionIds: string[]): Promise<ExternalSession[]>` to `Adapter`
- Add `imported?: boolean` field to `Chat` interface (to distinguish imported chats in UI)

### Step 2: Claude adapter — external session listing
**Files:** `packages/core/src/plugins/builtin/claude/external-sessions.ts` (new)
- Implement `listExternalSessions()` function
- Read `sessions-index.json` from `~/.claude/projects/<encoded-path>/`
- Parse entries, filter by `excludeSessionIds`, map to `ExternalSession[]`
- Sort by `modifiedAt` descending
- Handle missing/malformed index gracefully (return empty array, log warning)

### Step 3: Wire Claude adapter to implement interface method
**Files:** `packages/core/src/plugins/builtin/claude/adapter.ts`
- Add `listExternalSessions()` method to `ClaudeAdapter` class
- Delegates to the function from step 2

### Step 4: DB — query for imported session IDs
**Files:** `packages/core/src/db/chats.ts`
- Add `getImportedSessionIds(projectId: string): string[]` — returns all non-null `claude_session_id` values for a project
- Add `findByClaudeSessionId(sessionId: string): Chat | undefined` — for duplicate detection on import

### Step 5: ExternalSessionService
**Files:** `packages/core/src/chat/external-session-service.ts` (new)
- `scan(projectId)` — gets project, adapter, calls `listExternalSessions`, returns list
- `importSession(projectId, sessionId, adapterId)` — creates chat, sets claudeSessionId, returns Chat
- `startAutoScan(projectId)` — sets interval (5 min), emits `sessions.external.count` on change
- `stopAutoScan(projectId)` — clears interval
- Duplicate detection: if `findByClaudeSessionId` returns a chat, return it instead of creating

### Step 6: API routes
**Files:** `packages/core/src/server/routes/external-sessions.ts` (new), `packages/core/src/server/index.ts`
- `GET /api/projects/:projectId/external-sessions` — Zod-validated, returns ExternalSession[]
- `POST /api/projects/:projectId/external-sessions/import` — body `{ sessionId, adapterId }`, returns Chat
- Register routes in server setup

### Step 7: WebSocket event for external session count
**Files:** `packages/core/src/server/ws-handler.ts` (or relevant event emitter)
- On project load / focus, trigger scan and emit `sessions.external.count`
- Hook into project switching to start/stop auto-scan

### Step 8: Desktop — API client + store
**Files:** `packages/desktop/src/renderer/lib/api.ts`, `packages/desktop/src/renderer/store/chats.ts`
- Add `fetchExternalSessions(projectId)` and `importExternalSession(projectId, sessionId, adapterId)` API functions
- Add `externalSessionCount` and `externalSessions` state to chats store (or a new store)
- Listen for `sessions.external.count` WebSocket event

### Step 9: Desktop — ChatsPanel UI
**Files:** `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx`
- Add badge showing external session count next to header
- Add collapsible import section with session list
- Each entry: title (firstPrompt/summary), time, branch, Import button
- On import: call API, add to chat list, update count

### Step 10: Tests
- Unit test for `listExternalSessions` (mock sessions-index.json)
- Unit test for `ExternalSessionService.scan()` and `importSession()`
- Unit test for DB methods
- Unit test for API routes

## Parallelization

Steps 1-4 are sequential (types → implementation → DB).
Steps 5-6 depend on 1-4 but can be worked in parallel with each other.
Steps 8-9 (desktop) depend on 6-7 (API/WS) being defined but can be developed in parallel.
Step 10 can be parallelized per-layer.
