# Tool-Result Truncation + Expand-on-Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Truncate large `tool_result.content` in the display pipeline and serve the full payload on demand from the CLI session JSONL, shrinking the renderer message graph without breaking functional parsing or diff rendering.

**Architecture:** Truncation happens in the display pipeline (`display-helpers.ts`), strictly downstream of ingestion (`events.ts`) where PR/plan/task parsers consume full content — so functional behavior is untouched. A persisted `session_file_path` column locates the transcript; a new endpoint stream-parses that JSONL to return full content by `tool_use` id. The renderer holds only truncated copies in the store; full content lives in transient local component state.

**Tech Stack:** TypeScript (strict, NodeNext), pnpm workspaces, better-sqlite3, Express + Zod, React + assistant-ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-15-tool-result-truncation-design.md`

---

## File Structure

- `packages/types/src/display.ts` — add `truncated?` / `fullBytes?` to `ToolCallResult` (canonical type).
- `packages/core/src/messages/truncate-tool-content.ts` (new) — pure truncation helper.
- `packages/core/src/messages/display-helpers.ts` — call the helper in `toToolCallResult`.
- `packages/core/src/db/schema.ts` — `session_file_path` column migration.
- `packages/core/src/db/chats.ts` — field→column mapping for `sessionFilePath`.
- `packages/core/src/chat/event-handler.ts` — persist `session_file_path` when `claudeSessionId` is set.
- `packages/core/src/messages/read-tool-result-from-jsonl.ts` (new) — locate a tool_result's full content in a session JSONL.
- `packages/core/src/server/routes/chats.ts` — new `GET /api/chats/:id/tool-result/:toolUseId`.
- `packages/desktop/src/renderer/lib/api/projects-api.ts` — `getToolResultContent` wrapper.
- `packages/desktop/src/renderer/components/chat/assistant-ui/ToolResultExpand.tsx` (new) — shared expand/collapse control.
- `packages/desktop/src/renderer/components/chat/assistant-ui/WriteFileCard.tsx` / `EditFileCard.tsx` and the generic tool-result renderer — wire the control.

---

## Task 1: Extend `ToolCallResult` type

**Files:**
- Modify: `packages/types/src/display.ts:3-9`

- [ ] **Step 1: Add fields**

```ts
export interface ToolCallResult {
  content: string;
  isError: boolean;
  structuredPatch?: DiffHunk[];
  originalFile?: string;
  modifiedFile?: string;
  truncated?: boolean;
  fullBytes?: number;
}
```

- [ ] **Step 2: Build the types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: clean exit, `dist/display.d.ts` regenerated with the new optional fields.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/display.ts
git commit -m "feat(types): add truncated/fullBytes to ToolCallResult"
```

---

## Task 2: Pure truncation helper

**Files:**
- Create: `packages/core/src/messages/truncate-tool-content.ts`
- Test: `packages/core/src/messages/__tests__/truncate-tool-content.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { truncateToolContent, TRUNCATE_THRESHOLD_BYTES } from '../truncate-tool-content.js';

describe('truncateToolContent', () => {
  it('returns content unchanged below threshold, no flag', () => {
    const small = 'line\n'.repeat(10);
    const r = truncateToolContent(small);
    expect(r.truncated).toBe(false);
    expect(r.content).toBe(small);
    expect(r.fullBytes).toBeUndefined();
  });

  it('truncates above threshold to head 100 + marker + tail 100', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `row ${i}`).join('\n');
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(TRUNCATE_THRESHOLD_BYTES);
    const r = truncateToolContent(big);
    expect(r.truncated).toBe(true);
    expect(r.fullBytes).toBe(Buffer.byteLength(big, 'utf8'));
    const lines = r.content.split('\n');
    expect(lines[0]).toBe('row 0');
    expect(lines[99]).toBe('row 99');
    expect(r.content).toContain('truncated');
    expect(lines[lines.length - 1]).toBe('row 4999');
    expect(lines[lines.length - 100]).toBe('row 4900');
  });

  it('treats a string just over the byte threshold as truncated', () => {
    const justOver = 'x'.repeat(TRUNCATE_THRESHOLD_BYTES + 1);
    expect(truncateToolContent(justOver).truncated).toBe(true);
  });

  it('treats a string exactly at the threshold as untruncated', () => {
    const exact = 'x'.repeat(TRUNCATE_THRESHOLD_BYTES);
    expect(truncateToolContent(exact).truncated).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- truncate-tool-content`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
