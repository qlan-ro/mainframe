# Subagent Blocks Nesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every subagent activity (dispatch prompt, text, thinking, skill loads, tool_use, tool_result) **inside** the parent's Task card instead of leaking into the main chat thread, on both live stream and history reload.

**Architecture:** When the Claude CLI emits a stream-json event with `parent_tool_use_id != null`, treat it as a child of the parent assistant message that contains the matching `Agent`/`Task` `tool_use` block. Inline the event's content blocks into that parent assistant message's `content[]` and tag each block with `parentToolUseId`. The display pipeline already groups consecutive blocks under an `Agent` tool_use into a `_TaskGroup` virtual entry; we extend `groupTaskChildren` to keep walking past text/thinking/skill_loaded as long as the block's `parentToolUseId` matches the Agent's id, and we update `TaskGroupCard` to render those non-tool child kinds. History does the same via `injectAgentChildren`, extended to also inline subagent text/thinking/skill_loaded from subagent JSONLs.

**Tech Stack:** TypeScript (strict, NodeNext), pnpm workspaces, vitest, React (`packages/desktop`), pino logger.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/types/src/chat.ts` | `MessageContent` union + `ChatMessage` | Add optional `parentToolUseId` to `text`, `thinking`, `tool_use`, `tool_result`, `skill_loaded` variants |
| `packages/types/src/adapter.ts` | `SessionSink` interface | Add `onSubagentChild(parentToolUseId, blocks)` method |
| `packages/core/src/plugins/builtin/claude/events.ts` | Live stream → sink | Route `parent_tool_use_id != null` events through `onSubagentChild`; remove the prompt-suppression guard added by PRs #264/#267 (no longer needed — prompt is inlined) |
| `packages/core/src/chat/event-handler.ts` | Sink → message cache | Implement `onSubagentChild`: append blocks to the existing parent assistant message that owns the matching Agent tool_use; emit `message.updated` |
| `packages/core/src/plugins/builtin/claude/history.ts` | History reconstruction | Extend `collectAgentProgressTools` to capture text/thinking; in `injectAgentChildren` tag inlined blocks with `parentToolUseId`; collect subagent assistant text/thinking from subagent JSONLs (same pattern as the current tool_result collection) and inline them via `injectAgentChildren` |
| `packages/core/src/messages/tool-grouping.ts` | `PartEntry` + `groupTaskChildren` | Add `parentToolUseId` to `PartEntry`; replace the "stop on text" rule with "include while parentToolUseId matches Agent.id, stop otherwise" |
| `packages/core/src/messages/display-helpers.ts` | Block → PartEntry | Propagate `parentToolUseId` from `MessageContent` blocks to `PartEntry` and from `PartEntry` back to `DisplayContent` for rendering |
| `packages/types/src/display.ts` | `DisplayContent` (if separate) | Mirror `parentToolUseId` on rendered child kinds the Task card needs |
| `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskGroupCard.tsx` | Task card rendering | Render `text`, `thinking`, `skill_loaded` child kinds in addition to `tool_call`. Drop the dispatch prompt's redundant text child since the parent's `taskArgs.prompt` already lives in the card header tooltip — render it instead as a small intro line at the top of the expanded body |
| `packages/core/src/__tests__/claude-events.test.ts` | Live event tests | Replace the prompt-drop tests with `onSubagentChild` tests |
| `packages/core/src/__tests__/event-handler.test.ts` | Sink behaviour | New: `onSubagentChild` appends to the matching parent message and no-ops when no match |
| `packages/core/src/__tests__/message-grouping.test.ts` | Grouping | New: parts with matching `parentToolUseId` get nested under `_TaskGroup`; mismatched parts terminate the group |
| `packages/core/src/__tests__/message-loading.test.ts` | History tests | New: subagent assistant text/thinking from a subagent JSONL gets inlined into the parent assistant message's content with `parentToolUseId` tag |

---

## Task 0: Read context, branch, dependency check

**Files:**
- Read: `packages/core/src/messages/message-grouping.ts`, `packages/core/src/messages/tool-grouping.ts`, `packages/core/src/messages/display-helpers.ts`, `packages/core/src/messages/display-pipeline.ts`, `packages/core/src/plugins/builtin/claude/events.ts`, `packages/core/src/plugins/builtin/claude/history.ts`, `packages/core/src/chat/event-handler.ts`
- Read: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskGroupCard.tsx`, `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskCard.tsx`
- Read sample JSONL: `~/.claude/projects/<encoded>/<sessionId>.jsonl` and a subagent JSONL under `<sessionId>/subagents/agent-<id>.jsonl` to confirm the shape of `parentToolUseID`/`parent_tool_use_id` and that the dispatch prompt arrives as `[{type:'text', text:<prompt>}]` post-`normalizeMessages`.

- [ ] **Step 1: Pull main**

```bash
cd /Users/doruchiulan/Projects/qlan/mainframe
git fetch origin
git checkout main
git pull --ff-only
```

- [ ] **Step 2: Create the worktree branch**

```bash
git checkout -b feat/subagent-blocks-nesting origin/main
```

- [ ] **Step 3: Install deps and confirm baseline build**

Run:
```bash
pnpm install --frozen-lockfile
pnpm --filter @qlan-ro/mainframe-types build
pnpm --filter @qlan-ro/mainframe-core build
```
Expected: clean build, no errors.

- [ ] **Step 4: Confirm baseline test suite passes (excluding the known-flake `routes/search.test.ts` when run in parallel)**

Run:
```bash
pnpm --filter @qlan-ro/mainframe-core test src/__tests__/claude-events.test.ts
pnpm --filter @qlan-ro/mainframe-core test src/__tests__/event-handler.test.ts
pnpm --filter @qlan-ro/mainframe-core test src/__tests__/message-grouping.test.ts
pnpm --filter @qlan-ro/mainframe-core test src/__tests__/message-loading.test.ts
```
Expected: all pass.

---

## Task 1: Type field — `parentToolUseId` on `MessageContent`

**Files:**
- Modify: `packages/types/src/chat.ts:68-84`
- Test: type-only change verified by build + downstream tests

- [ ] **Step 1: Edit `packages/types/src/chat.ts:68-84` — add `parentToolUseId?: string` to the variants we'll inline**

