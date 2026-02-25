# Renderer Action Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `info`-level structured logs for every meaningful user-initiated action in the renderer so `~/.mainframe/logs/renderer.YYYY-MM-DD.log` is populated during normal use.

**Architecture:** Two choke points cover all user actions. WebSocket commands are centralized in `DaemonClient` (`client.ts`) — log there, once, for all call sites. REST API mutations are centralized in the API layer (`projects-api.ts`, `attachments-api.ts`, `skills-api.ts`, `settings-api.ts`) — log at the function level, not in components. Read-only `get*` calls are skipped; they are automatic data fetches, not user actions.

**Tech Stack:** TypeScript, `renderer/lib/logger.ts` (`createLogger`), `renderer/lib/client.ts`, `renderer/lib/api/`

---

### Task 1: Add logger to `client.ts` and log WS commands

**Files:**
- Modify: `packages/desktop/src/renderer/lib/client.ts`

**Step 1: Add the import and module-level logger**

At the top of the file, after the existing import line:

```typescript
import { createLogger } from './logger';

const log = createLogger('client');
```

**Step 2: Replace `console.*` with structured logger**

In `connect()`:
```typescript
// onopen — replace:
console.log('[daemon] connected');
// with:
log.info('connected');

// onmessage catch — replace:
console.error('[daemon] failed to parse event:', error);
// with:
log.error('failed to parse event', { err: String(error) });

// onclose — replace:
console.log('[daemon] disconnected');
// with:
log.info('disconnected');
```

In `attemptReconnect()`:
```typescript
// replace:
console.error('[daemon] max reconnect attempts reached');
// with:
log.error('max reconnect attempts reached');
```

In `send()`:
```typescript
// replace:
console.warn(`[daemon] WS not ready (${state}), dropping message: ${event.type}`, event);
// with:
log.warn('WS not ready, dropping message', { state, type: event.type });
```

**Step 3: Add log calls to each command method**

Add a log call **after** the `this.send(...)` line in each method below. Leave `sendMessage`, `respondToPermission`, `subscribe`, `unsubscribe` unchanged.

```typescript
createChat(projectId: string, adapterId: string, model?: string): void {
  this.send({ type: 'chat.create', projectId, adapterId, model });
  log.info('createChat', { projectId, adapterId, model });
}

updateChatConfig(
  chatId: string,
  adapterId?: string,
  model?: string,
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo',
): void {
  this.send({ type: 'chat.updateConfig', chatId, adapterId, model, permissionMode });
  log.info('updateChatConfig', { chatId, adapterId, model, permissionMode });
}

resumeChat(chatId: string): void {
  this.send({ type: 'chat.resume', chatId });
  log.debug('resumeChat', { chatId });
}

endChat(chatId: string): void {
  this.send({ type: 'chat.end', chatId });
  log.info('endChat', { chatId });
}

interruptChat(chatId: string): void {
  this.send({ type: 'chat.interrupt', chatId });
  log.info('interruptChat', { chatId });
}

enableWorktree(chatId: string): void {
  this.send({ type: 'chat.enableWorktree', chatId });
  log.info('enableWorktree', { chatId });
}

disableWorktree(chatId: string): void {
  this.send({ type: 'chat.disableWorktree', chatId });
  log.info('disableWorktree', { chatId });
}
```

**Step 4: Typecheck**

```bash
pnpm --filter @mainframe/desktop tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/client.ts
git commit -m "feat(desktop): add structured logging to daemonClient WS commands"
```

---

### Task 2: Log mutations in `projects-api.ts`

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/projects-api.ts`

Log `createProject`, `removeProject`, and `archiveChat`. Skip all `get*` functions.

**Step 1: Add import and logger**

```typescript
import { createLogger } from '../logger';

const log = createLogger('api');
```

**Step 2: Add log calls before each mutating fetch**

```typescript
export async function createProject(path: string): Promise<Project> {
  log.info('createProject', { path });
  const json = await postJson<{ data: Project }>(`${API_BASE}/api/projects`, { path });
  return json.data;
}

