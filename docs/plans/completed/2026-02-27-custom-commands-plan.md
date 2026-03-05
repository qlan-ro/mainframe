# Custom Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add provider custom commands (/clear, /compact) and a mainframe custom command framework, discoverable via REST and invocable from the desktop composer.

**Architecture:** Commands are declared in adapter manifests and a static mainframe registry. A new REST endpoint serves them. The existing `message.send` WS event gains an optional `metadata.command` field. ChatManager routes command messages to `session.sendCommand()` (provider) or wraps them in prompt templates (mainframe). The desktop merges commands into the existing `/` popover.

**Tech Stack:** TypeScript, Zod, Express, React, Zustand, assistant-ui

---

### Task 1: Add CustomCommand type to @mainframe/types

**Files:**
- Create: `packages/types/src/command.ts`
- Modify: `packages/types/src/index.ts:1-6`

**Step 1: Write the type file**

Create `packages/types/src/command.ts`:

```typescript
export interface CustomCommand {
  /** Command name without the leading slash */
  name: string;
  /** Short description shown in the popover */
  description: string;
  /** Origin: adapter id (e.g. 'claude') or 'mainframe' */
  source: string;
  /** Mainframe commands only — prompt sent to the model */
  promptTemplate?: string;
}
```

**Step 2: Export from barrel**

In `packages/types/src/index.ts`, add after the last export:

```typescript
export * from './command.js';
```

**Step 3: Build types package**

Run: `pnpm --filter @mainframe/types build`
Expected: Clean build, no errors.

**Step 4: Commit**

```bash
git add packages/types/src/command.ts packages/types/src/index.ts
git commit -m "feat(types): add CustomCommand type"
```

---

### Task 2: Add commands field to PluginManifest and Claude manifest

**Files:**
- Modify: `packages/types/src/plugin.ts:31-50` (PluginManifest interface)
- Modify: `packages/core/src/plugins/builtin/claude/manifest.json`

**Step 1: Add commands to PluginManifest**

In `packages/types/src/plugin.ts`, add to the `PluginManifest` interface (after the `adapter?` field, before the closing `}`):

```typescript
  /** Custom commands this adapter exposes */
  commands?: Array<{ name: string; description: string }>;
```

**Step 2: Add commands to Claude manifest**

In `packages/core/src/plugins/builtin/claude/manifest.json`, add the `commands` array:

```json
{
  "id": "claude",
  "name": "Claude CLI",
  "version": "1.0.0",
  "description": "Claude CLI adapter — built-in",
  "capabilities": ["adapters", "process:exec"],
  "adapter": {
    "binaryName": "claude",
    "displayName": "Claude CLI"
  },
  "commands": [
    { "name": "clear", "description": "Clear conversation history" },
    { "name": "compact", "description": "Compress context to save tokens" }
  ]
}
```

**Step 3: Build types package**

Run: `pnpm --filter @mainframe/types build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/types/src/plugin.ts packages/core/src/plugins/builtin/claude/manifest.json
git commit -m "feat: add commands field to PluginManifest and Claude manifest"
```

---

### Task 3: Add Adapter.listCommands() method

**Files:**
- Modify: `packages/types/src/adapter.ts:146-173` (Adapter interface)
- Modify: `packages/core/src/plugins/builtin/claude/adapter.ts` (ClaudeAdapter)

**Step 1: Add listCommands to Adapter interface**

In `packages/types/src/adapter.ts`, add to the `Adapter` interface (after `listAgents?`):

```typescript
  listCommands?(): import('./command.js').CustomCommand[];
```

**Step 2: Implement in ClaudeAdapter**

Find the ClaudeAdapter class in `packages/core/src/plugins/builtin/claude/adapter.ts`. Add a `listCommands()` method that reads commands from the manifest:

```typescript
listCommands(): CustomCommand[] {
  return (manifest.commands ?? []).map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    source: this.id,
  }));
}
```

Import `CustomCommand` from `@mainframe/types` and import `manifest` from `./manifest.json`.

**Step 3: Build**