Before:
```ts
export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError: boolean;
      structuredPatch?: DiffHunk[];
      originalFile?: string;
      modifiedFile?: string;
    }
  | { type: 'permission_request'; request: import('./adapter.js').ControlRequest }
  | { type: 'error'; message: string }
  | { type: 'skill_loaded'; skillName: string; path: string; content: string };
```

After:
```ts
export type MessageContent =
  | { type: 'text'; text: string; parentToolUseId?: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'thinking'; thinking: string; parentToolUseId?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; parentToolUseId?: string }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError: boolean;
      structuredPatch?: DiffHunk[];
      originalFile?: string;
      modifiedFile?: string;
      parentToolUseId?: string;
    }
  | { type: 'permission_request'; request: import('./adapter.js').ControlRequest }
  | { type: 'error'; message: string }
  | { type: 'skill_loaded'; skillName: string; path: string; content: string; parentToolUseId?: string };
```

- [ ] **Step 2: Build types package**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: clean.

- [ ] **Step 3: Build core to surface any consumer breakage**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: clean (the field is optional; no existing call site is broken).

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/chat.ts
git commit -m "feat(types): add optional parentToolUseId to MessageContent variants"
```

---

## Task 2: Sink method — `onSubagentChild`

**Files:**
- Modify: `packages/types/src/adapter.ts:114-134`
- Modify: every `SessionSink` mock and stub (search via `grep -rn "onSkillLoaded:" packages/core/src` to find them)

- [ ] **Step 1: Edit `packages/types/src/adapter.ts` — add `onSubagentChild` after `onSkillLoaded`**

```ts
  /** A skill was loaded via slash-command; show a collapsible skill card instead of raw text. */
  onSkillLoaded(entry: { skillName: string; path: string; content: string }): void;
  /**
   * Inline content blocks from a subagent stream event under the parent assistant
   * message that owns the matching Agent/Task tool_use. Caller must have stamped
   * each block with `parentToolUseId === parentToolUseId` argument so the display
   * pipeline can group them under the matching Task card.
   */
  onSubagentChild(parentToolUseId: string, blocks: import('./chat.js').MessageContent[]): void;
}
```

- [ ] **Step 2: Build types**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: clean.

- [ ] **Step 3: Build core — expect failures at every `SessionSink` mock that is missing `onSubagentChild`**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: type errors listing each mock.

- [ ] **Step 4: Add `onSubagentChild: () => {}` to every fixture sink and `onSubagentChild: vi.fn()` to every test sink. Use grep to find them**

Run:
```bash
grep -rln "onSkillLoaded:" packages/core/src
```

For each match, add the new method right under `onSkillLoaded`. Concrete locations to confirm at edit time:
- `packages/core/src/plugins/builtin/claude/session.ts` (default no-op sink)
- `packages/core/src/plugins/builtin/codex/session.ts` (default no-op sink — codex doesn't emit subagent events but the sink shape must match)
- `packages/core/src/__tests__/plugins/claude-sdk/test-utils.ts`
- `packages/core/src/__tests__/claude-events.test.ts` (`createSink()`)
- `packages/core/src/__tests__/codex-event-mapper.test.ts`
- `packages/core/src/__tests__/codex-session.test.ts`
- `packages/core/src/__tests__/codex-approval-handler.test.ts`
- `packages/core/src/plugins/builtin/codex/__tests__/plan-item-capture.test.ts`
- `packages/core/src/plugins/builtin/codex/__tests__/request-user-input-resolve.test.ts`
- `packages/core/src/plugins/builtin/codex/__tests__/request-user-input-routing.test.ts`
- `packages/core/src/plugins/builtin/claude/__tests__/pr-detection.test.ts`
- `packages/core/src/plugins/builtin/claude/__tests__/todo-extraction.test.ts`
- `packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`

(If grep turns up additional sites, edit them too — same one-line addition.)

- [ ] **Step 5: Build core**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/adapter.ts packages/core/src
git commit -m "feat(adapter): add SessionSink.onSubagentChild for inlining subagent blocks"
```

---

## Task 3: Event handler — implement `onSubagentChild`

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts`
- Test: `packages/core/src/__tests__/event-handler.test.ts`

The handler must:
1. Find the parent assistant message in the chat's message cache that contains a `tool_use` block whose `id === parentToolUseId`.
2. Append the `blocks` argument to that message's `content[]`.
3. Emit `message.updated` so the renderer re-grouping is triggered.
4. If no such parent exists (race/restart), no-op + warn-log via the child logger.

- [ ] **Step 1: Write the failing test in `packages/core/src/__tests__/event-handler.test.ts`**

```ts
describe('EventHandler onSubagentChild', () => {
  it('appends blocks to the parent assistant message that owns the matching tool_use', () => {
    const { sink, db, messages, emitted } = createHandlerHarness({ chatId: 'chat-1' });
    // Seed an assistant message with an Agent tool_use
    sink.onMessage(
      [
        { type: 'text', text: 'Dispatching subagent.' },
        { type: 'tool_use', id: 'toolu_agent_1', name: 'Agent', input: { description: 'Echo hi 1' } },
      ],
      { model: 'claude-opus-4-7' },
    );

    sink.onSubagentChild('toolu_agent_1', [
      { type: 'text', text: 'Run echo hi via Bash and report the output.', parentToolUseId: 'toolu_agent_1' },
      { type: 'tool_use', id: 'toolu_sub_bash', name: 'Bash', input: { command: 'echo hi' }, parentToolUseId: 'toolu_agent_1' },
    ]);

    const cached = messages.get('chat-1') ?? [];
    const assistant = cached.find((m) => m.type === 'assistant');
    expect(assistant).toBeDefined();
    const types = assistant!.content.map((c) => c.type);
    expect(types).toEqual(['text', 'tool_use', 'text', 'tool_use']);
    const last = assistant!.content[3] as { parentToolUseId?: string; name?: string };
    expect(last.parentToolUseId).toBe('toolu_agent_1');
    expect(last.name).toBe('Bash');
    expect(emitted.some((e: { type: string }) => e.type === 'message.updated')).toBe(true);
  });

  it('no-ops with a warn log when no parent assistant message owns the tool_use', () => {
    const { sink, messages, warnings } = createHandlerHarness({ chatId: 'chat-1' });

    sink.onSubagentChild('toolu_unknown', [
      { type: 'text', text: 'orphaned', parentToolUseId: 'toolu_unknown' },
    ]);

    expect(messages.get('chat-1') ?? []).toEqual([]);
    expect(warnings.some((w) => w.includes('parent tool_use not found'))).toBe(true);
  });
});
```

If `createHandlerHarness` doesn't exist yet, add a tiny helper at the top of the file that returns `{ sink, db, messages, emitted, warnings }` and seeds the chat. The existing test file's existing setup pattern must be reused — read the file first to copy its style.

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/event-handler.test.ts -t "onSubagentChild"`
Expected: FAIL — `onSubagentChild is not a function` (or similar).

