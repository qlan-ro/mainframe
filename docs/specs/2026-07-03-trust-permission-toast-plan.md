# Trust-workspace Permission Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify the Claude CLI "workspace not trusted" stderr advisory as a non-fatal, actionable permission toast (with a one-click Trust action) instead of a false "Agent run failed" error.

**Architecture:** The daemon's `handleStderr` recognizes the advisory and emits a dedicated non-error `chat.trustRequired` event (carrying `projectPath`) via a new optional `SessionSink.onTrustRequired`, so run state is never marked failed. A chatId-keyed route writes `hasTrustDialogAccepted` into `~/.claude.json`. The UI adds a `permission` toast variant whose Trust button calls that route, and the toast's description reuses a newly-extracted shared `ReadMore` primitive.

**Tech Stack:** TypeScript (strict, NodeNext), Node.js daemon (`@qlan-ro/mainframe-core`), shared types (`@qlan-ro/mainframe-types`), React + Tailwind v4 UI (`@qlan-ro/mainframe-ui`), Vitest, sonner toasts.

## Global Constraints

- Max 300 lines/file, 50 lines/function — decompose before merging.
- No silent catches; core logs via pino `createChildLogger`. Intentional silence needs `/* expected */`.
- No sync I/O in the daemon — use `node:fs/promises`.
- Single canonical type — define once in `@qlan-ro/mainframe-types`; rebuild it with `pnpm --filter @qlan-ro/mainframe-types build` after changes.
- Daemon WS/REST contract is co-owned by mobile — changes must be **additive** (unknown types/fields ignored).
- Every interactive element needs a stable `data-testid` (`<surface>-<element>`); `ui/` primitives stay passthrough.
- Zod on new route input; WS4 envelope via `respond.ts` (`ok`/`okEmpty`/`fail`).
- New public methods/routes/core logic get tests. Per project convention, **delegate test authoring to the `test-writer` agent** where a task says so; mirror the named reference test file.
- Branch: `feat/trust-permission-toast`. Changeset required before the final commit.
- Single-test runs preferred: `pnpm --filter <pkg> exec vitest run <file>`.

---

### Task 1: Types — optional sink method + new event

**Files:**
- Modify: `packages/types/src/adapter.ts:114-143` (SessionSink interface)
- Modify: `packages/types/src/events.ts:22-23` (DaemonEvent union)

**Interfaces:**
- Produces: `SessionSink.onTrustRequired?(projectPath: string): void`; `DaemonEvent` member `{ type: 'chat.trustRequired'; chatId: string; projectPath: string }`.

- [ ] **Step 1: Add the optional sink method**

In `packages/types/src/adapter.ts`, inside `export interface SessionSink { … }`, after `onSubagentChild(...)`:

```ts
  /** Non-fatal: the CLI reported the workspace is untrusted (advisory, run continues). */
  onTrustRequired?(projectPath: string): void;
```

- [ ] **Step 2: Add the event**

In `packages/types/src/events.ts`, add a member to the `DaemonEvent` union next to the other `chat.*` members:

```ts
  | { type: 'chat.trustRequired'; chatId: string; projectPath: string }
```

- [ ] **Step 3: Rebuild types**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/adapter.ts packages/types/src/events.ts
git commit -m "feat(types): add onTrustRequired sink method + chat.trustRequired event"
```

---

### Task 2: Daemon — classify the advisory (no false error)

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/events.ts:36-41` (`handleStderr`)
- Modify: `packages/core/src/chat/event-handler.ts:540-542` (returned sink object)
- Test: `packages/core/src/__tests__/claude-events.test.ts` (existing `handleStderr` describe, ~:591)

**Interfaces:**
- Consumes: `SessionSink.onTrustRequired?` (Task 1), `ClaudeSession.projectPath` (`session.ts:115`).
- Produces: emits `chat.trustRequired` from the event-handler sink.

- [ ] **Step 1: Add failing tests for classification**