Run: `pnpm --filter @mainframe/types build && pnpm --filter @mainframe/core build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/types/src/adapter.ts packages/core/src/plugins/builtin/claude/adapter.ts
git commit -m "feat: add Adapter.listCommands() and implement for Claude"
```

---

### Task 4: Add mainframe command registry in core

**Files:**
- Create: `packages/core/src/commands/registry.ts`

**Step 1: Create the registry**

Create `packages/core/src/commands/registry.ts`:

```typescript
import type { CustomCommand } from '@mainframe/types';

/**
 * Static registry of Mainframe-defined custom commands.
 * Empty for v1 — the framework is ready for future commands.
 */
const MAINFRAME_COMMANDS: CustomCommand[] = [];

export function getMainframeCommands(): CustomCommand[] {
  return MAINFRAME_COMMANDS;
}
```

**Step 2: Build**

Run: `pnpm --filter @mainframe/core build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/core/src/commands/registry.ts
git commit -m "feat(core): add mainframe command registry (empty for v1)"
```

---

### Task 5: Add REST endpoint GET /api/commands

**Files:**
- Create: `packages/core/src/server/routes/commands.ts`
- Modify: `packages/core/src/server/routes/index.ts:1-12`
- Modify: `packages/core/src/server/http.ts:62-76` (route registration)

**Step 1: Write the failing test**

Create `packages/core/src/server/routes/__tests__/commands.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { commandRoutes } from '../commands.js';

function makeCtx(commands = [{ name: 'clear', description: 'Clear history' }]) {
  const adapter = { id: 'claude', listCommands: vi.fn(() => commands.map((c) => ({ ...c, source: 'claude' }))) };
  return {
    adapters: {
      getAll: vi.fn(() => [adapter]),
    },
  } as any;
}

describe('GET /api/commands', () => {
  it('returns commands from all adapters plus mainframe', async () => {
    const app = express();
    app.use(commandRoutes(makeCtx()));
    const res = await request(app).get('/api/commands');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'clear', source: 'claude' }),
      ]),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core test -- src/server/routes/__tests__/commands.test.ts`
Expected: FAIL — module not found.

**Step 3: Create the route**

Create `packages/core/src/server/routes/commands.ts`:

```typescript
import { Router } from 'express';
import type { RouteContext } from './types.js';
import { getMainframeCommands } from '../../commands/registry.js';
import { asyncHandler } from './async-handler.js';
import type { CustomCommand } from '@mainframe/types';

export function commandRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/commands',
    asyncHandler(async (_req, res) => {
      const commands: CustomCommand[] = [...getMainframeCommands()];
      for (const adapter of ctx.adapters.getAll()) {
        if (adapter.listCommands) {
          commands.push(...adapter.listCommands());
        }
      }
      res.json({ success: true, data: commands });
    }),
  );

  return router;
}
```

**Step 4: Add getAll() to AdapterRegistry**

Check `packages/core/src/adapters/index.ts`. The registry likely has a `list()` method that returns `AdapterInfo[]`. We need a `getAll()` that returns the raw `Adapter` objects. Add:

```typescript
getAll(): Adapter[] {
  return [...this.adapters.values()];
}
```

**Step 5: Export route and register it**

In `packages/core/src/server/routes/index.ts`, add:

```typescript
export { commandRoutes } from './commands.js';
```

In `packages/core/src/server/http.ts`, add after `app.use(adapterRoutes(ctx));`:

```typescript
app.use(commandRoutes(ctx));
```

**Step 6: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core test -- src/server/routes/__tests__/commands.test.ts`
Expected: PASS.

**Step 7: Commit**

```bash
git add packages/core/src/server/routes/commands.ts \
       packages/core/src/server/routes/__tests__/commands.test.ts \
       packages/core/src/server/routes/index.ts \
       packages/core/src/server/http.ts \
       packages/core/src/adapters/index.ts