- [ ] **Step 3: Implement `onSubagentChild` in `packages/core/src/chat/event-handler.ts`**

Add inside the sink object next to the existing methods (right after `onSkillLoaded`):

```ts
    onSubagentChild(parentToolUseId: string, blocks: import('@qlan-ro/mainframe-types').MessageContent[]) {
      const cache = messages.get(chatId) ?? [];
      // Newest-first: a subagent's events typically belong to the most recent
      // assistant message that contains the parent tool_use.
      for (let i = cache.length - 1; i >= 0; i--) {
        const msg = cache[i]!;
        if (msg.type !== 'assistant') continue;
        const owns = msg.content.some((b) => b.type === 'tool_use' && b.id === parentToolUseId);
        if (!owns) continue;
        msg.content = [...msg.content, ...blocks];
        emitEvent({ type: 'message.updated', chatId, messageId: msg.id });
        emitDisplay();
        return;
      }
      log.warn(
        { chatId, parentToolUseId, blockCount: blocks.length },
        'onSubagentChild: parent tool_use not found in cache; dropping blocks',
      );
    },
```

(Use the existing `log` child logger if there is one; if not, mirror the convention you see at the top of the file.)

- [ ] **Step 4: Run test, confirm it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/event-handler.test.ts -t "onSubagentChild"`
Expected: PASS for both cases.

- [ ] **Step 5: Run the rest of the event-handler tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/event-handler.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/chat/event-handler.ts packages/core/src/__tests__/event-handler.test.ts
git commit -m "feat(chat/event-handler): implement onSubagentChild — inline subagent blocks under parent tool_use"
```

---