export async function removeProject(id: string): Promise<void> {
  log.info('removeProject', { id });
  await deleteRequest(`${API_BASE}/api/projects/${id}`);
}

export async function archiveChat(chatId: string): Promise<void> {
  log.info('archiveChat', { chatId });
  await postJson(`${API_BASE}/api/chats/${chatId}/archive`);
}
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/projects-api.ts
git commit -m "feat(desktop): log createProject, removeProject, archiveChat in api layer"
```

---

### Task 3: Log `uploadAttachments` in `attachments-api.ts`

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/attachments-api.ts`

Skip `getAttachment` (read-only).

**Step 1: Add import and logger**

```typescript
import { createLogger } from '../logger';

const log = createLogger('api');
```

**Step 2: Add log call before the fetch**

```typescript
export async function uploadAttachments(
  chatId: string,
  attachments: { ... }[],
): Promise<...> {
  log.info('uploadAttachments', { chatId, count: attachments.length });
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/attachments`, {
    ...
  });
  ...
}
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/attachments-api.ts
git commit -m "feat(desktop): log uploadAttachments in api layer"
```

---

### Task 4: Log mutations in `skills-api.ts`

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/skills-api.ts`

Log all 6 mutating functions. Skip `getSkills` and `getAgents`.

**Step 1: Add import and logger**

```typescript
import { createLogger } from '../logger';

const log = createLogger('api');
```

**Step 2: Add log calls**

```typescript
export async function createSkill(adapterId: string, data: { projectPath: string } & CreateSkillInput): Promise<Skill> {
  log.info('createSkill', { adapterId, projectPath: data.projectPath });
  ...
}

export async function updateSkill(adapterId: string, skillId: string, projectPath: string, content: string): Promise<Skill> {
  log.info('updateSkill', { adapterId, skillId, projectPath });
  ...
}

export async function deleteSkill(adapterId: string, skillId: string, projectPath: string): Promise<void> {
  log.info('deleteSkill', { adapterId, skillId, projectPath });
  ...
}

export async function createAgent(adapterId: string, data: { projectPath: string } & CreateAgentInput): Promise<AgentConfig> {
  log.info('createAgent', { adapterId, projectPath: data.projectPath });
  ...
}

export async function updateAgent(adapterId: string, agentId: string, projectPath: string, content: string): Promise<AgentConfig> {
  log.info('updateAgent', { adapterId, agentId, projectPath });
  ...
}

export async function deleteAgent(adapterId: string, agentId: string, projectPath: string): Promise<void> {
  log.info('deleteAgent', { adapterId, agentId, projectPath });
  ...
}
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/skills-api.ts
git commit -m "feat(desktop): log skill and agent mutations in api layer"
```

---

### Task 5: Log mutations in `settings-api.ts`

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/settings-api.ts`

Log `updateProviderSettings` and `updateGeneralSettings`. Skip `get*` and `getConfigConflicts`.

**Step 1: Add import and logger**

```typescript
import { createLogger } from '../logger';

const log = createLogger('api');
```

**Step 2: Add log calls**

```typescript
export async function updateProviderSettings(adapterId: string, settings: Partial<ProviderConfig>): Promise<void> {
  log.info('updateProviderSettings', { adapterId });
  await putJson(`${API_BASE}/api/settings/providers/${adapterId}`, settings);
}

export async function updateGeneralSettings(settings: Partial<GeneralConfig>): Promise<void> {
  log.info('updateGeneralSettings');
  await putJson(`${API_BASE}/api/settings/general`, settings);
}
```

**Step 3: Typecheck**

```bash
pnpm --filter @mainframe/desktop tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/settings-api.ts
git commit -m "feat(desktop): log settings mutations in api layer"
```

---

### Task 6: Run existing tests

**Step 1: Run logger unit tests**

```bash
pnpm --filter @mainframe/desktop test -- renderer/lib/logger
```

Expected: all 5 tests pass.

**Step 2: Run full desktop test suite**

```bash
pnpm --filter @mainframe/desktop test
```

Expected: all tests pass, no regressions.
