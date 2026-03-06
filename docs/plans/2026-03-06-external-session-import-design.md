# External Session Import — Design

Import agent sessions created outside Mainframe (e.g. via Claude CLI directly) into a project's chat list, making them browsable and resumable.

## Scope

- Same-project only — sessions from `~/.claude/projects/<encoded-path>/`
- Resumable — imported sessions become full Mainframe chats with `--resume` support
- Auto-detection — daemon scans on project load and periodically, emits count via WebSocket
- Generic adapter API — `listExternalSessions()` on the `Adapter` interface; Claude implements first

## Adapter Interface

```typescript
// packages/types/src/adapter.ts
export interface ExternalSession {
  sessionId: string;        // CLI's native session UUID
  projectPath: string;
  firstPrompt?: string;     // First user message (truncated)
  summary?: string;         // AI-generated summary if available
  messageCount?: number;
  createdAt: string;        // ISO-8601
  modifiedAt: string;
  gitBranch?: string;
  model?: string;
}

// Added to Adapter interface as optional method
listExternalSessions?(projectPath: string, excludeSessionIds: string[]): Promise<ExternalSession[]>;
```

## Claude Adapter Implementation

Reads `~/.claude/projects/<encoded-path>/sessions-index.json` (written by newer Claude CLI versions). No JSONL-scan fallback — sessions without an index file are not listed.

The index format:
```json
{
  "version": 1,
  "entries": [{
    "sessionId": "uuid",
    "firstPrompt": "...",
    "summary": "...",
    "messageCount": 28,
    "created": "ISO-8601",
    "modified": "ISO-8601",
    "gitBranch": "main",
    "projectPath": "/path/to/project"
  }]
}
```

Filter out entries whose `sessionId` is in `excludeSessionIds`.

File: `packages/core/src/plugins/builtin/claude/external-sessions.ts`

## Daemon — ExternalSessionService

New service at `packages/core/src/chat/external-session-service.ts`:

- `scan(projectId)` — resolves project path, gets adapter, calls `listExternalSessions(path, alreadyImportedIds)`, returns list
- `importSession(projectId, sessionId, adapterId)` — creates Chat row with `claudeSessionId = sessionId`, returns Chat
- Auto-scan on project load — emits `sessions.external.count` over WebSocket
- Periodic refresh — every 5 minutes while project is active, re-emits if count changed

## API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/projects/:projectId/external-sessions` | GET | List importable sessions |
| `/api/projects/:projectId/external-sessions/import` | POST | Import a session → creates Chat |

Body for import: `{ sessionId: string, adapterId: string }`

## WebSocket Events

- `sessions.external.count` — `{ projectId: string, count: number }` — server → client

## UI — ChatsPanel

- Badge next to header showing count of available external sessions
- Collapsible "Import" section at top of chat list showing external sessions
- Each entry: first prompt/summary as title, relative time, branch, "Import" button
- On import: session appears as normal chat, count decreases

## Data Flow

```
Project opened
  → ExternalSessionService.scan(projectId)
    → adapter.listExternalSessions(path, excludeIds)
      → reads sessions-index.json, filters
    → emits sessions.external.count via WS
  → Desktop shows badge

User imports
  → POST /external-sessions/import { sessionId }
  → creates Chat with claudeSessionId = sessionId
  → chat appears in list, resumable via --resume
```

## Error Handling

- `sessions-index.json` missing/malformed → empty list, log warning
- Session already imported (race) → return existing chat
- No data duplication — messages stay in Claude's JSONL files