git commit -m "feat(core): add GET /api/commands endpoint"
```

---

### Task 6: Add metadata to MessageSend WS schema and ChatManager routing

**Files:**
- Modify: `packages/core/src/server/ws-schemas.ts:36-41` (MessageSend)
- Modify: `packages/core/src/server/websocket.ts:91-93` (message.send case)
- Modify: `packages/core/src/chat/chat-manager.ts:144-199` (sendMessage)

**Step 1: Write the failing test**

Create `packages/core/src/chat/__tests__/command-routing.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
// Test that ChatManager routes commands to sendCommand vs sendMessage
// based on metadata.command presence and source.

describe('ChatManager command routing', () => {
  it('calls session.sendCommand for provider commands', async () => {
    // Mock an active chat with a spawned session
    const sendCommand = vi.fn();
    const sendMessage = vi.fn();
    const session = { isSpawned: true, sendCommand, sendMessage };
    // ... construct ChatManager with mocked internals
    // Call sendMessage with metadata.command
    // Assert sendCommand was called, not sendMessage
  });

  it('calls session.sendMessage with wrapped template for mainframe commands', async () => {
    const sendMessage = vi.fn();
    const session = { isSpawned: true, sendCommand: vi.fn(), sendMessage };
    // Call sendMessage with metadata.command where source='mainframe'
    // Assert sendMessage was called with the wrapped template
  });

  it('calls session.sendMessage normally when no metadata', async () => {
    const sendMessage = vi.fn();
    const session = { isSpawned: true, sendCommand: vi.fn(), sendMessage };
    // Call sendMessage without metadata
    // Assert sendMessage was called with raw content
  });
});
```

Note: The exact test setup depends on how ChatManager is constructed. Look at existing tests in `packages/core/src/chat/__tests__/` for patterns. Adapt mocks accordingly.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core test -- src/chat/__tests__/command-routing.test.ts`
Expected: FAIL.

**Step 3: Extend MessageSend schema**

In `packages/core/src/server/ws-schemas.ts`, update the `MessageSend` schema:

```typescript
const MessageSend = z.object({
  type: z.literal('message.send'),
  chatId: z.string().min(1),
  content: z.string().min(1),
  attachmentIds: z.array(z.string()).optional(),
  metadata: z
    .object({
      command: z
        .object({
          name: z.string().min(1),
          source: z.string().min(1),
          args: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});
```

**Step 4: Update WebSocket handler to pass metadata**

In `packages/core/src/server/websocket.ts`, update the `message.send` case:

```typescript
case 'message.send': {
  await this.chats.sendMessage(event.chatId, event.content, event.attachmentIds, event.metadata);
  break;
}
```

**Step 5: Update ChatManager.sendMessage signature and routing**

In `packages/core/src/chat/chat-manager.ts`, update `sendMessage`:

```typescript
async sendMessage(
  chatId: string,
  content: string,
  attachmentIds?: string[],
  metadata?: { command?: { name: string; source: string; args?: string } },
): Promise<void> {
  // ... existing startChat logic ...

  // Command routing
  if (metadata?.command) {
    const { name, source, args } = metadata.command;
    if (source === 'mainframe') {
      // Mainframe command: wrap in prompt template and send as message
      const wrappedContent = wrapMainframeCommand(name, content, args);
      await postStart.session.sendMessage(wrappedContent);
    } else {
      // Provider command: delegate to sendCommand
      await postStart.session.sendCommand(name, args);
    }
    return;
  }

  // ... existing message flow (attachments, transient message, etc.) ...
}
```

Add the helper (in a separate file or at the bottom of chat-manager.ts if small):

```typescript
function wrapMainframeCommand(name: string, _content: string, args?: string): string {
  const id = `cmd_${crypto.randomUUID().slice(0, 8)}`;
  // For v1, no concrete commands exist. The template is a placeholder.
  const template = args ?? '';
  return [
    `<mainframe-command name="${name}" id="${id}">`,
    template,
    '',
    'Wrap your entire response in:',
    `<mainframe-command-response id="${id}">`,
    'YOUR RESPONSE HERE',
    '</mainframe-command-response>',
    '</mainframe-command>',
  ].join('\n');
}
```

**Step 6: Run tests**

Run: `pnpm --filter @mainframe/core test -- src/chat/__tests__/command-routing.test.ts`
Expected: PASS.

**Step 7: Build**

Run: `pnpm --filter @mainframe/core build`
Expected: Clean build.