export const TRUNCATE_THRESHOLD_BYTES = 32 * 1024;
const HEAD_LINES = 100;
const TAIL_LINES = 100;

export interface TruncateResult {
  content: string;
  truncated: boolean;
  fullBytes?: number;
}

export function truncateToolContent(content: string): TruncateResult {
  const fullBytes = Buffer.byteLength(content, 'utf8');
  if (fullBytes <= TRUNCATE_THRESHOLD_BYTES) {
    return { content, truncated: false };
  }
  const lines = content.split('\n');
  if (lines.length <= HEAD_LINES + TAIL_LINES) {
    const head = content.slice(0, TRUNCATE_THRESHOLD_BYTES / 2);
    const tail = content.slice(-TRUNCATE_THRESHOLD_BYTES / 2);
    return {
      content: `${head}\n…[truncated · ${Math.round(fullBytes / 1024)} KB — expand]…\n${tail}`,
      truncated: true,
      fullBytes,
    };
  }
  const head = lines.slice(0, HEAD_LINES).join('\n');
  const tail = lines.slice(-TAIL_LINES).join('\n');
  const omitted = lines.length - HEAD_LINES - TAIL_LINES;
  return {
    content: `${head}\n…[truncated ${omitted} lines · ${Math.round(fullBytes / 1024)} KB — expand]…\n${tail}`,
    truncated: true,
    fullBytes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- truncate-tool-content`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/messages/truncate-tool-content.ts packages/core/src/messages/__tests__/truncate-tool-content.test.ts
git commit -m "feat(core): add truncateToolContent helper"
```

---

## Task 3: Wire truncation into the display pipeline

**Files:**
- Modify: `packages/core/src/messages/display-helpers.ts` (function `toToolCallResult`, ~line 33)
- Test: `packages/core/src/messages/__tests__/display-helpers-truncate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { toToolCallResult } from '../display-helpers.js';
import { TRUNCATE_THRESHOLD_BYTES } from '../truncate-tool-content.js';

describe('toToolCallResult truncation', () => {
  it('flags and shrinks oversized content', () => {
    const big = 'A'.repeat(TRUNCATE_THRESHOLD_BYTES + 5000);
    const r = toToolCallResult({ content: big, is_error: false } as never);
    expect(r.truncated).toBe(true);
    expect(r.fullBytes).toBe(TRUNCATE_THRESHOLD_BYTES + 5000);
    expect(Buffer.byteLength(r.content, 'utf8')).toBeLessThan(TRUNCATE_THRESHOLD_BYTES + 5000);
  });

  it('leaves small content and structured fields intact', () => {
    const r = toToolCallResult({
      content: 'ok',
      is_error: false,
      structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }],
    } as never);
    expect(r.truncated).toBeUndefined();
    expect(r.content).toBe('ok');
    expect(r.structuredPatch).toHaveLength(1);
  });
});
```

> Adjust the input object shape to match the real argument type of `toToolCallResult` — open `display-helpers.ts:33` and mirror its parameter exactly. The assertions stay the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- display-helpers-truncate`
Expected: FAIL — `truncated` undefined on oversized content.

- [ ] **Step 3: Implement**

In `display-helpers.ts`, import the helper and apply it where `content` is assembled:

```ts
import { truncateToolContent } from './truncate-tool-content.js';
```

Inside `toToolCallResult`, after the raw content string is computed and before constructing the returned object, replace the direct `content` assignment with:

```ts
const t = truncateToolContent(rawContent);
return {
  content: t.content,
  isError,
  ...(t.truncated ? { truncated: true, fullBytes: t.fullBytes } : {}),
  ...(structuredPatch ? { structuredPatch } : {}),
  ...(originalFile !== undefined ? { originalFile } : {}),
  ...(modifiedFile !== undefined ? { modifiedFile } : {}),
};
```

> Use the file's existing variable names (`rawContent`, `isError`, `structuredPatch`, etc.). Do not change how `structuredPatch`/`originalFile`/`modifiedFile` are derived — only the `content` value.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- display-helpers-truncate`
Expected: PASS (2 tests).

- [ ] **Step 5: Regression — ingestion parsers still see full content**

Add to the same test file:

```ts
import { extractPrFromToolResult } from '../../plugins/builtin/claude/events.js';

it('PR detection (ingestion) is unaffected — it runs on raw content, not the truncated copy', () => {
  const url = 'https://github.com/acme/repo/pull/4242';
  const huge = 'x'.repeat(TRUNCATE_THRESHOLD_BYTES + 1000) + '\n' + url;
  // extractPrFromToolResult is the ingestion-side parser; it must still find the URL
  // because truncation lives only in the display pipeline, never on this path.
  expect(extractPrFromToolResult(huge)).toContain('github.com/acme/repo/pull/4242');
});
```

> If `extractPrFromToolResult` is not exported, export it from `events.ts` (named export only — no behavior change). If its signature differs, adapt the call; the assertion (URL found in oversized input) is the invariant.

- [ ] **Step 6: Run regression test**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- display-helpers-truncate`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/messages/display-helpers.ts packages/core/src/messages/__tests__/display-helpers-truncate.test.ts packages/core/src/plugins/builtin/claude/events.ts
git commit -m "feat(core): truncate oversized tool_result content in display pipeline"
```

---

## Task 4: `session_file_path` column

**Files:**
- Modify: `packages/core/src/db/schema.ts` (migration block, after the `plan_mode` column add ~line 117-120)
- Modify: `packages/core/src/db/chats.ts` (SELECT field list ~line 22, field map ~line 144)
- Test: `packages/core/src/db/__tests__/session-file-path-migration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../schema.js';

describe('session_file_path migration', () => {
  it('adds the column and is idempotent', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db); // second run must not throw
    const cols = (db.pragma('table_info(chats)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('session_file_path');
  });
});
```

> Confirm the exported migration entrypoint name in `schema.ts` (it may be `runMigrations`, `migrate`, or invoked inside an `init`). Use the real exported function; if migrations only run via a higher-level `openDb`, call that instead and assert the column on its `chats` table.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- session-file-path-migration`
Expected: FAIL — column absent.

- [ ] **Step 3: Add the migration**

In `schema.ts`, alongside the other `cols.some(...)` guards:

```ts
if (!cols.some((c) => c.name === 'session_file_path')) {
  db.exec('ALTER TABLE chats ADD COLUMN session_file_path TEXT');
}
```

- [ ] **Step 4: Map the field in the repo**

In `chats.ts`, add `session_file_path as sessionFilePath` to the `CHAT_SELECT_FIELDS` list (mirror how `claude_session_id as claudeSessionId` appears ~line 22), and add to the update field map (~line 144):

```ts
sessionFilePath: { column: 'session_file_path' },
```

Add `sessionFilePath?: string` to the `Chat` type in `packages/types/src/chat.ts` (next to `claudeSessionId`), then `pnpm --filter @qlan-ro/mainframe-types build`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- session-file-path-migration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/chats.ts packages/types/src/chat.ts packages/core/src/db/__tests__/session-file-path-migration.test.ts
git commit -m "feat(core): add session_file_path column to chats"
```

---

## Task 5: Persist `session_file_path` when the session id is known

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts:137-138`
- Test: `packages/core/src/chat/__tests__/event-handler-session-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeSessionFilePath } from '../event-handler.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('computeSessionFilePath', () => {
  it('encodes cwd the Claude way and points at the jsonl', () => {
    const p = computeSessionFilePath('/Users/x/proj', 'sess-abc');
    expect(p).toBe(join(homedir(), '.claude', 'projects', '-Users-x-proj', 'sess-abc.jsonl'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- event-handler-session-path`
Expected: FAIL — `computeSessionFilePath` not exported.

- [ ] **Step 3: Implement and wire**

In `event-handler.ts`, add and export:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export function computeSessionFilePath(cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
  return join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}
```

At line 137-138 where `claudeSessionId` is persisted, also compute and persist the path. The cwd is the chat's worktree if set, else the project path — resolve the project path via the existing projects repo on the handler's context:

```ts
db.chats.update(chatId, { claudeSessionId: sessionId });
active.chat.claudeSessionId = sessionId;
const projectPath = db.projects.get(active.chat.projectId)?.path;
const cwd = active.chat.worktreePath ?? projectPath;
if (cwd) {
  const sessionFilePath = computeSessionFilePath(cwd, sessionId);
  db.chats.update(chatId, { sessionFilePath });
  active.chat.sessionFilePath = sessionFilePath;
}
```

> Use the handler's actual db/projects accessor (grep nearby lines for how `db.projects` or an equivalent is referenced in this file; mirror it). Do not introduce a new DB import.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- event-handler-session-path`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/event-handler.ts packages/core/src/chat/__tests__/event-handler-session-path.test.ts
git commit -m "feat(core): persist session_file_path when claudeSessionId is assigned"
```

---

## Task 6: Read a tool_result's full content from a session JSONL

**Files:**
- Create: `packages/core/src/messages/read-tool-result-from-jsonl.ts`
- Test: `packages/core/src/messages/__tests__/read-tool-result-from-jsonl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readToolResultFromJsonl } from '../read-tool-result-from-jsonl.js';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jsonl-'));
  const file = join(dir, 's.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'FULL CONTENT ONE' },
    ] } }),
    JSON.stringify({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'tu_2', content: [{ type: 'text', text: 'PART A' }, { type: 'text', text: 'PART B' }] },
    ] } }),
  ];
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('readToolResultFromJsonl', () => {
  it('returns full string content by tool_use id', async () => {
    expect(await readToolResultFromJsonl(fixture(), 'tu_1')).toBe('FULL CONTENT ONE');
  });

  it('flattens array content blocks to a string', async () => {
    expect(await readToolResultFromJsonl(fixture(), 'tu_2')).toContain('PART A');
  });

  it('returns null when the id is absent', async () => {
    expect(await readToolResultFromJsonl(fixture(), 'nope')).toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    expect(await readToolResultFromJsonl('/no/such/file.jsonl', 'tu_1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- read-tool-result-from-jsonl`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('jsonl-tool-result');

function flatten(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
      .join('\n');
  }
  return '';
}

export async function readToolResultFromJsonl(
  filePath: string,
  toolUseId: string,
): Promise<string | null> {
  let stream;
  try {
    stream = createReadStream(filePath, { encoding: 'utf8' });
  } catch (err) {
    log.warn({ err: String(err), filePath }, 'cannot open session jsonl');
    return null;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        /* expected: tolerate a partially-written trailing line */
        continue;
      }
      const content = (row as { message?: { content?: unknown } })?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: string }).type === 'tool_result' &&
          (block as { tool_use_id?: string }).tool_use_id === toolUseId
        ) {
          return flatten((block as { content?: unknown }).content);
        }
      }
    }
  } catch (err) {
    log.warn({ err: String(err), filePath }, 'error scanning session jsonl');
    return null;
  } finally {
    rl.close();
  }
  return null;
}
```

> If `history.ts` already exposes a JSONL line/tool-result parser (`extractToolResultContent`), import and reuse its flatten logic instead of the local `flatten` to stay DRY — check `packages/core/src/plugins/builtin/claude/history.ts:97-136` first. Keep the streaming scan local either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- read-tool-result-from-jsonl`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/messages/read-tool-result-from-jsonl.ts packages/core/src/messages/__tests__/read-tool-result-from-jsonl.test.ts
git commit -m "feat(core): stream-read full tool_result content from session jsonl"
```

---

## Task 7: Expand endpoint

**Files:**
- Modify: `packages/core/src/server/routes/chats.ts` (add route near the messages route ~line 91)
- Test: `packages/core/src/__tests__/routes/tool-result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerChatRoutes } from '../../server/routes/chats.js';

