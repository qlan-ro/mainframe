# Codex Tool Cards — Implementation Plan

> Concrete tasks for the decisions in `docs/plans/2026-04-28-codex-tool-card-unification.md`. Same branch (`feat/tool-cards`), same PR (#262).

**Goal:** Codex tools render with the same unified cards as Claude. Zero render-side changes — all the work happens in the Codex event-mapper, which now emits Claude-shaped `tool_use` blocks (`Bash`, `Edit`, `Write`, `mcp__<server>__<tool>`).

**Architecture:** Adapter as translation layer. Codex's `commandExecution` → emits `Bash` tool_use. Codex's `fileChange` → parses unified-diff text from `change.diff`, emits one `Edit` or `Write` tool_use per change with `result.structuredPatch` populated. Codex MCP tools → renamed to `mcp__<server>__<tool>` so existing `MCPToolCard` wildcard catches them. Hidden tools (Codex `todoList` etc.) categorized in adapter so daemon-side filter applies. Live `chat.todos` flow gets a third source (Codex `todoList`) — out of scope here, tracked in todo #133.

**Tech Stack:** TypeScript, vitest, pnpm workspace.

**Spec reference:** `docs/plans/2026-04-28-codex-tool-card-unification.md` (decisions D1-D4).

---

## File Structure

| File | Change |
|---|---|
| `packages/core/src/plugins/builtin/codex/types.ts` | Add `diff: string` to each `FileChangeItem.changes[]`. Update `status` to full `PatchApplyStatus` enum. Verify `McpToolCallItem` shape exposes server name. |
| `packages/core/src/messages/parse-unified-diff.ts` | NEW — small parser converting unified-diff text → `Array<{ lines: string[]; oldStart?; newStart? }>` matching the `DiffHunk` shape. |
| `packages/core/src/__tests__/messages/parse-unified-diff.test.ts` | NEW — test cases for the parser. |
| `packages/core/src/plugins/builtin/codex/event-mapper.ts` | Rewrite `commandExecution` → `Bash` tool_use shape. Rewrite `fileChange` → one `Edit`/`Write` tool_use per change with parsed structuredPatch. Rename MCP tools to `mcp__<server>__<tool>`. |
| `packages/core/src/__tests__/codex-event-mapper.test.ts` | Add cases for the new emission shapes. |
| `packages/core/src/plugins/builtin/codex/adapter.ts` | Update `getToolCategories()`: hidden = `['todo_list']` + any approval-routed names. progress unchanged. explore/subagent stay empty (Codex has no equivalents). |
| `packages/core/src/__tests__/plugins/builtin/codex/adapter.test.ts` | NEW — test the categorization. |

---

## Task F-A.1: Add unified-diff parser

**Files:**
- Create: `packages/core/src/messages/parse-unified-diff.ts`
- Test: `packages/core/src/__tests__/messages/parse-unified-diff.test.ts`

The parser converts a string like:

```
@@ -1,3 +1,3 @@
 line one
-line two
+line two modified
 line three
```

Into:

```ts
[{ lines: [' line one', '-line two', '+line two modified', ' line three'], oldStart: 1, newStart: 1 }]
```

The shape MUST match what `EditFileCard` / `WriteFileCard` already consume (`DiffHunk` type from `@qlan-ro/mainframe-types`). Verify by reading `packages/types/src/display.ts` for the exact shape.

**Steps:**

- [ ] **Write tests first:** simple replace, add-only, delete-only, multi-hunk, no-newline-at-eof, empty diff, malformed input. Use real Codex diffs as fixtures (capture from a Codex JSONL session if possible).
- [ ] **Implement** the parser. Keep it pure — no I/O.
- [ ] **Tests pass.**
- [ ] **Commit:** `feat(core): add unified-diff parser for Codex file_change normalization`

---

## Task F-A.2: Update Codex types for diff data

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/types.ts:178-194`

Read the current `FileChangeItem` and `McpToolCallItem` definitions. Generate the latest schema from the Codex CLI:

```bash
codex app-server generate-ts --out /tmp/codex-schema-gen
```

Compare `/tmp/codex-schema-gen/v2/FileUpdateChange.ts` to our `FileChangeItem.changes[]` shape. Add the missing `diff: string` field. Update `status` to the full `PatchApplyStatus` enum (`'inProgress' | 'completed' | 'failed' | 'declined'`).

Also check `/tmp/codex-schema-gen/v2/McpToolCallItem.ts` — does it expose a server / serverName field? Update our type accordingly. If yes, we'll use it in F-B.3 for accurate `mcp__<server>__<tool>` naming.

**Steps:**

- [ ] Regenerate schema, diff against our types
- [ ] Update `FileChangeItem` (add `diff: string` to each change, widen `status`)
- [ ] If `McpToolCallItem` has a server field, add it; otherwise note in F-B.3 to use `'codex'` fallback
- [ ] `pnpm --filter @qlan-ro/mainframe-core typecheck` passes
- [ ] **Commit:** `chore(core): align Codex types with v2 protocol schema (diff, status, server name)`

---

## Task F-B.1: Rewrite `commandExecution` → `Bash` tool_use

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/event-mapper.ts` (the `commandExecution` branch around lines 106-124, exact lines vary)

Codex's `commandExecution` items have shape `{ command, aggregatedOutput, exitCode, status }`. Map to a Bash-shaped tool_use:

```ts
{
  type: 'tool_use',
  id: item.id,
  name: 'Bash',
  input: { command: item.command }
  // tool_result emitted separately matches:
  // { content: aggregatedOutput, isError: exitCode !== 0 && exitCode !== undefined }
}
```

The render-side `BashCard` will pick up `args.command` for the header and `result.content` for the body. Status dot derives from `result.isError`.

**Steps:**

- [ ] **Write the failing test:** in `codex-event-mapper.test.ts`, dispatch a `commandExecution` item-completed event and assert the emitted message has `tool_use { name: 'Bash', input: { command: ... } }` plus a paired `tool_result` block with `content === aggregatedOutput`, `isError === (exitCode !== 0)`.
- [ ] Implement the mapping change.
- [ ] Test passes.
- [ ] **Commit:** `feat(core): map Codex commandExecution to Bash tool_use`

---

## Task F-B.2: Rewrite `fileChange` → per-file `Edit`/`Write` tool_use

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/event-mapper.ts` (the `fileChange` branch around lines 125-142)
- Uses: `parse-unified-diff.ts` (from F-A.1)

For each change in `item.changes`, emit ONE tool_use:

```ts
// kind === 'add' → Write
{
  type: 'tool_use',
  id: `${item.id}:${index}`,  // unique per change
  name: 'Write',
  input: { file_path: change.path, content: extractAddedContent(change.diff) }
}
// + paired tool_result:
{ content: 'OK', isError: item.status === 'failed', structuredPatch: parseUnifiedDiff(change.diff) }

// kind === 'update' or 'delete' → Edit
{
  type: 'tool_use',
  id: `${item.id}:${index}`,
  name: 'Edit',
  input: { file_path: change.path, old_string: '', new_string: '' }  // placeholder, the diff is in result
}
// + paired tool_result:
{ content: 'OK', isError: item.status === 'failed', structuredPatch: parseUnifiedDiff(change.diff) }
```

`EditFileCard` consumes `result.structuredPatch` for the diff body, so the `old_string`/`new_string` in `input` are placeholders (only used for the `displayHunks` fallback path which won't trigger when `structuredPatch` is present).

**Steps:**

- [ ] **Write failing tests:** dispatch a `fileChange` event with two changes (one `add` + one `update`), assert two separate tool_use blocks emitted, each with the correct name, file_path, and parsed structuredPatch.
- [ ] Implement the mapping. Drop the old `{ name: 'file_change', input: { changes } }` emission.
- [ ] Tests pass.
- [ ] **Commit:** `feat(core): map Codex fileChange to per-file Edit/Write tool_use with parsed diff`

---

## Task F-B.3: Normalize Codex MCP tool names to `mcp__<server>__<tool>`

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/event-mapper.ts` (the `mcpToolCall` branch around lines 143-165)

Currently emits raw `item.tool` (e.g. `bash`, `read_file`). Change to:

```ts
const server = item.serverName ?? 'codex';  // fall back if protocol doesn't expose it
const toolName = `mcp__${server}__${item.tool}`;
```

This makes the existing `MCPToolCard` wildcard (`startsWith('mcp__')`) catch Codex MCP tools automatically. Server name displays in the pill ("Bash executing read_file" vs the generic "Codex executing read_file").

**Steps:**

- [ ] **Write failing test:** dispatch a `mcpToolCall` for tool=`read_file` server=`fs`, assert emitted tool_use name is `mcp__fs__read_file`. (If protocol has no server, assert `mcp__codex__read_file`.)
- [ ] Implement.
- [ ] Tests pass.
- [ ] **Commit:** `feat(core): normalize Codex MCP tool names to mcp__<server>__<tool>`

---

## Task F-C.1: Update Codex adapter categorization

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/adapter.ts:62-68`
- Test: `packages/core/src/__tests__/plugins/builtin/codex/adapter.test.ts` (new file or extend existing)

```ts
getToolCategories(): ToolCategories {
  return {
    explore: new Set(),  // Codex has no read-only file tools as separate names; reads happen via MCP
    hidden: new Set([
      'todo_list',  // Codex todoList items — handled by TasksSection (todo #133) when it lands
      // Add approval/permission item names if/when those route to BottomCard
    ]),
    progress: new Set(['todo_list']),  // declared but redundant once hidden filter fires; keep for parity
    subagent: new Set(),  // Codex has no subagent-equivalent
  };
}
```

**Steps:**

- [ ] Audit `codex/event-mapper.ts` for any tool emission that has a non-chat surface (approval cards, progress trays). Add to `hidden` if found.
- [ ] **Write test:** assert `hidden` contains `'todo_list'`. Assert `explore`/`subagent` are empty.
- [ ] Implement.
- [ ] Test passes.
- [ ] **Commit:** `feat(core): align Codex adapter hidden tools with rendering audit`

---

## Task F-D.1: Workspace verification + PR update

- [ ] Run desktop tests: `pnpm --filter @qlan-ro/mainframe-desktop test` — confirm 521+ pass (no Codex tests on desktop side; this catches accidental regressions)
- [ ] Run core tests: `pnpm --filter @qlan-ro/mainframe-core test` — confirm new Codex tests pass; pre-existing 2 failures in `files.test.ts` remain unchanged
- [ ] Run mobile typecheck: `cd packages/mobile && npx tsc --noEmit` — should be clean (mobile gets Codex parity automatically since the cards are shared)
- [ ] Build desktop: `pnpm --filter @qlan-ro/mainframe-desktop build`

## Task F-D.2: Add Codex changeset

- [ ] Create `.changeset/codex-tool-cards.md`:

```
---
'@qlan-ro/mainframe-core': minor
---

Codex tools now render with the same unified cards as Claude. The Codex event-mapper translates Codex-native item types into Claude-shaped tool_use blocks: commandExecution → Bash, fileChange → per-file Edit/Write with parsed unified-diff, mcpToolCall → mcp__<server>__<tool> for the MCPToolCard wildcard. Codex adapter declares todo_list as hidden (parity with Claude TodoWrite).
```

- [ ] Commit.

## Task F-D.3: Update PR #262 description

- [ ] Add a "Codex parity" section to the PR body covering F-A/F-B/F-C, linking the spec at `docs/plans/2026-04-28-codex-tool-card-unification.md`.

---

## Self-Review

- ✅ **Spec coverage:** D1 (unified diff parsing → reuse Edit/Write) → F-A.1 + F-B.2. D2 (MCP rename) → F-B.3. D3 (hidden tools) → F-C.1. D4 (`todoList` hidden, routed to TasksSection later) → F-C.1 hidden + todo #133 for the data path.
- ✅ **Placeholder scan:** every task names exact files and shows what gets emitted/changed.
- ✅ **Type consistency:** `DiffHunk` from `packages/types/src/display.ts` is the contract for both the parser output (F-A.1) and the consumers (Edit/WriteFileCard already compatible).
- ⚠️ **Open:** test fixture quality. Use real Codex JSONL captures if possible (live verification beats hand-crafted diffs).