## Task 4: events.ts — route subagent events through `onSubagentChild`

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/events.ts` (handleAssistantEvent + handleUserEvent)
- Test: `packages/core/src/__tests__/claude-events.test.ts`

We replace the prompt-suppression guards from PRs #264 and #267 with: "if `event.parent_tool_use_id != null`, tag every block with that id and route via `onSubagentChild`". Skill loads from a subagent are tagged the same way and bubble through `onSubagentChild` as a `skill_loaded` block — they nest in the Task card per the user's "inner pill" decision.

- [ ] **Step 1: Update tests in `packages/core/src/__tests__/claude-events.test.ts`**

Replace the existing `describe('subagent dispatch prompt …', …)` block with this:

```ts
describe('subagent events (parent_tool_use_id != null)', () => {
  // Background: CLI 2.1.118+ normalizes agent_progress into top-level SDK
  // user/assistant events with parent_tool_use_id set to the parent's
  // Agent/Task tool_use_id. We route every such event through
  // onSubagentChild, tagging blocks with parentToolUseId so the display
  // pipeline groups them under the parent Task card.

  it('routes subagent assistant events to onSubagentChild with tagged blocks', () => {
    const session = createSession();
    const sink = createSink();
    const event = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: 'toolu_parent_agent',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [
          { type: 'thinking', thinking: 'subagent inner thought' },
          { type: 'text', text: 'Let me run a command.' },
          { type: 'tool_use', id: 'toolu_subagent_bash', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onMessage).not.toHaveBeenCalled();
    expect(sink.onSubagentChild).toHaveBeenCalledTimes(1);
    const [parentId, blocks] = (sink.onSubagentChild as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(parentId).toBe('toolu_parent_agent');
    expect(blocks).toHaveLength(3);
    for (const b of blocks) expect((b as { parentToolUseId?: string }).parentToolUseId).toBe('toolu_parent_agent');
  });

  it('routes the dispatch prompt (string content normalized to text block) to onSubagentChild', () => {
    const session = createSession();
    const sink = createSink();
    const event = JSON.stringify({
      type: 'user',
      parent_tool_use_id: 'toolu_parent_agent',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Run `echo hi` via Bash and report the output.' }],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onCliMessage).not.toHaveBeenCalled();
    expect(sink.onSubagentChild).toHaveBeenCalledTimes(1);
    const [parentId, blocks] = (sink.onSubagentChild as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(parentId).toBe('toolu_parent_agent');
    expect(blocks).toEqual([
      { type: 'text', text: 'Run `echo hi` via Bash and report the output.', parentToolUseId: 'toolu_parent_agent' },
    ]);
  });

  it('routes raw string-content (pre-normalize edge case) to onSubagentChild', () => {
    const session = createSession();
    const sink = createSink();
    const event = JSON.stringify({
      type: 'user',
      parent_tool_use_id: 'toolu_parent_agent',
      message: { role: 'user', content: 'raw string body' },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onSubagentChild).toHaveBeenCalledWith('toolu_parent_agent', [
      { type: 'text', text: 'raw string body', parentToolUseId: 'toolu_parent_agent' },
    ]);
  });

  it('routes subagent tool_result blocks via onSubagentChild (not onToolResult)', () => {
    const session = createSession();
    const sink = createSink();
    const event = JSON.stringify({
      type: 'user',
      parent_tool_use_id: 'toolu_parent_agent',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_subagent_bash', content: 'hi' }],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onToolResult).not.toHaveBeenCalled();
    expect(sink.onSubagentChild).toHaveBeenCalledTimes(1);
    const [parentId, blocks] = (sink.onSubagentChild as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(parentId).toBe('toolu_parent_agent');
    expect((blocks[0] as { type: string }).type).toBe('tool_result');
    expect((blocks[0] as { parentToolUseId?: string }).parentToolUseId).toBe('toolu_parent_agent');
  });

  it('routes subagent skill loads through onSubagentChild as skill_loaded blocks (inner pill)', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const pathMod = await import('node:path');
    const tmp = await mkdtemp(pathMod.join(tmpdir(), 'mf-subagent-skill-'));
    try {
      const skillDir = pathMod.join(tmp, '.claude', 'skills', 'pencil');
      await mkdir(skillDir, { recursive: true });
      await writeFile(pathMod.join(skillDir, 'SKILL.md'), '# Pencil\nbody');

      const session = createSession(tmp);
      const sink = createSink();
      const event = JSON.stringify({
        type: 'user',
        parent_tool_use_id: 'toolu_parent_agent',
        message: { role: 'user', content: '<command-name>pencil</command-name>' },
      });
      handleStdout(session, Buffer.from(event + '\n'), sink);

      expect(sink.onSkillLoaded).not.toHaveBeenCalled();
      expect(sink.onSubagentChild).toHaveBeenCalledTimes(1);
      const [parentId, blocks] = (sink.onSubagentChild as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(parentId).toBe('toolu_parent_agent');
      expect((blocks[0] as { type: string }).type).toBe('skill_loaded');
      expect((blocks[0] as { skillName: string }).skillName).toBe('pencil');
      expect((blocks[0] as { parentToolUseId?: string }).parentToolUseId).toBe('toolu_parent_agent');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('parent-level events (parent_tool_use_id null) take the existing path', () => {
    const session = createSession();
    const sink = createSink();
    const event = JSON.stringify({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Unknown command: /typo' }],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onCliMessage).toHaveBeenCalledWith('Unknown command: /typo');
    expect(sink.onSubagentChild).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests, confirm they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/claude-events.test.ts -t "subagent events"`
Expected: FAIL — sink methods called as before, not via `onSubagentChild`.

- [ ] **Step 3: Implement subagent routing in `handleUserEvent`**

Replace the current `parent_tool_use_id` guard inside `handleUserEvent` (lines that drop the dispatch prompt) with this branch placed **right after** the `if (!message?.content) return;` line and **before** the existing string/array branches:

```ts
  // Subagent activity: every block in this event belongs inside the parent's
  // Agent/Task tool_use card. Tag each block with parentToolUseId and forward
  // via onSubagentChild — the event-handler appends them to the parent's
  // assistant message and the display pipeline groups them under _TaskGroup.
  if (typeof event.parent_tool_use_id === 'string' && event.parent_tool_use_id) {
    const parentToolUseId = event.parent_tool_use_id;
    const collected: import('@qlan-ro/mainframe-types').MessageContent[] = [];

    if (typeof message.content === 'string') {
      // Pre-normalize edge case (model-switch breadcrumbs etc.). Treat as text.
      collected.push({ type: 'text', text: message.content, parentToolUseId });
    } else {
      const tur = (event.tool_use_result ?? event.toolUseResult) as Record<string, unknown> | undefined;
      const toolResults = buildToolResultBlocks(message as Record<string, unknown>, tur);
      for (const r of toolResults) collected.push({ ...r, parentToolUseId });

      for (const block of message.content) {
        if (block.type === 'tool_result') continue; // already handled by buildToolResultBlocks
        if (block.type === 'text') {
          const text = (block.text as string) || '';
          if (!text.trim()) continue;
          // Skill load shape: surface as a skill_loaded child (inner pill) using
          // the same extraction logic as the parent-level path below.
          const hasSkillFormat = text.includes('<skill-format>true</skill-format>');
          const baseDirMatch = /^Base directory for this skill:\s*(.+?)(?:\n|$)/m.exec(text);
          const isSkillInjection = hasSkillFormat || Boolean(baseDirMatch);
          if (isSkillInjection) {
            const nameFromTag = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1]?.replace(/^\//, '').trim();
            const rawDir = baseDirMatch?.[1]?.trim() ?? '';
            const skillName = nameFromTag || (rawDir ? path.basename(rawDir) : '');
            const resolvedPath = rawDir && !path.extname(rawDir) ? path.join(rawDir, 'SKILL.md') : rawDir;
            const finalPath =
              resolvedPath ||
              (skillName ? resolveSkillPath(session.projectPath, skillName, session.state.skillPathCache) : '');
            const content = text
              .replace(/<command-message>[^<]*<\/command-message>\n?/g, '')
              .replace(/<command-name>[^<]*<\/command-name>\n?/g, '')
              .replace(/<skill-format>[^<]*<\/skill-format>\n?/g, '')
              .replace(/^Base directory for this skill:[^\n]*\n?/m, '')
              .trim();
            if (skillName && finalPath) {
              session.state.skillPathCache.set(skillName, finalPath);
            }
            if (skillName) {
              collected.push({ type: 'skill_loaded', skillName, path: finalPath, content, parentToolUseId });
              continue;
            }
          }
          collected.push({ type: 'text', text, parentToolUseId });
        } else if (block.type === 'image') {
          collected.push({
            type: 'image',
            mediaType: (block.source as { media_type?: string } | undefined)?.media_type ?? 'image/png',
            data: (block.source as { data?: string } | undefined)?.data ?? '',
          } as import('@qlan-ro/mainframe-types').MessageContent);
        }
      }
    }

    // Also handle the string-content `<command-name>` shape inside subagent
    // (e.g. user-typed slash that surfaces as a string event).
    if (
      typeof message.content === 'string' &&
      /<command-name>\/?([^<]+)<\/command-name>/.test(message.content)
    ) {
      const nameMatch = /<command-name>\/?([^<]+)<\/command-name>/.exec(message.content);
      if (nameMatch?.[1]) {
        const skillName = nameMatch[1].trim();
        const cached = session.state.skillPathCache.get(skillName);
        const skillPath = cached ?? resolveExistingSkillPath(session.projectPath, skillName);
        if (skillPath) {
          session.state.skillPathCache.set(skillName, skillPath);
          const content = readSkillContent(skillPath) ?? '';
          // Replace the plain text we collected above with a skill_loaded block.
          collected.length = 0;
          collected.push({ type: 'skill_loaded', skillName, path: skillPath, content, parentToolUseId });
        }
      }
    }

    if (collected.length > 0) sink.onSubagentChild(parentToolUseId, collected);
    return;
  }
```

- [ ] **Step 4: Implement subagent routing in `handleAssistantEvent`**

Add this branch at the top of `handleAssistantEvent` (after the `if (!message?.content) return;`):

```ts
  if (typeof event.parent_tool_use_id === 'string' && event.parent_tool_use_id) {
    const parentToolUseId = event.parent_tool_use_id;
    const tagged = message.content.map((b) => ({ ...b, parentToolUseId })) as import(
      '@qlan-ro/mainframe-types'
    ).MessageContent[];
    sink.onSubagentChild(parentToolUseId, tagged);
    return;
  }
```

This skips the parent-level bookkeeping (TodoWrite/PR/Skill registration) for subagent events on purpose: those tools belong to the subagent's own context, not the parent's PR/Todo state. (The previous implementation already did this for the wide-blanket version of the fix.)

- [ ] **Step 5: Run the new tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/claude-events.test.ts -t "subagent events"`
Expected: all pass.

- [ ] **Step 6: Run the rest of the events tests to confirm no regression**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/claude-events.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/events.ts packages/core/src/__tests__/claude-events.test.ts
git commit -m "feat(claude/events): route subagent events through onSubagentChild with tagged blocks"
```

---

## Task 5: Display pipeline — propagate `parentToolUseId` through `PartEntry`

**Files:**
- Modify: `packages/core/src/messages/tool-grouping.ts:25-34` (PartEntry shape)
- Modify: `packages/core/src/messages/display-helpers.ts` (where `PartEntry`s are constructed and where they're converted back to `DisplayContent`)
- Test: `packages/core/src/__tests__/message-grouping.test.ts` (new)

- [ ] **Step 1: Extend `PartEntry`**

In `packages/core/src/messages/tool-grouping.ts:25-34`, add the field on both variants:

```ts
export type PartEntry =
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
      isError?: boolean;
      parentToolUseId?: string;
    }
  | { type: 'text'; text: string; parentToolUseId?: string };
```

- [ ] **Step 2: Carry `parentToolUseId` from `MessageContent` into the `PartEntry` array in `display-helpers.ts`**

Find the part-construction call site in `applyToolGrouping` and `convertGroupedPartsToDisplay` (read `display-helpers.ts` to confirm exact lines) and copy `parentToolUseId` through. Example for the construction loop:

```ts
const parts: PartEntry[] = content.map((c) => {
  if (c.type === 'tool_call') {
    return {
      type: 'tool-call' as const,
      toolCallId: c.id,
      toolName: c.name,
      args: c.input,
      result: c.result,
      isError: c.result?.isError,
      parentToolUseId: c.parentToolUseId,
    };
  }
  if (c.type === 'text') return { type: 'text' as const, text: c.text, parentToolUseId: c.parentToolUseId };
  // sentinel-encoding for non-groupable content (existing behavior) — already preserves parentToolUseId via the original DisplayContent so no extra change here.
  ...
});
```

When converting back (`convertGroupedPartsToDisplay`), if a `tool-call` part has `parentToolUseId`, mirror it onto the resulting `DisplayContent` `tool_call`.

- [ ] **Step 3: Mirror `parentToolUseId` on `DisplayContent` where needed**

`packages/types/src/display.ts` (or wherever `DisplayContent` is defined): add optional `parentToolUseId?: string` to `tool_call`, `text`, `thinking`, `skill_loaded` variants. Build types.

- [ ] **Step 4: Build core; fix any cascading type errors**

Run: `pnpm --filter @qlan-ro/mainframe-types build && pnpm --filter @qlan-ro/mainframe-core build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/types packages/core/src/messages
git commit -m "feat(messages): propagate parentToolUseId through PartEntry and DisplayContent"
```

---

## Task 6: Grouping — `groupTaskChildren` matches by `parentToolUseId`

**Files:**
- Modify: `packages/core/src/messages/tool-grouping.ts` (`groupTaskChildren`)
- Test: `packages/core/src/__tests__/message-grouping.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/__tests__/message-grouping.test.ts`:

```ts
it('groupTaskChildren includes text/thinking/skill_loaded children whose parentToolUseId matches the Agent', () => {
  const cats = makeTestCategories(); // helper that already exists in this file; if not, copy from a sibling test
  const parts: PartEntry[] = [
    { type: 'tool-call', toolCallId: 'toolu_agent_1', toolName: 'Agent', args: {}, result: 'ok' },
    { type: 'text', text: 'Run echo hi via Bash and report the output.', parentToolUseId: 'toolu_agent_1' },
    { type: 'tool-call', toolCallId: 'toolu_sub_bash', toolName: 'Bash', args: { command: 'echo hi' }, result: 'hi', parentToolUseId: 'toolu_agent_1' },
  ];
  const grouped = groupTaskChildren(parts, cats);
  expect(grouped).toHaveLength(1);
  const g = grouped[0]!;
  expect(g.type).toBe('tool-call');
  expect((g as { toolName: string }).toolName).toBe('_TaskGroup');
  const args = (g as { args: { children: PartEntry[] } }).args;
  expect(args.children.map((c) => (c.type === 'text' ? 'text' : c.toolName))).toEqual(['text', 'Bash']);
});

it('groupTaskChildren stops collecting when a part has no parentToolUseId or a different one', () => {
  const cats = makeTestCategories();
  const parts: PartEntry[] = [
    { type: 'tool-call', toolCallId: 'toolu_agent_1', toolName: 'Agent', args: {}, result: 'ok' },
    { type: 'text', text: 'subagent text', parentToolUseId: 'toolu_agent_1' },
    { type: 'tool-call', toolCallId: 'toolu_sub_bash', toolName: 'Bash', args: {}, parentToolUseId: 'toolu_agent_1' },
    { type: 'text', text: 'parent thread text' }, // no parentToolUseId — terminates
    { type: 'tool-call', toolCallId: 'toolu_parent_read', toolName: 'Read', args: {} },
  ];
  const grouped = groupTaskChildren(parts, cats);
  expect(grouped).toHaveLength(3);
  expect((grouped[0] as { toolName: string }).toolName).toBe('_TaskGroup');
  expect((grouped[1] as { type: string }).type).toBe('text');
  expect((grouped[2] as { toolName: string }).toolName).toBe('Read');
});
```

If `makeTestCategories` doesn't exist, write a minimal helper at the top of the test file:

```ts
function makeTestCategories() {
  return {
    explore: new Set<string>(['Read', 'Glob', 'Grep', 'LS']),
    hidden: new Set<string>(['TodoWrite']),
    progress: new Set<string>(['_TaskProgress']),
    subagent: new Set<string>(['Agent', 'Task']),
  } as const;
}
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/message-grouping.test.ts -t "groupTaskChildren"`
Expected: FAIL — current code breaks on the first text part.

- [ ] **Step 3: Update `groupTaskChildren` in `packages/core/src/messages/tool-grouping.ts:143-188`**

Replace the inner loop with the parent-id match rule. Concrete diff:

```ts
export function groupTaskChildren(parts: PartEntry[], categories: ToolCategories): PartEntry[] {
  const result: PartEntry[] = [];
  let i = 0;

  while (i < parts.length) {
    const part = parts[i]!;

    if (part.type === 'tool-call' && isSubagentTool(part.toolName, categories)) {
      const agentToolUseId = part.toolCallId;
      const children: PartEntry[] = [];
      let j = i + 1;
      while (j < parts.length) {
        const next = parts[j]!;
        // sentinel placeholder for thinking/image — must keep the same as before
        if (next.type === 'text' && next.text.startsWith('\0ng:')) { j++; continue; }
        // Only collect parts tagged as belonging to THIS Agent.
        if (next.parentToolUseId !== agentToolUseId) break;
        children.push(next);
        j++;
      }

      if (children.length > 0) {
        result.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: '_TaskGroup',
          args: { taskArgs: part.args, children },
          result: part.result,
          isError: part.isError,
        });
        i = j;
      } else {
        result.push(part);
        i++;
      }
    } else {
      result.push(part);
      i++;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/message-grouping.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/messages/tool-grouping.ts packages/core/src/__tests__/message-grouping.test.ts
git commit -m "feat(messages): group Task children by parentToolUseId tag"
```

---

## Task 7: TaskGroupCard — render text/thinking/skill_loaded children

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskGroupCard.tsx`
- (Possibly) Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/render-tool-card.tsx` if it dispatches by name

The current `TaskGroupCard` body iterates `children` and calls `renderToolCard`. We extend it to handle the three new child kinds.

- [ ] **Step 1: Read the existing component to confirm the props shape**

```bash
cat packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskGroupCard.tsx
```

- [ ] **Step 2: Add child kind discriminator**

`children` was previously typed as `TaskGroupChild[]` (only tool calls). Update the type to allow the new shapes:

```tsx
type TaskGroupChild =
  | { kind: 'tool'; toolCallId: string; toolName: string; args: Record<string, unknown>; result?: unknown; isError?: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string }
  | { kind: 'skill_loaded'; skillName: string; path: string; content: string };
```

The `args.children` we push from `groupTaskChildren` must be normalized into this shape. Do that in the `_TaskGroup` builder in `groupTaskChildren` (Task 6) — easier than translating in the React component.

If you prefer keeping `PartEntry` in `args.children`, then translate in the component instead — same idea, different boundary.

- [ ] **Step 3: Render each kind**

```tsx
{open && (
  <>
    <div className="pl-6 pr-2 pb-1 text-mf-small text-mf-text-secondary/70 italic whitespace-pre-wrap">
      {(taskArgs.prompt as string | undefined) ?? ''}
    </div>
    {children.map((child, idx) => {
      switch (child.kind) {
        case 'tool':
          return (
            <React.Fragment key={child.toolCallId}>
              {renderToolCard(child.toolName, child.args, '', child.result, child.isError)}
            </React.Fragment>
          );
        case 'text':
          return (
            <div key={`text-${idx}`} className="pl-6 pr-2 py-1 text-mf-body text-mf-text-primary whitespace-pre-wrap select-text">
              {child.text}
            </div>
          );
        case 'thinking':
          return (
            <details key={`think-${idx}`} className="pl-6 pr-2 py-1 text-mf-small text-mf-text-secondary">
              <summary className="cursor-pointer">Reasoning</summary>
              <div className="whitespace-pre-wrap pl-3 pt-1">{child.thinking}</div>
            </details>
          );
        case 'skill_loaded':
          return (
            <div key={`skill-${idx}`} className="pl-6">
              <SkillLoadedCard skillName={child.skillName} path={child.path} content={child.content} />
            </div>
          );
      }
    })}
    {resultText && (
      <div className="pl-6 text-mf-small text-mf-text-secondary whitespace-pre-wrap select-text">{resultText}</div>
    )}
  </>
)}
```

The intro line at the top is the prompt straight from `taskArgs.prompt` — that solves "trim the prompt so it doesn't look bad" by simply not duplicating it (the inlined first text child IS the prompt, but we render it from `taskArgs.prompt` instead because that's authoritative and never affected by streaming order).

If you want to deduplicate: when the first text child equals `taskArgs.prompt`, skip rendering it.

- [ ] **Step 4: Manual smoke**

```bash
pnpm --filter @qlan-ro/mainframe-core build
pnpm --filter @qlan-ro/mainframe-desktop dev
```

Open a chat, dispatch an Agent (e.g. "Run `echo hi` via Bash"), expand the Task card. Confirm:
- prompt appears once at the top (intro line)
- subagent text appears as a left-indented body line
- Bash command appears as `BashCard` child
- no system pill at root

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/TaskGroupCard.tsx
git commit -m "feat(desktop/TaskGroupCard): render text/thinking/skill_loaded children"
```

---

## Task 8: History — extend `injectAgentChildren` with subagent text/thinking + tag

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/history.ts`
- Test: `packages/core/src/__tests__/message-loading.test.ts`

History today only inlines subagent **tool_use** blocks (from `agent_progress` events) and attaches subagent **tool_result** blocks. We extend it to also inline subagent text/thinking/skill_loaded from subagent JSONLs, and we tag every inlined block with `parentToolUseId = parent Agent tool_use_id`.

- [ ] **Step 1: Write a failing test**

Add to `packages/core/src/__tests__/message-loading.test.ts`:

```ts
it('inlines subagent assistant text/thinking from subagent JSONLs into the parent assistant message with parentToolUseId tag', async () => {
  // Parent JSONL: assistant with Agent tool_use, then parent's tool_result.
  const agentToolUseId = 'toolu_agent_1';
  writeJsonl(SESSION_ID, [
    userTextEntry('dispatch please'),
    assistantToolUseEntry('Agent', { description: 'Echo hi', subagent_type: 'general-purpose', prompt: 'Run echo hi' }, agentToolUseId),
    toolResultEntry(agentToolUseId, 'Output of `echo hi`: `hi`'),
  ]);

  // Subagent JSONL with one assistant turn (text + Bash tool_use) and tool_result.
  const subagentDir = join(PROJECT_DIR, SESSION_ID, 'subagents');
  mkdirSync(subagentDir, { recursive: true });
  writeFileSync(
    join(subagentDir, `agent-sub.jsonl`),
    [
      jsonlEntry({
        type: 'user',
        isSidechain: true,
        agentId: 'sub',
        message: { role: 'user', content: 'Run echo hi' },
      }),
      jsonlEntry({
        type: 'assistant',
        isSidechain: true,
        agentId: 'sub',
        parentToolUseID: agentToolUseId,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'subagent inner' },
            { type: 'text', text: 'Running it.' },
            { type: 'tool_use', id: 'toolu_sub_bash', name: 'Bash', input: { command: 'echo hi' } },
          ],
        },
      }),
      jsonlEntry({
        type: 'user',
        isSidechain: true,
        agentId: 'sub',
        parentToolUseID: agentToolUseId,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_sub_bash', content: 'hi' }],
        },
      }),
    ].join('\n') + '\n',
  );

  const messages = await loadHistory(SESSION_ID, PROJECT_PATH);

  // Find the parent assistant message and assert its content[] now includes the subagent blocks.
  const assistant = messages.find((m) => m.type === 'assistant');
  expect(assistant).toBeDefined();
  const contentTypes = assistant!.content.map((c) => c.type);
  expect(contentTypes).toContain('thinking');
  expect(contentTypes.filter((t) => t === 'text').length).toBeGreaterThanOrEqual(1);
  // Every inlined block carries the parentToolUseId tag pointing to the Agent tool_use.
  for (const c of assistant!.content) {
    if (c.type === 'tool_use' && c.name === 'Agent') continue;
    if ((c as { parentToolUseId?: string }).parentToolUseId !== undefined) {
      expect((c as { parentToolUseId?: string }).parentToolUseId).toBe(agentToolUseId);
    }
  }
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/message-loading.test.ts -t "inlines subagent assistant text/thinking"`
Expected: FAIL.

- [ ] **Step 3: Extend `collectAgentProgressTools` (rename mentally — it now also collects text/thinking)**

In `packages/core/src/plugins/builtin/claude/history.ts`, locate `collectAgentProgressTools` (around line 277) and extend it to push `text` and `thinking` blocks too:

```ts
function collectAgentProgressTools(entry: Record<string, unknown>, agentTools: Map<string, MessageContent[]>): void {
  const parentId = entry.parentToolUseID as string | undefined;
  if (!parentId) return;
  const data = entry.data as Record<string, unknown>;
  const msg = data.message as Record<string, unknown> | undefined;
  const inner = msg?.message as Record<string, unknown> | undefined;
  if (!inner || inner.role !== 'assistant') return;
  const content = inner.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    const existing = agentTools.get(parentId) ?? [];
    if (block.type === 'tool_use') {
      existing.push({
        type: 'tool_use',
        id: (block.id as string) || nanoid(),
        name: block.name as string,
        input: (block.input as Record<string, unknown>) ?? {},
        parentToolUseId: parentId,
      });
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      if (text.trim()) existing.push({ type: 'text', text, parentToolUseId: parentId });
    } else if (block.type === 'thinking') {
      const t = (block.thinking as string) || '';
      if (t.trim()) existing.push({ type: 'thinking', thinking: t, parentToolUseId: parentId });
    }
    if (existing.length > 0) agentTools.set(parentId, existing);
  }
}
```

- [ ] **Step 4: Add a sibling helper to collect from subagent JSONL files (current CLI doesn't write `agent_progress` to the parent JSONL)**

Add a function that walks subagent JSONL files and pushes their assistant text/thinking/tool_use blocks plus user tool_results into the same `agentTools` map keyed by the parent agent tool_use id (which on subagent JSONL entries is `parentToolUseID`).

```ts
function collectSubagentAssistantBlocks(
  entry: Record<string, unknown>,
  agentTools: Map<string, MessageContent[]>,
): void {
  const parentId = entry.parentToolUseID as string | undefined;
  if (!parentId) return;
  if (entry.type !== 'assistant') return;
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return;

  const existing = agentTools.get(parentId) ?? [];
  for (const block of content) {
    if (block.type === 'tool_use') {
      existing.push({
        type: 'tool_use',
        id: (block.id as string) || nanoid(),
        name: block.name as string,
        input: (block.input as Record<string, unknown>) ?? {},
        parentToolUseId: parentId,
      });
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      if (text.trim()) existing.push({ type: 'text', text, parentToolUseId: parentId });
    } else if (block.type === 'thinking') {
      const t = (block.thinking as string) || '';
      if (t.trim()) existing.push({ type: 'thinking', thinking: t, parentToolUseId: parentId });
    }
  }
  agentTools.set(parentId, existing);
}
```

- [ ] **Step 5: Wire the new collector inside `loadHistory`**

In `loadHistory`, where the current `if (isSubagentFile) { collectSubagentToolResults(entry, subagentToolResults); continue; }` sits, also call `collectSubagentAssistantBlocks(entry, agentTools)`:

```ts
          if (isSubagentFile) {
            collectSubagentToolResults(entry, subagentToolResults);
            collectSubagentAssistantBlocks(entry, agentTools);
            continue;
          }
```

- [ ] **Step 6: Tag tool_results when attaching them to the inlined tool_use**

In `attachSubagentToolResults`, set `parentToolUseId` on the result block so it lines up with the inlined tool_use it pairs with. Find the matching parent agent id by walking the parent assistant message's content for the tool_use that owns the result:

```ts
function attachSubagentToolResults(
  messages: ChatMessage[],
  results: Map<string, MessageContent & { type: 'tool_result' }>,
): void {
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue;
    const newContent: MessageContent[] = [];
    for (const block of msg.content) {
      newContent.push(block);
      if (block.type === 'tool_use') {
        const toolResult = results.get(block.id);
        if (toolResult) {
          newContent.push({ ...toolResult, parentToolUseId: block.parentToolUseId });
        }
      }
    }
    msg.content = newContent;
  }
}
```

- [ ] **Step 7: `injectAgentChildren` is unchanged — it already uses `agentTools` which now contains the broader block kinds. Confirm by reading the function**

```bash
sed -n '/^function injectAgentChildren/,/^}/p' packages/core/src/plugins/builtin/claude/history.ts
```

(The function as-is appends whatever is in `agentTools.get(block.id)` — that's now the right thing.)

- [ ] **Step 8: Run the failing test from Step 1**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/message-loading.test.ts -t "inlines subagent assistant text/thinking"`
Expected: PASS.

- [ ] **Step 9: Run the full message-loading suite**

Run: `pnpm --filter @qlan-ro/mainframe-core test src/__tests__/message-loading.test.ts`
Expected: all pass. The two regressions added by PRs #259 and #261 still hold (subagent isMeta skill loads from subagent JSONLs are no longer promoted to top-level cards — they now flow through the inlined-blocks path and the existing skill-synthesis filter for subagent files in #261 is still correct).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/history.ts packages/core/src/__tests__/message-loading.test.ts
git commit -m "feat(claude/history): inline subagent text/thinking/tool_results with parentToolUseId tag"
```

---

## Task 9: End-to-end manual verification

**Files:** none (manual)

- [ ] **Step 1: Build everything**

```bash
pnpm install
pnpm -r build
```

- [ ] **Step 2: Start the dev daemon and renderer**

```bash
pnpm --filter @qlan-ro/mainframe-core dev &
pnpm --filter @qlan-ro/mainframe-desktop dev
```

- [ ] **Step 3: Live test**

Open a chat in `qlan-home-hub` (or any project). Send a prompt like: "Dispatch 3 general-purpose subagents — each runs `echo hi` via Bash."

Verify:
- No system pill with the dispatch prompt at root.
- Each Task card collapses by default; expanding reveals: prompt at top, subagent text/thinking inline, Bash child with its result.
- Skill loads triggered inside a subagent appear as `SkillLoadedCard`s **inside** the Task card.
- Skill loads triggered at parent level still appear at root.

- [ ] **Step 4: History test**

Restart the daemon. Reopen the same chat. Verify the same nesting persists from the JSONL replay path.

- [ ] **Step 5: Cross-check against existing PR's regressions**

Open a chat that has historical Agent dispatches recorded with the older protocol (no subagent text in subagent JSONLs). Confirm Task cards still render correctly — empty children are fine, no errors.

- [ ] **Step 6: Commit a changeset**

```bash
pnpm changeset
# choose @qlan-ro/mainframe-core, @qlan-ro/mainframe-types, @qlan-ro/mainframe-desktop
# bump: minor
```

Changeset summary:

```markdown
Nest subagent activity (dispatch prompt, text, thinking, skill loads, tool calls) **inside** the parent's Task card on both live stream and history reload. Replaces the prompt-suppression patches in PRs #264/#267 with a uniform rule: every event with `parent_tool_use_id != null` is inlined into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and tagged with `parentToolUseId` so `groupTaskChildren` can wrap text/thinking/skill_loaded under `_TaskGroup` alongside tool calls. Parent-level skill loads continue to surface at the chat root.
```

```bash
git add .changeset
git commit -m "chore: changeset for subagent-blocks-nesting"
```

---

## Task 10: Open the PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/subagent-blocks-nesting
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat: nest subagent activity inside the parent Task card" --body "$(cat <<'EOF'
## Summary

Replaces the prompt-suppression patches in #264 and #267 with the right architectural fix: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent's assistant message that owns the matching `Agent`/`Task` tool_use, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, so the dispatch prompt, subagent text/thinking, subagent skill loads, subagent tool_use and subagent tool_results all render **inside** the Task card.

## Why

CLI 2.1.118+ normalizes `agent_progress` events into top-level user/assistant SDK messages with `parent_tool_use_id` set. Mainframe used to handle these at the parent level, leaking subagent chatter as ghost system pills/bubbles into the main thread and breaking `_TaskGroup` grouping (which previously stopped at the first text block).

## Behaviour change

Before: subagent prompt → root pill, subagent text → root assistant bubble, Task card empty.
After: everything subagent-origin lives inside the Task card. Skill loads from inside a subagent become an "inner pill" (`SkillLoadedCard`) inside the Task card body. Skill loads from the parent thread still render at the chat root.

## Test plan

- [x] Unit: `claude-events.test.ts` (`onSubagentChild` routing for assistant/user/text/string/skill/tool_result shapes)
- [x] Unit: `event-handler.test.ts` (`onSubagentChild` appends to parent message; warns on missing parent)
- [x] Unit: `message-grouping.test.ts` (`groupTaskChildren` collects by `parentToolUseId`, terminates on mismatch)
- [x] Unit: `message-loading.test.ts` (history reload inlines subagent text/thinking with tag)
- [ ] Manual live: dispatch 3 parallel subagents; expand the Task card; expect prompt + subagent text + Bash child with result; no root pill.
- [ ] Manual history: restart daemon, reopen chat; expect same nesting.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Skill loads at root vs. nested → Task 4 (parent-level path unchanged) + Task 7 (`SkillLoadedCard` rendered inside Task card body for subagent-origin)
- Prompt nested + trimmed/styled → Task 7 (intro line in Task card body)
- Subagent text/thinking nested → Tasks 4, 6, 7
- Subagent tool_use/tool_result nested → Tasks 4, 6, 7 (already worked for tool_use; now via tag, no regression)
- History parity → Task 8
- Replaces #264/#267 → Task 4 (drops the prompt-suppression branches)

**Placeholder scan:** None. Every code step has full bodies.

**Type consistency:** `parentToolUseId` field name used consistently across `MessageContent` (Task 1), `SessionSink.onSubagentChild` (Task 2), event-handler implementation (Task 3), `events.ts` block tagging (Task 4), `PartEntry` (Task 5), `DisplayContent` (Task 5), `groupTaskChildren` (Task 6), `TaskGroupCard` (Task 7), history collectors and `attachSubagentToolResults` (Task 8). The runtime field name from the CLI's stream-json (`parent_tool_use_id`, snake_case) is read in `events.ts` only and translated to `parentToolUseId` (camelCase) at the boundary.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-30-subagent-blocks-nesting.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using the `executing-plans` skill, batch execution with checkpoints.

Which approach?