function app(ctx: unknown) {
  const a = express();
  a.use(express.json());
  const r = express.Router();
  registerChatRoutes(r, ctx as never);
  a.use(r);
  return a;
}

describe('GET /api/chats/:id/tool-result/:toolUseId', () => {
  it('returns full content from the chat session jsonl', async () => {
    const ctx = {
      chats: {
        getChat: () => ({ id: 'c1', sessionFilePath: '/tmp/s.jsonl', projectId: 'p1' }),
      },
    };
    vi.doMock('../../messages/read-tool-result-from-jsonl.js', () => ({
      readToolResultFromJsonl: async () => 'THE FULL OUTPUT',
    }));
    const res = await request(app(ctx)).get('/api/chats/c1/tool-result/tu_9');
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('THE FULL OUTPUT');
  });

  it('404 when content cannot be located', async () => {
    const ctx = { chats: { getChat: () => ({ id: 'c1', sessionFilePath: '/tmp/s.jsonl' }) } };
    vi.doMock('../../messages/read-tool-result-from-jsonl.js', () => ({
      readToolResultFromJsonl: async () => null,
    }));
    const res = await request(app(ctx)).get('/api/chats/c1/tool-result/tu_x');
    expect(res.status).toBe(404);
  });

  it('400 on a malformed tool use id', async () => {
    const ctx = { chats: { getChat: () => ({ id: 'c1', sessionFilePath: '/tmp/s.jsonl' }) } };
    const res = await request(app(ctx)).get('/api/chats/c1/tool-result/bad%20id');
    expect(res.status).toBe(400);
  });
});
```

> Match the real route-registration export name and `ctx` shape used by sibling tests in `packages/core/src/__tests__/routes/chats.test.ts`. Mirror their app/bootstrap helper rather than the sketch above if it differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- tool-result`
Expected: FAIL — route returns 404 for all (not registered).