In `packages/core/src/__tests__/claude-events.test.ts`, ensure the local `createSink()` (~:10) includes `onTrustRequired: vi.fn(),`. Then in the `handleStderr` describe block add:

```ts
it('routes the untrusted-workspace advisory to onTrustRequired, not onError', () => {
  const sink = createSink();
  const session = { projectPath: '/home/me/proj' } as unknown as ClaudeSession;
  handleStderr(
    session,
    Buffer.from(
      'Ignoring 4 permissions.allow entries from .claude/settings.local.json: ' +
        'this workspace has not been trusted. Run Claude Code interactively here once...',
    ),
    sink,
  );
  expect(sink.onTrustRequired).toHaveBeenCalledWith('/home/me/proj');
  expect(sink.onError).not.toHaveBeenCalled();
});

it('still routes genuine stderr to onError', () => {
  const sink = createSink();
  const session = { projectPath: '/p' } as unknown as ClaudeSession;
  handleStderr(session, Buffer.from('TypeError: boom'), sink);
  expect(sink.onError).toHaveBeenCalledTimes(1);
  expect(sink.onTrustRequired).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/claude-events.test.ts`
Expected: FAIL (advisory currently goes to `onError`).

- [ ] **Step 3: Implement classification in `handleStderr`**

In `packages/core/src/plugins/builtin/claude/events.ts`, replace the `handleStderr` function (rename the unused `_session` param to `session`):

```ts
// The CLI prints this to stderr but keeps running — it is advisory, not fatal.
const TRUST_ADVISORY = /has not been trusted/i;

export function handleStderr(session: ClaudeSession, chunk: Buffer, sink: SessionSink): void {
  const message = chunk.toString().trim();
  if (!message) return;
  if (INFORMATIONAL_PATTERNS.some((p) => p.test(message))) return;
  if (TRUST_ADVISORY.test(message)) {
    sink.onTrustRequired?.(session.projectPath);
    return;
  }
  sink.onError(new Error(message));
}
```

- [ ] **Step 4: Emit the event from the real sink**

In `packages/core/src/chat/event-handler.ts`, in the returned sink object (next to `onError` at ~:540), add:

```ts
    onTrustRequired(projectPath: string) {
      emitEvent({ type: 'chat.trustRequired', chatId, projectPath });
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/claude-events.test.ts`
Expected: PASS.

- [ ] **Step 6: Dispatch test-writer for the event-handler emit test**

Dispatch the `test-writer` agent: "In `packages/core/src/__tests__/event-handler.test.ts`, mirror the existing `buildSink`-based tests to add one: build a sink via `handler.buildSink(chatId, …)`, call `sink.onTrustRequired!('/home/me/proj')`, and assert the harness captured a `{ type: 'chat.trustRequired', chatId, projectPath: '/home/me/proj' }` event **and** that `processState` was not changed (no `chat.updated` with a run-state flip)." Then run that file and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/events.ts packages/core/src/chat/event-handler.ts packages/core/src/__tests__/claude-events.test.ts packages/core/src/__tests__/event-handler.test.ts
git commit -m "feat(core): classify untrusted-workspace stderr as non-fatal chat.trustRequired"
```

---

### Task 3: Daemon — trust writer, ChatManager method, route

**Files:**
- Create: `packages/core/src/plugins/builtin/claude/trust-store.ts`
- Modify: `packages/core/src/chat/chat-manager.ts` (add `trustWorkspace`)
- Modify: `packages/core/src/server/routes/chat-commands.ts:69-70` (add route)
- Test: `packages/core/src/plugins/builtin/claude/__tests__/trust-store.test.ts` (create)
- Test: `packages/core/src/server/routes/__tests__/chat-commands.test.ts` (existing)

**Interfaces:**
- Produces: `writeWorkspaceTrust(projectPath: string, claudeJsonPath?: string): Promise<void>`; `ChatManager.trustWorkspace(chatId: string): Promise<void>`; route `POST /api/chats/:id/trust-workspace`.
- Consumes: `ok`/`fail` (`respond.ts`), the `command(...)` helper (`chat-commands.ts:50`).

- [ ] **Step 1: Write the failing trust-store test**

Create `packages/core/src/plugins/builtin/claude/__tests__/trust-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkspaceTrust } from '../trust-store.js';