**Step 8: Commit**

```bash
git add packages/core/src/server/ws-schemas.ts \
       packages/core/src/server/websocket.ts \
       packages/core/src/chat/chat-manager.ts \
       packages/core/src/chat/__tests__/command-routing.test.ts
git commit -m "feat(core): route commands via metadata in message.send"
```

---

### Task 7: Strip mainframe command tags from assistant messages

**Files:**
- Modify: `packages/core/src/messages/message-parsing.ts`

**Step 1: Write the failing test**

Add to existing tests for message-parsing (or create new test file):

```typescript
import { describe, it, expect } from 'vitest';
import { stripMainframeCommandTags } from '../message-parsing.js';

describe('stripMainframeCommandTags', () => {
  it('strips response wrapper tags', () => {
    const input = '<mainframe-command-response id="cmd_abc">Hello world</mainframe-command-response>';
    expect(stripMainframeCommandTags(input)).toBe('Hello world');
  });

  it('returns text unchanged when no tags present', () => {
    expect(stripMainframeCommandTags('Normal text')).toBe('Normal text');
  });

  it('strips command wrapper from user messages', () => {
    const input = '<mainframe-command name="init" id="cmd_abc">Do init work</mainframe-command>';
    expect(stripMainframeCommandTags(input)).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core test -- src/messages/__tests__/message-parsing.test.ts`
Expected: FAIL — function not exported.

**Step 3: Implement**

In `packages/core/src/messages/message-parsing.ts`, add:

```typescript
const MAINFRAME_CMD_RESPONSE_RE = /<mainframe-command-response[^>]*>([\s\S]*?)<\/mainframe-command-response>/;
const MAINFRAME_CMD_WRAPPER_RE = /<mainframe-command[^>]*>[\s\S]*?<\/mainframe-command>/;

export function stripMainframeCommandTags(text: string): string {
  // Extract inner content from response tags
  const responseMatch = text.match(MAINFRAME_CMD_RESPONSE_RE);
  if (responseMatch) {
    return responseMatch[1]!.trim();
  }
  // Strip command wrappers entirely (user message side)
  return text.replace(MAINFRAME_CMD_WRAPPER_RE, '').trim();
}
```

**Step 4: Run test**

Run: `pnpm --filter @mainframe/core test -- src/messages/__tests__/message-parsing.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/messages/message-parsing.ts \
       packages/core/src/messages/__tests__/message-parsing.test.ts
git commit -m "feat(core): add stripMainframeCommandTags for response extraction"
```

---

### Task 8: Desktop — add commands API and extend skills store

**Files:**
- Create: `packages/desktop/src/renderer/lib/api/commands-api.ts`
- Modify: `packages/desktop/src/renderer/lib/api/index.ts`
- Modify: `packages/desktop/src/renderer/store/skills.ts`

**Step 1: Create commands-api.ts**

```typescript
import { fetchJson, API_BASE } from './http';
import type { CustomCommand } from '@mainframe/types';

export async function getCommands(): Promise<CustomCommand[]> {
  const json = await fetchJson<{ success: boolean; data: CustomCommand[] }>(
    `${API_BASE}/api/commands`,
  );
  return json.data;
}
```

**Step 2: Export from API barrel**

In `packages/desktop/src/renderer/lib/api/index.ts`, add:

```typescript
export { getCommands } from './commands-api';
```

**Step 3: Extend skills store to also hold commands**

In `packages/desktop/src/renderer/store/skills.ts`, add `commands` to the state and a `fetchCommands` action. The store state gets:

```typescript
commands: CustomCommand[];
```

Add a `fetchCommands` action that calls `getCommands()` and sets `commands`. Call `fetchCommands` alongside `fetchSkills` so both load at the same time.

**Step 4: Build desktop**

Run: `pnpm --filter @mainframe/desktop build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/commands-api.ts \
       packages/desktop/src/renderer/lib/api/index.ts \
       packages/desktop/src/renderer/store/skills.ts
git commit -m "feat(desktop): add commands API client and extend skills store"
```

---