- [ ] **Step 3: Implement the route**

In `chats.ts`, near the messages route:

```ts
import { z } from 'zod';
import { readToolResultFromJsonl } from '../../messages/read-tool-result-from-jsonl.js';
import { computeSessionFilePath } from '../../chat/event-handler.js';

const ToolResultParams = z.object({
  id: z.string().min(1),
  toolUseId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
});

router.get('/api/chats/:id/tool-result/:toolUseId', asyncHandler(async (req, res) => {
  const parsed = ToolResultParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }
  const chat = ctx.chats.getChat(parsed.data.id);
  if (!chat) {
    res.status(404).json({ success: false, error: 'Chat not found' });
    return;
  }
  let filePath = chat.sessionFilePath;
  if (!filePath && chat.claudeSessionId) {
    const projectPath = ctx.chats.getChatProjectPath?.(chat.id) ?? undefined;
    const cwd = chat.worktreePath ?? projectPath;
    if (cwd) {
      filePath = computeSessionFilePath(cwd, chat.claudeSessionId);
      ctx.chats.updateChat?.(chat.id, { sessionFilePath: filePath });
    }
  }
  if (!filePath) {
    res.status(404).json({ success: false, error: 'No session file for chat' });
    return;
  }
  const content = await readToolResultFromJsonl(filePath, parsed.data.toolUseId);
  if (content === null) {
    res.status(404).json({ success: false, error: 'Tool result not available' });
    return;
  }
  res.json({ success: true, data: { content } });
}));
```