describe('writeWorkspaceTrust', () => {
  it('creates the file and marks the project trusted when it is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    await writeWorkspaceTrust('/home/me/proj', p);
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.projects['/home/me/proj'].hasTrustDialogAccepted).toBe(true);
  });

  it('merges without clobbering existing keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    writeFileSync(p, JSON.stringify({ authSecret: 'keep', projects: { '/other': { x: 1 } } }));
    await writeWorkspaceTrust('/home/me/proj', p);
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.authSecret).toBe('keep');
    expect(cfg.projects['/other']).toEqual({ x: 1 });
    expect(cfg.projects['/home/me/proj'].hasTrustDialogAccepted).toBe(true);
  });

  it('is idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    await writeWorkspaceTrust('/home/me/proj', p);
    await writeWorkspaceTrust('/home/me/proj', p);
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.projects['/home/me/proj'].hasTrustDialogAccepted).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/trust-store.test.ts`
Expected: FAIL ("Cannot find module '../trust-store.js'").

- [ ] **Step 3: Implement the trust writer**

Create `packages/core/src/plugins/builtin/claude/trust-store.ts`:

```ts
import { readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:trust');

/**
 * Marks a project as trusted in ~/.claude.json (the CLI's per-project trust store),
 * so Claude stops ignoring the project's permissions.allow entries. Read-modify-write
 * with an atomic rename; preserves all other keys. Only a missing file is tolerated —
 * a corrupt/unreadable existing file throws rather than clobbering login/other projects.
 */
export async function writeWorkspaceTrust(
  projectPath: string,
  claudeJsonPath: string = join(homedir(), '.claude.json'),
): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(claudeJsonPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    log.info({ claudeJsonPath }, 'claude.json missing; creating on first trust');
  }
  const projects = (config.projects ?? {}) as Record<string, Record<string, unknown>>;
  projects[projectPath] = { ...(projects[projectPath] ?? {}), hasTrustDialogAccepted: true };
  config.projects = projects;

  const tmp = `${claudeJsonPath}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(config, null, 2));
  await rename(tmp, claudeJsonPath);
  log.info({ projectPath }, 'workspace trusted');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/trust-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `ChatManager.trustWorkspace`**

In `packages/core/src/chat/chat-manager.ts`, add the import at the top:

```ts
import { writeWorkspaceTrust } from '../plugins/builtin/claude/trust-store.js';
```

Add the method to the `ChatManager` class (server re-derives the path from chatId — never trusts a client-supplied path):

```ts
  /** Trust the chat's workspace in ~/.claude.json (path derived server-side from the chat). */
  async trustWorkspace(chatId: string): Promise<void> {
    const chat = this.db.chats.get(chatId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);
    const project = this.db.projects.get(chat.projectId);
    if (!project) throw new Error(`Project ${chat.projectId} not found`);
    await writeWorkspaceTrust(chat.worktreePath ?? project.path);
  }
```

- [ ] **Step 6: Add the route**

In `packages/core/src/server/routes/chat-commands.ts`, after the `resume` line (~:70):

```ts
  command('/api/chats/:id/trust-workspace', 'post', (id) => ctx.chats.trustWorkspace(id), 'trust-workspace');
```

(The `command` helper already 404s if the chat is unknown, calls `okEmpty` on success, and `fail(500)` on throw.)

- [ ] **Step 7: Dispatch test-writer for the route test**

Dispatch `test-writer`: "In `packages/core/src/server/routes/__tests__/chat-commands.test.ts`, mirror the existing `resume` case (~:127 using `handlerFor(chatCommandRoutes(ctx), 'post', '/api/chats/:id/trust-workspace')`): assert it 404s for an unknown chat id, and for a known chat calls `ctx.chats.trustWorkspace` and responds `{ success: true }`." Then run that file and confirm PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/trust-store.ts packages/core/src/plugins/builtin/claude/__tests__/trust-store.test.ts packages/core/src/chat/chat-manager.ts packages/core/src/server/routes/chat-commands.ts packages/core/src/server/routes/__tests__/chat-commands.test.ts
git commit -m "feat(core): add trust-workspace route + ~/.claude.json trust writer"
```

---

### Task 4: UI — daemon client method

**Files:**
- Modify: `packages/ui/src/lib/api/chats.ts:56-57`
- Test: `packages/ui/src/lib/api/__tests__/chats.test.ts` (create if absent; else append)

**Interfaces:**
- Produces: `trustWorkspace(port: number, chatId: string): Promise<void>`.
- Consumes: `requestEmpty`, `apiBase` (`./http`).

- [ ] **Step 1: Write the failing test**

Create/append `packages/ui/src/lib/api/__tests__/chats.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from '../http';
import { trustWorkspace } from '../chats';

describe('trustWorkspace', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('POSTs to the trust-workspace endpoint', async () => {
    const spy = vi.spyOn(http, 'requestEmpty').mockResolvedValue(undefined);
    vi.spyOn(http, 'apiBase').mockReturnValue('http://d');
    await trustWorkspace(0, 'chat-1');
    expect(spy).toHaveBeenCalledWith('POST', 'http://d/api/chats/chat-1/trust-workspace');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/api/__tests__/chats.test.ts`
Expected: FAIL (`trustWorkspace` not exported).

- [ ] **Step 3: Implement**

In `packages/ui/src/lib/api/chats.ts`, next to `resumeChat`:

```ts
export const trustWorkspace = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/trust-workspace`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/api/__tests__/chats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/api/chats.ts packages/ui/src/lib/api/__tests__/chats.test.ts
git commit -m "feat(ui): add trustWorkspace daemon client call"
```

---

### Task 5: UI — extract shared `ReadMore` primitive

**Files:**
- Create: `packages/ui/src/components/ui/read-more.tsx`
- Modify: `packages/ui/src/features/chat/messages/ReadMoreBubble.tsx`
- Test: `packages/ui/src/components/ui/__tests__/read-more.test.tsx` (create)

**Interfaces:**
- Produces: `ReadMore` with props `{ children: ReactNode; measureText: string; threshold?: number; clampLines?: number; fadeColor?: string; fadeOffsetClass?: string; contentClassName?: string; className?: string; testId: string }`.
- Constraint: `ReadMore` is a `ui/` primitive — it must NOT import from `features/`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/components/ui/__tests__/read-more.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadMore } from '../read-more';

const long = 'x'.repeat(700);

describe('ReadMore', () => {
  it('shows no toggle when under threshold', () => {
    render(<ReadMore measureText="short" testId="t-toggle">short</ReadMore>);
    expect(screen.queryByTestId('t-toggle')).toBeNull();
  });

  it('toggles Read more / Show less past threshold', () => {
    render(<ReadMore measureText={long} testId="t-toggle">{long}</ReadMore>);
    const btn = screen.getByTestId('t-toggle');
    expect(btn).toHaveTextContent('Read more');
    fireEvent.click(btn);
    expect(btn).toHaveTextContent('Show less');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/read-more.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the primitive**

Create `packages/ui/src/components/ui/read-more.tsx`:

```tsx
import { useState, type ReactNode, type CSSProperties } from 'react';
import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReadMoreProps {
  children: ReactNode;
  /** Plain-text length source for the clamp heuristic (jsdom has no layout engine). */
  measureText: string;
  threshold?: number;
  clampLines?: number;
  /** CSS color for the fade end-stop; omit for no fade. */
  fadeColor?: string;
  fadeOffsetClass?: string;
  contentClassName?: string;
  className?: string;
  testId: string;
}

export function ReadMore({
  children,
  measureText,
  threshold = 600,
  clampLines = 4,
  fadeColor,
  fadeOffsetClass = 'bottom-6',
  contentClassName,
  className,
  testId,
}: ReadMoreProps) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = measureText.length > threshold;
  const collapsed = needsToggle && !expanded;

  const clampStyle: CSSProperties | undefined = collapsed
    ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: clampLines, overflow: 'hidden' }
    : undefined;

  return (
    <div className={cn('relative flex flex-col gap-[5px]', className)}>
      <div data-clamp={needsToggle ? '' : undefined} className={contentClassName} style={clampStyle}>
        {children}
      </div>

      {collapsed && fadeColor && (
        <div
          aria-hidden
          className={cn('pointer-events-none absolute left-0 right-0 h-8', fadeOffsetClass)}
          style={{ background: `linear-gradient(to bottom, transparent, ${fadeColor})` }}
        />
      )}

      {needsToggle && (
        <button
          data-testid={testId}
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="inline-flex items-center gap-2 text-caption font-semibold text-primary hover:underline"
          aria-label={expanded ? 'Show less' : 'Read more'}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read more'}
          {expanded ? (
            <ChevronsUpDown size={10} className="text-primary" />
          ) : (
            <ChevronDown size={10} className="text-primary" />
          )}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/read-more.test.tsx`
Expected: PASS.

- [ ] **Step 5: Refactor `ReadMoreBubble` onto the primitive (keep visuals identical)**

Replace the body of `packages/ui/src/features/chat/messages/ReadMoreBubble.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { ReadMore } from '@/components/ui/read-more';
import { extractText } from '../parts/extract-text';

export interface ReadMoreBubbleProps {
  children: ReactNode;
  className?: string;
}

export function ReadMoreBubble({ children, className }: ReadMoreBubbleProps) {
  return (
    <ReadMore
      measureText={extractText(children)}
      threshold={600}
      clampLines={4}
      fadeColor="var(--mf-um-fade)"
      fadeOffsetClass="bottom-6"
      contentClassName="aui-md text-body leading-loose tracking-tight"
      className={className}
      testId="chat-user-readmore-toggle"
    >
      {children}
    </ReadMore>
  );
}
```

- [ ] **Step 6: Verify the bubble's existing tests still pass**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/UserMessage.test.tsx`
Expected: PASS (toggle testid `chat-user-readmore-toggle` preserved). If no such file, run any existing `ReadMoreBubble`/`UserMessage` test found under `src/features/chat/messages/__tests__/`.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/ui/read-more.tsx packages/ui/src/components/ui/__tests__/read-more.test.tsx packages/ui/src/features/chat/messages/ReadMoreBubble.tsx
git commit -m "refactor(ui): extract shared ReadMore primitive; bubble reuses it"
```

---

### Task 6: UI — `permission` toast variant + ReadMore description

**Files:**
- Modify: `packages/ui/src/components/ui/ws-toast.tsx`
- Test: `packages/ui/src/components/ui/__tests__/ws-toast.test.tsx` (existing)

**Interfaces:**
- Produces: `ToastType` includes `'permission'`; permission toasts are persistent (no countdown rail); description renders via `ReadMore`.
- Consumes: `ReadMore` (Task 5).

- [ ] **Step 1: Dispatch test-writer for the variant tests**

Dispatch `test-writer`: "In `packages/ui/src/components/ui/__tests__/ws-toast.test.tsx`, mirror the existing error-variant test to add coverage for a new `type='permission'` `WsToastCard`: (a) it renders the status chip with a shield icon, (b) it is persistent — NO `data-testid='toast-countdown-rail'` (like error), (c) when given a long `description` it renders the `ReadMore` toggle (`data-testid='toast-readmore-toggle'`) rather than a fixed scroll box, (d) an `action` renders the `data-testid='toast-action'` button." Confirm the new tests FAIL first.

- [ ] **Step 2: Add the variant to `ws-toast.tsx`**

In `packages/ui/src/components/ui/ws-toast.tsx`:

- Import shield + ReadMore:
```ts
import { Check, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { ReadMore } from './read-more';
```
- Extend the type (`:18`):
```ts
export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'permission';
```
- Add the chip config entry (`CHIP_CONFIG`, `:40-45`):
```ts
  permission: { bg: 'bg-mf-warning-tint', ink: 'text-mf-warning' },
```
- In `ChipIcon` (`:71-76`), before the trailing return:
```ts
  if (type === 'permission') return <ShieldAlert size={14} aria-hidden />;
```
- Make permission persistent (`:84`):
```ts
  const isAuto = type !== 'error' && type !== 'permission';
```

- [ ] **Step 3: Swap the description box for `ReadMore`**

Replace the description block (`:141-145`) with:

```tsx
        {description && (
          <ReadMore
            measureText={description}
            threshold={160}
            clampLines={3}
            contentClassName="text-label text-muted-foreground mt-[3px] leading-normal [overflow-wrap:anywhere]"
            testId="toast-readmore-toggle"
          >
            {description}
          </ReadMore>
        )}
```

- [ ] **Step 4: Run the toast tests**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/ws-toast.test.tsx`
Expected: PASS (existing variants unchanged; new permission cases pass).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ui/ws-toast.tsx packages/ui/src/components/ui/__tests__/ws-toast.test.tsx
git commit -m "feat(ui): add persistent permission toast variant with ReadMore description"
```

---

### Task 7: UI — `mfToast.permission` helper

**Files:**
- Modify: `packages/ui/src/lib/toast.ts`
- Test: `packages/ui/src/lib/__tests__/toast.test.ts` (create if absent; else append)

**Interfaces:**
- Produces: `mfToast.permission(title: string, opts?: MfToastOptions): void`; permission toasts use `duration: Infinity`.

- [ ] **Step 1: Write the failing test**

Create/append `packages/ui/src/lib/__tests__/toast.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { mfToast } from '../toast';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { custom: vi.fn(), dismiss: vi.fn() }) }));