### Task 9: Desktop — merge commands into ContextPickerMenu

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:15-18` (PickerItem type)
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:124-146` (item building)
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:262-293` (rendering)

**Step 1: Extend PickerItem type**

Add a new variant to the `PickerItem` union at line 15:

```typescript
type PickerItem =
  | { type: 'agent'; name: string; description: string; scope: string }
  | { type: 'file'; name: string; path: string }
  | { type: 'skill'; skill: Skill }
  | { type: 'command'; command: CustomCommand };
```

Import `CustomCommand` from `@mainframe/types`.

**Step 2: Pull commands from store**

In the component, alongside `const { agents, skills } = useSkillsStore();`, add `commands`:

```typescript
const { agents, skills, commands } = useSkillsStore();
```

**Step 3: Add commands to the items list**

In the item building block (around lines 124-146), after the skills section, add:

```typescript
if (filterMode === 'all' || filterMode === 'skills') {
  commands
    .filter((c) => !query || fuzzyMatch(query, c.name))
    .forEach((c) => items.push({ type: 'command', command: c }));
}
```

**Step 4: Handle selection**

In the `selectItem` function (around line 150), add handling for `type: 'command'`:

```typescript
if (item.type === 'command') {
  const ins = `/${item.command.name} `;
  composerRuntime.setText(ins);
  // ... close popover logic (same as skill selection)
}
```

**Step 5: Render command items**

In the rendering section (around lines 262-293), add a case for `type: 'command'`:

```typescript
{item.type === 'command' && (
  <>
    <Wrench size={14} className="text-mf-text-secondary shrink-0" />
    <span className="font-mono text-mf-small text-mf-text-primary truncate">
      /{item.command.name}
    </span>
    <span className="ml-auto text-[10px] text-mf-text-secondary/60 shrink-0">
      {item.command.source}
    </span>
  </>
)}
```

Import `Wrench` from `lucide-react`.

**Step 6: Build desktop**

Run: `pnpm --filter @mainframe/desktop build`
Expected: Clean build.

**Step 7: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx
git commit -m "feat(desktop): merge commands into / popover with wrench icon"
```

---

### Task 10: Desktop — send command metadata with message

**Files:**
- Modify: `packages/desktop/src/renderer/lib/client.ts:159-162` (sendMessage method)
- Modify: `packages/desktop/src/renderer/hooks/useChatSession.ts:80-101` (sendMessage callback)
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx` (onNew callback)

**Step 1: Extend daemonClient.sendMessage**

In `packages/desktop/src/renderer/lib/client.ts`, update `sendMessage` to accept optional metadata:

```typescript
sendMessage(
  chatId: string,
  content: string,
  attachmentIds?: string[],
  metadata?: { command?: { name: string; source: string; args?: string } },
): void {
  this.send({ type: 'message.send', chatId, content, attachmentIds, metadata });
  log.info('sendMessage', { chatId, attachmentCount: attachmentIds?.length ?? 0 });
}
```

**Step 2: Extend useChatSession.sendMessage**

In `packages/desktop/src/renderer/hooks/useChatSession.ts`, update the `sendMessage` callback to accept and forward metadata:

```typescript
const sendMessage = useCallback(
  async (
    content: string,
    attachments?: { ... }[],
    metadata?: { command?: { name: string; source: string; args?: string } },
  ) => {
    if (!chatId) return;
    let attachmentIds: string[] | undefined;
    if (attachments?.length) {
      const uploaded = await uploadAttachments(chatId, attachments);
      attachmentIds = uploaded.map((a) => a.id);
    }
    daemonClient.sendMessage(chatId, content, attachmentIds, metadata);
  },
  [chatId],
);
```

**Step 3: Detect command in MainframeRuntimeProvider onNew callback**

In the `onNew` callback (where user messages get sent), detect if the content starts with a known command and attach metadata:

```typescript
// Inside onNew handler, before calling sendMessage:
const commandMatch = content.match(/^\/(\S+)/);
const matchedCommand = commandMatch
  ? commands.find((c) => c.name === commandMatch[1])
  : undefined;

const metadata = matchedCommand
  ? { command: { name: matchedCommand.name, source: matchedCommand.source } }
  : undefined;