> Use the real chat/project accessors this route file already uses elsewhere (grep the file for how other routes resolve a project path from a chat, e.g. `ctx.chats.getChat` + a projects lookup). Replace the optional-chained placeholders (`getChatProjectPath?`, `updateChat?`) with the genuine methods. Reuse the file's existing `asyncHandler`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- tool-result`
Expected: PASS (3 tests).

- [ ] **Step 5: Build core**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/server/routes/chats.ts packages/core/src/__tests__/routes/tool-result.test.ts
git commit -m "feat(core): GET /api/chats/:id/tool-result/:toolUseId expand endpoint"
```

---

## Task 8: Renderer API wrapper

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/projects-api.ts` (alongside `getChatMessages`, ~line 85-90)
- Test: `packages/desktop/src/renderer/lib/api/__tests__/get-tool-result-content.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getToolResultContent } from '../projects-api.js';

afterEach(() => vi.restoreAllMocks());

describe('getToolResultContent', () => {
  it('GETs the expand endpoint and returns content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { content: 'FULL' } }),
    })) as never);
    expect(await getToolResultContent('c1', 'tu_1')).toBe('FULL');
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never);
    await expect(getToolResultContent('c1', 'tu_x')).rejects.toThrow();
  });
});
```

> Mirror the fetch/error pattern of the existing `getChatMessages` in the same file (base URL helper, error shape). Adjust assertions if the file wraps responses differently.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- get-tool-result-content`
Expected: FAIL — `getToolResultContent` not exported.

- [ ] **Step 3: Implement**

```ts
export async function getToolResultContent(chatId: string, toolUseId: string): Promise<string> {
  const res = await fetch(`${apiBase()}/api/chats/${chatId}/tool-result/${toolUseId}`);
  if (!res.ok) throw new Error(`tool-result ${res.status}`);
  const body = await res.json();
  return body.data.content as string;
}
```

> Use the file's existing base-URL helper (whatever `getChatMessages` calls — `apiBase()`, a constant, etc.). Do not hardcode a port.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- get-tool-result-content`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/projects-api.ts packages/desktop/src/renderer/lib/api/__tests__/get-tool-result-content.test.ts
git commit -m "feat(desktop): getToolResultContent api wrapper"
```

---

## Task 9: Expand/collapse control + wire into tool-result cards

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/ToolResultExpand.tsx`
- Modify: `WriteFileCard.tsx`, `EditFileCard.tsx`, and the generic tool-result text renderer in the same directory (whichever component renders `result.content` as `<pre>` text)
- Test: `packages/desktop/src/renderer/components/chat/assistant-ui/__tests__/tool-result-expand.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToolResultExpand } from '../ToolResultExpand.js';

afterEach(() => vi.restoreAllMocks());

describe('ToolResultExpand', () => {
  it('shows truncated text + size button, fetches full on click, collapses back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ success: true, data: { content: 'THE WHOLE THING' } }),
    })) as never);

    render(
      <ToolResultExpand
        chatId="c1"
        toolUseId="tu_1"
        truncatedContent="head…[truncated]"
        fullBytes={1234567}
      />,
    );

    expect(screen.getByText(/head…\[truncated\]/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
    await waitFor(() => expect(screen.getByText('THE WHOLE THING')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(screen.getByText(/head…\[truncated\]/)).toBeTruthy();
    expect(screen.queryByText('THE WHOLE THING')).toBeNull();
  });

  it('shows an unavailable state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never);
    render(
      <ToolResultExpand chatId="c1" toolUseId="tu_x" truncatedContent="t…[truncated]" fullBytes={9000} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
    await waitFor(() =>
      expect(screen.getByText(/full output no longer available/i)).toBeTruthy(),
    );
    expect(screen.getByText(/t…\[truncated\]/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- tool-result-expand`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component**