describe('mfToast.permission', () => {
  beforeEach(() => vi.clearAllMocks());
  it('renders a persistent (Infinity) permission toast', () => {
    mfToast.permission('Workspace not trusted', { description: 'why' });
    const opts = (toast.custom as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.duration).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/toast.test.ts`
Expected: FAIL (`permission` not a function).

- [ ] **Step 3: Implement**

In `packages/ui/src/lib/toast.ts`:

- Update `duration` in `fire` (`:33`):
```ts
  const duration = type === 'error' || type === 'permission' ? Infinity : AUTO_DISMISS_MS;
```
- Add the helper (next to `info`, `:63-65`):
```ts
function permission(title: string, opts?: MfToastOptions) {
  fire({ type: 'permission', title, ...opts });
}
```
- Include it in the export (`:67`):
```ts
export const mfToast = Object.assign(fire, { success, error, warning, info, permission });
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/toast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/toast.ts packages/ui/src/lib/__tests__/toast.test.ts
git commit -m "feat(ui): add mfToast.permission helper"
```

---

### Task 8: UI — route `chat.trustRequired` to the permission toast

**Files:**
- Modify: `packages/ui/src/features/chat/controller/chat-event-router.ts:28-56`
- Test: mirror `packages/ui/src/features/chat/controller/__tests__/chat-thread-controller-cancel-failed.test.ts`

**Interfaces:**
- Consumes: `mfToast.permission` (Task 7), `trustWorkspace` (Task 4), the `chat.trustRequired` event (Task 1).

- [ ] **Step 1: Add the router branch**

In `packages/ui/src/features/chat/controller/chat-event-router.ts`, add the import:

```ts
import { trustWorkspace } from '@/lib/api/chats';
```

Insert this block in `routeDaemonEvent`, before the `error` handling (~:50), and return early (side-effect only; `chat.trustRequired` already hits `default → noop` in `handleDaemonEvent`):

```ts
  // Non-fatal: the CLI reported the workspace is untrusted. Surface an actionable
  // permission toast (NOT a run failure) whose Trust action fixes it server-side.
  if (event.type === 'chat.trustRequired' && event.chatId === chatId) {
    mfToast.permission('Workspace not trusted', {
      description:
        `Claude ignored the permission rules in ${event.projectPath} because the workspace ` +
        `isn't trusted yet. Trust it to apply them and silence this notice.`,
      action: { label: 'Trust', onClick: () => void trustWorkspace(0, chatId) },
    });
    return;
  }
```

- [ ] **Step 2: Dispatch test-writer for the router test**

Dispatch `test-writer`: "Mirror `packages/ui/src/features/chat/controller/__tests__/chat-thread-controller-cancel-failed.test.ts` to add a test that feeds a `{ type: 'chat.trustRequired', chatId, projectPath: '/p' }` event through `routeDaemonEvent`/the controller and asserts `mfToast.permission` was called (spy on `@/lib/toast`) and `mfToast.error` was NOT, and that no `run.failed` state event was dispatched. Also assert clicking the toast action invokes `trustWorkspace` (spy on `@/lib/api/chats`)." Confirm it FAILS first, then PASSES after Step 1.

- [ ] **Step 3: Typecheck the UI**

Run: `pnpm --filter @qlan-ro/mainframe-ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/features/chat/controller/chat-event-router.ts packages/ui/src/features/chat/controller/__tests__/
git commit -m "feat(ui): route chat.trustRequired to a permission toast with Trust action"
```

---

### Task 9: Typecheck, changeset, final gate

**Files:**
- Create: `.changeset/<name>.md`

- [ ] **Step 1: Core typecheck (includes tests)**

Run: `pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: UI typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-ui typecheck`
Expected: no errors.

- [ ] **Step 3: Run the feature's test files together**

Run each single-file (avoid the big-batch React.act failure):
```bash
pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/claude-events.test.ts src/plugins/builtin/claude/__tests__/trust-store.test.ts src/server/routes/__tests__/chat-commands.test.ts src/__tests__/event-handler.test.ts
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/read-more.test.tsx
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/ws-toast.test.tsx
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/toast.test.ts src/lib/api/__tests__/chats.test.ts
```
Expected: all PASS.

- [ ] **Step 4: Add the changeset**

Run: `pnpm changeset` → select `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-ui` → **patch** → summary: "Show the Claude 'workspace not trusted' advisory as an actionable permission toast with a one-click Trust action, instead of a false 'Agent run failed' error."

- [ ] **Step 5: Commit**

```bash
git add .changeset/
git commit -m "chore: changeset for trust-workspace permission toast"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** A → Tasks 1–2; B → Task 3; C → Tasks 6–8 (+4, +7); D → Task 5. All four spec parts mapped.
- **`SessionSink.onTrustRequired` is optional** (spec said add to sink) — deliberate refinement: 12+ implementers/mocks would otherwise need mechanical edits; optional + `?.` call keeps the diff to the one real implementer.
- **`resolveAndValidatePath` dropped** vs the spec: it contains a *user-supplied* subpath under a base; here the path is server-derived from the chat (DB), so the security property (chatId-keyed, server-derived) is met without it. The writer instead tolerates only ENOENT and never clobbers an existing file.
- **Type consistency:** `chat.trustRequired { chatId, projectPath }`, `onTrustRequired(projectPath)`, `trustWorkspace(port, chatId)`, `writeWorkspaceTrust(projectPath, claudeJsonPath?)`, toast testids `toast-readmore-toggle` / `toast-action`, bubble testid `chat-user-readmore-toggle` — consistent across tasks.
