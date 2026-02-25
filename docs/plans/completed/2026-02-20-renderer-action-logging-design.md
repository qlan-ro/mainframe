# Renderer Action Logging

**Date:** 2026-02-20
**Branch:** feat/logging-system

## Problem

The renderer logger (`renderer.YYYY-MM-DD.log`) was empty after normal use. Only error/warn paths produced entries. User actions like sending messages, creating sessions, switching adapters, uploading attachments, and managing projects went unlogged.

## Design

Add `info`-level logs for every meaningful user-initiated action. Use the existing `createLogger` IPC bridge so all entries flow to `~/.mainframe/logs/renderer.YYYY-MM-DD.log`.

### Placement strategy

- **WebSocket commands** → log inside `daemonClient` command methods (`client.ts`). Single file, covers all call sites automatically.
- **REST API actions** → log at call sites in the component/hook that initiates them (`useDaemon.ts`, `ChatsPanel.tsx`, `ProjectRail.tsx`).

### Changes per file

#### `renderer/lib/client.ts`

Add `createLogger('client')`. Log each user-initiated command method:

| Method | Level | Fields |
|---|---|---|
| `createChat` | info | `projectId`, `adapterId`, `model` |
| `updateChatConfig` | info | `chatId`, `adapterId?`, `model?`, `permissionMode?` |
| `enableWorktree` | info | `chatId` |
| `disableWorktree` | info | `chatId` |
| `interruptChat` | info | `chatId` |
| `endChat` | info | `chatId` |
| `resumeChat` | **debug** | `chatId` (called automatically on reconnect — debug avoids noise) |

Skip `subscribe` / `unsubscribe` — internal bookkeeping.

Also upgrade existing `console.*` connection events to the structured logger.

#### `renderer/hooks/useDaemon.ts`

Already has a `log` instance. Add before `uploadAttachments`:

```
log.info('uploadAttachments', { chatId, count: attachments.length })
```

#### `renderer/components/panels/ChatsPanel.tsx`

Add `createLogger('chats')`. Log in `handleArchiveChat`:

```
log.info('archiveChat', { chatId })
```

#### `renderer/components/ProjectRail.tsx`

Add `createLogger('project')`. Log:

- `log.info('createProject', { path })` after path is confirmed
- `log.info('removeProject', { projectId: id })` in `handleConfirmDelete`

### Sample output

```json
{"level":30,"module":"client","msg":"createChat","projectId":"proj_1","adapterId":"claude"}
{"level":20,"module":"client","msg":"resumeChat","chatId":"chat_42"}
{"level":30,"module":"client","msg":"updateChatConfig","chatId":"chat_42","permissionMode":"yolo"}
{"level":30,"module":"daemon","msg":"uploadAttachments","chatId":"chat_42","count":2}
{"level":30,"module":"daemon","msg":"sendMessage","chatId":"chat_42","attachmentCount":2}
{"level":30,"module":"project","msg":"createProject","path":"/Users/…/myapp"}
{"level":30,"module":"chats","msg":"archiveChat","chatId":"chat_42"}
```