```tsx
import { useState } from 'react';
import { getToolResultContent } from '../../../lib/api/projects-api';

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function ToolResultExpand({
  chatId,
  toolUseId,
  truncatedContent,
  fullBytes,
}: {
  chatId: string;
  toolUseId: string;
  truncatedContent: string;
  fullBytes: number;
}) {
  const [full, setFull] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const expand = async () => {
    setState('loading');
    try {
      setFull(await getToolResultContent(chatId, toolUseId));
      setState('idle');
    } catch (err) {
      console.warn('[tool-result-expand] fetch failed', err);
      setState('error');
    }
  };

  if (full !== null) {
    return (
      <div>
        <pre className="whitespace-pre-wrap break-words">{full}</pre>
        <button
          type="button"
          className="text-mf-small text-mf-text-secondary hover:text-mf-text-primary"
          onClick={() => setFull(null)}
        >
          Collapse
        </button>
      </div>
    );
  }

  return (
    <div>
      <pre className="whitespace-pre-wrap break-words">{truncatedContent}</pre>
      {state === 'error' ? (
        <span className="text-mf-small text-mf-text-secondary opacity-70">
          full output no longer available
        </span>
      ) : (
        <button
          type="button"
          disabled={state === 'loading'}
          className="text-mf-small text-mf-text-secondary hover:text-mf-text-primary"
          onClick={expand}
        >
          {state === 'loading' ? 'Loading…' : `Show full output · ${fmtBytes(fullBytes)}`}
        </button>
      )}
    </div>
  );
}
```

> Use real `mf-*` tokens from `packages/desktop/src/renderer/index.css`. Note the memory rule: never use `/opacity` modifiers on `mf-*` color tokens — use the `opacity-*` utility (already done above). Match sibling cards' class conventions if they differ.