sendMessage(content, attachments, metadata);
```

Pull `commands` from `useSkillsStore()` in the provider component.

**Step 4: Build desktop**

Run: `pnpm --filter @mainframe/desktop build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/client.ts \
       packages/desktop/src/renderer/hooks/useChatSession.ts \
       packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx
git commit -m "feat(desktop): send command metadata with message.send"
```

---

### Task 11: Desktop — render command invocations with wrench icon

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/messages/UserMessage.tsx:48-94`
- Modify: `packages/core/src/messages/message-parsing.ts` (extend parseRawCommand)

**Step 1: Extend parseRawCommand to recognize commands**

In `packages/core/src/messages/message-parsing.ts`, update `parseRawCommand` to also match known command names. Add a second parameter for commands:

```typescript
export function parseRawCommand(
  text: string,
  skills: Skill[],
  commands?: CustomCommand[],
): { commandName: string; userText: string; isCommand?: boolean } | null {
  if (!text.startsWith('/')) return null;
  const match = text.match(/^\/(\S+)/);
  if (!match) return null;
  const rawName = match[1]!;

  // Check commands first
  if (commands?.some((c) => c.name === rawName)) {
    const userText = text.slice(match[0].length).trim();
    return { commandName: rawName, userText, isCommand: true };
  }

  // Existing skill matching
  const isKnown = skills.some(
    (s) => s.invocationName === rawName || s.name === rawName || s.invocationName?.endsWith(`:${rawName}`),
  );
  if (!isKnown) return null;
  const resolved = resolveSkillName(rawName, skills);
  const userText = text.slice(match[0].length).trim();
  return { commandName: resolved, userText };
}
```

**Step 2: Update UserMessage rendering**

In `UserMessage.tsx`, when `parsed?.isCommand` is true, render with `Wrench` icon instead of `Zap`:

```typescript
const Icon = parsed?.isCommand ? Wrench : Zap;
// Then use <Icon size={14} ... /> in the JSX
```

Import `Wrench` from `lucide-react`. Pass `commands` from the skills store to `parseRawCommand`.

**Step 3: Build**

Run: `pnpm --filter @mainframe/core build && pnpm --filter @mainframe/desktop build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/core/src/messages/message-parsing.ts \
       packages/desktop/src/renderer/components/chat/assistant-ui/messages/UserMessage.tsx
git commit -m "feat(desktop): render command invocations with wrench icon"
```

---

### Task 12: Desktop — fetch commands on project change

**Files:**
- Modify: wherever `fetchSkills` is called on project change (likely `SkillsPanel.tsx` or a top-level effect)

**Step 1: Find where fetchSkills is triggered**

In `SkillsPanel.tsx` (or similar), there's a `useEffect` that calls `fetchSkills('claude', activeProject.path)` when the project changes. Add a `fetchCommands()` call alongside it:

```typescript
useEffect(() => {
  if (activeProject) {
    fetchSkills('claude', activeProject.path);
    fetchCommands();
  }
}, [activeProject?.path, fetchSkills, fetchCommands]);
```

**Step 2: Build desktop**

Run: `pnpm --filter @mainframe/desktop build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/SkillsPanel.tsx
git commit -m "feat(desktop): fetch commands alongside skills on project change"
```

---

### Task 13: Typecheck and integration test

**Step 1: Full typecheck**

Run: `pnpm build`
Expected: All packages build cleanly.

**Step 2: Run existing tests**

Run: `pnpm test`
Expected: All tests pass (new tests + existing).

**Step 3: Manual smoke test**

1. Start the daemon: `pnpm --filter @mainframe/core dev`
2. Start the desktop: `pnpm --filter @mainframe/desktop dev`
3. Open a project, start a chat.
4. Type `/` in the composer — verify `/clear` and `/compact` appear with wrench icons alongside skills.
5. Select `/compact` — verify it sends and the CLI processes it (context compacted).
6. Select `/clear` — verify it sends and the session resets.
7. Check the chat UI — command invocations should show wrench icon + `/commandName`.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from smoke test"
```