- [ ] **Step 4: Run component test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- tool-result-expand`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into the cards**

In the generic tool-result text renderer and `WriteFileCard.tsx` / `EditFileCard.tsx`, where `result.content` is currently rendered as `<pre>` for the non-diff/error text path, branch on `result.truncated`:

```tsx
{result.truncated ? (
  <ToolResultExpand
    chatId={chatId}
    toolUseId={toolCallId}
    truncatedContent={result.content}
    fullBytes={result.fullBytes ?? 0}
  />
) : (
  <pre className="whitespace-pre-wrap break-words">{result.content}</pre>
)}
```

> `toolCallId` is the enclosing `tool_call` DisplayContent's `id` (the Claude `tool_use` id) — it is already in scope in these card components (they receive the tool_call). `chatId` is available via the card's props or the existing chat context hook used elsewhere in the file. Do not add new content to the zustand store — `ToolResultExpand` holds the full string in local state only; this is the memory invariant.

- [ ] **Step 6: Memory-invariant test**

Add to the test file:

```tsx
import { useChatsStore } from '../../../../store/chats.js';

it('expanding does not write full content back into the chats store', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ success: true, data: { content: 'X'.repeat(500000) } }),
  })) as never);
  const before = JSON.stringify(useChatsStore.getState().messages.get('c1') ?? []);
  render(
    <ToolResultExpand chatId="c1" toolUseId="tu_1" truncatedContent="t…[truncated]" fullBytes={500000} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
  await waitFor(() => expect(screen.getByText(/X{100,}/)).toBeTruthy());
  const after = JSON.stringify(useChatsStore.getState().messages.get('c1') ?? []);
  expect(after).toBe(before);
});
```

- [ ] **Step 7: Run all renderer tests for this feature**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- tool-result-expand`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck**

Run: `npx tsc -p packages/desktop/tsconfig.web.json --noEmit`
Expected: no new errors in touched renderer files (pre-existing errors in unrelated files/tests are not in scope).

- [ ] **Step 9: Changeset + commit**

```bash
pnpm changeset   # minor: @qlan-ro/mainframe-core, @qlan-ro/mainframe-desktop; patch: @qlan-ro/mainframe-types
git add packages/desktop/src/renderer/components/chat/assistant-ui/ToolResultExpand.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/WriteFileCard.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/EditFileCard.tsx \
        packages/desktop/src/renderer/components/chat/assistant-ui/__tests__/tool-result-expand.test.tsx \
        .changeset
git commit -m "feat(desktop): expand/collapse for truncated tool results"
```

---

## Final Verification

- [ ] `pnpm --filter @qlan-ro/mainframe-types build` — clean
- [ ] `pnpm --filter @qlan-ro/mainframe-core build` — clean
- [ ] `pnpm --filter @qlan-ro/mainframe-core test` — full suite green (truncation, jsonl, route, migration, regression)
- [ ] `pnpm --filter @qlan-ro/mainframe-desktop test` — full suite green
- [ ] `npx tsc -p packages/desktop/tsconfig.web.json --noEmit` — no new errors in touched files
- [ ] Manual: a chat with a >32 KB Read result shows the truncated body + "Show full output · N KB"; clicking loads the full content; collapse restores; a Bash result containing a PR URL beyond 32 KB still appears in PR tracking (proves ingestion unaffected)

---

## Self-Review Notes

- **Spec coverage:** truncation/threshold/head-tail (Task 2-3), type fields (Task 1), session_file_path persisted at spawn with legacy fallback+backfill (Task 4-5, 7), expand endpoint + JSONL primitive (Task 6-7), renderer memory invariant (Task 9), regression that ingestion parsers see full content (Task 3 Step 5). The `originalFile`/`modifiedFile` limitation is intentionally out of scope per spec.
- **Placeholders:** none — all code shown. Where exact upstream identifiers vary (route ctx shape, db accessor names, api base helper), the plan instructs the implementer to mirror the named sibling rather than leaving work unspecified.
- **Type consistency:** `truncateToolContent` → `{ content, truncated, fullBytes }` used identically in Tasks 2/3; `ToolCallResult.truncated/fullBytes` (Task 1) consumed in Tasks 3/9; `readToolResultFromJsonl(filePath, toolUseId)` signature consistent across Tasks 6/7; `computeSessionFilePath(cwd, sessionId)` consistent across Tasks 5/7; `getToolResultContent(chatId, toolUseId)` consistent across Tasks 8/9.
