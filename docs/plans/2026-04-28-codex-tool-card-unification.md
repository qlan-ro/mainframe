# Codex Tool Card Unification Plan

> Extends the U1–U16 unified card design (see `docs/plans/2026-04-06-tool-card-rendering-audit.md`) to cover Codex-emitted tools. Currently every Codex tool falls through to `DefaultToolCard` (desktop) / `CompactToolPill` (mobile).

**Status:** DRAFT — pending review before implementation.

**Context:** This work was scoped after the Claude tool-card unification (Plans A–E) shipped on `feat/tool-cards`. It's intentionally a SEPARATE branch — Codex changes shouldn't block the Claude PRs (#262 + mainframe-mobile #7).

---

## Current state

### Codex adapter

`packages/core/src/plugins/builtin/codex/adapter.ts:62-68`:

```ts
getToolCategories(): ToolCategories {
  return {
    explore: new Set(),
    hidden: new Set(),
    progress: new Set(['todo_list']),
    subagent: new Set(),
  };
}
```

Almost no categorization — only `todo_list` is marked. Compared to the Claude adapter (10 hidden, 4 explore, 2 progress, 2 subagent).

### Codex tool names

`packages/core/src/plugins/builtin/codex/event-mapper.ts:106-165` maps Codex `ThreadItem` → tool_use blocks:

| Codex `ItemType` | Emitted tool name | Input shape |
|---|---|---|
| `commandExecution` | `command_execution` | `{ command: string }` |
| `fileChange` | `file_change` | `{ changes: Array<{ path, kind: 'add' \| 'update' \| 'delete' }> }` |
| `mcpToolCall` | `item.tool` directly (e.g. `bash`, `read_file`) | `item.arguments` (pass-through) |
| `agentMessage` | (text, no tool) | — |
| `reasoning` | (thinking block, currently filtered) | — |
| `webSearch` | unhandled / skipped | — |
| `todoList` | unhandled / skipped | — |

### Current render path

Both `render-tool-card.tsx` (desktop) and `tools/index.tsx` (mobile) only switch on Claude tool names (`Bash`, `Edit`, `Read`, `Write`, `Glob`, `Grep`, `Agent`, `Task`, etc.). None of the Codex names hit a branch — everything lands in the default fallback.

---

## Semantic gaps with Claude

| Gap | Impact | Mitigation |
|---|---|---|
| ~~Codex `file_change` has no `structuredPatch`~~ **Codex DOES expose unified-diff text** but Mainframe drops it (see D1 below) | None once we wire it through | Parse unified diff → `structuredPatch` shape → reuse Edit/WriteFileCard |
| Codex MCP tool names are bare (`bash`, `read_file`) not `mcp__<server>__<tool>` | Our existing `MCPToolCard` wildcard (`startsWith('mcp__')`) won't match | Either (a) adapter normalizes Codex MCP names to `mcp__codex__<tool>` so the wildcard catches them, or (b) we add a Codex-specific MCP detection branch. **Prefer (a) — fewer render-side branches.** |
| Codex `command_execution` has `aggregatedOutput`, `exitCode`, no `description` | `BashCard` sub-header (description) will be empty | Acceptable degradation — `BashCard` already handles missing description |
| `todo_list` declared as `progress` category but no `_TaskProgress` virtual created upstream | `TaskProgressCard` won't render | Need core/messages/tool-grouping to handle Codex's progress shape OR just hide |
| `reasoning` items already filtered (good) | None | None |

---

## Decisions to make (need your input before writing tasks)

### D1. `file_change` rendering

**UPDATE (2026-04-28):** Earlier draft assumed Codex doesn't provide a diff. **It does.** Codex exposes unified diff text via three notification channels:

| Channel | Field | Use |
|---|---|---|
| `item/completed` for `fileChange` items | `item.changes[].diff` (string, unified-diff format) | Per-file diff alongside path + kind |
| `turn/diff/updated` notification | `diff` (string, aggregated unified-diff for whole turn) | Turn-level summary |
| `item/fileChange/outputDelta` | `delta` (string) | Real-time streaming chunks while patch applies |

**Source of truth:** `codex app-server generate-ts` — `FileUpdateChange.ts` defines `{ path: string, kind: PatchChangeKind, diff: string }`.

**Mainframe gap (verified):**
- `packages/core/src/plugins/builtin/codex/types.ts:178-183` — `FileChangeItem` defines `changes: Array<{ path; kind }>` — **missing the `diff` field**.
- `packages/core/src/plugins/builtin/codex/event-mapper.ts:125-142` — extracts `item.changes` but only passes `{ changes: item.changes }` to the sink, discarding `diff`.
- `packages/core/src/plugins/builtin/codex/event-mapper.ts:44-58` — `turn/diff/updated` and `item/fileChange/outputDelta` notifications are silently dropped (`return;` with TODO).

**With diff data available, the rendering choices become:**

- **(A)** Reuse **EditFileCard / WriteFileCard** by parsing the unified diff string into the same `structuredPatch` shape (`Array<{ lines: string[] }>`) those cards already consume. Use `kind === 'add'` → WriteFileCard, `kind === 'update' | 'delete'` → EditFileCard.
- **(B)** New **FileChangeCard** that renders raw unified-diff text directly (simpler — no parsing, but inconsistent visual with the Claude Edit/Write cards).
- **(C)** Hybrid: render aggregated `turn/diff/updated` as a single summary card, AND per-file detail in EditFileCard/WriteFileCard.

**Recommend (A)** — gives full visual parity with Claude's Edit/Write cards. The unified-diff parser is small (~30 lines) and the `structuredPatch` shape is already what our cards consume. This makes Codex file edits look identical to Claude's.

**Multi-file** edge case: if `item.changes.length > 1`, render N stacked Edit/Write cards (one per change), each with its own diff. Or wrap them in a `_ToolGroup`-style aggregator for compactness — TBD.

### D2. Codex MCP tool naming — DECIDED (A)

Normalize at the adapter level (`event-mapper.ts`) to `mcp__<server>__<tool>` so our existing `MCPToolCard` wildcard catches it. Sub-decision still open: use the actual server name from `McpToolCallItem` if it's exposed in the Codex protocol — fall back to `mcp__codex__<tool>` otherwise. The implementer should check the generated TS schema (`/tmp/codex-schema-gen/v2/McpToolCallItem.ts`) for a `server` / `serverName` field before defaulting to `codex`.

### D3. Hidden tools sync — DECIDED

Follow the Claude pattern: anything with a dedicated UI surface outside the chat stream goes into the adapter's `hidden` Set. Concrete additions for Codex:

- `todo_list` (already declared `progress`; also add to `hidden` so once #133 ships, the Context tab is the single surface)
- Any approval/permission item types that route to `BottomCard` (verify which ones in `codex/approval-handler.ts`)

Implementer should audit `codex/event-mapper.ts` for any tool emission that has a dedicated non-chat surface and add the corresponding name to `hidden`.

### D4. `todoList` rendering — DECIDED

**What it is:** Codex's equivalent of Claude's `TodoWrite`. When the agent works on a multi-step problem, it publishes/updates a flat checklist:

```ts
interface TodoListItem {
  id: string;
  type: 'todoList';
  items: Array<{ text: string; completed: boolean }>;
}
```

Currently silently skipped in `event-mapper.ts`. The adapter's `'todo_list'` progress entry is dead text.

**Decision:** Hide from chat (parity with Claude `TodoWrite`). Codex emits `todoList` items → adapter calls `sink.onTodoUpdate(todos)` → daemon's `event-handler.ts:397-401` updates the per-chat `todos` field → renderer's `useChatsStore` picks it up via WebSocket broadcast → `TasksSection` (Context tab) displays it.

**Naming clarification — important:** the per-chat `chat.todos` field is **NOT the Todo plugin's database** (`~/.mainframe/plugins/todos/data.db`, used by the Kanban `TodosPanel`). It's a field on the chat object itself, persisted in the `chats` metadata table. The two systems are unrelated despite the name overlap.

**This is in todo #133** (updated to cover three sources: Claude V1 TodoWrite, Claude V2 TaskCreate/TaskUpdate, Codex todoList). Out of scope for this plan — handled by #133.

---

## Proposed mapping (assuming D1=A, D2=A, D3 follows-Claude, D4=A)

| Codex tool | Mapped card | Notes |
|---|---|---|
| `command_execution` | **U1 BashCard** | header: terminal icon + command; subheader: empty (Codex has no description); body: `aggregatedOutput`; status dot derived from `exitCode !== 0` |
| `file_change` (per-change, `kind === 'add'`) | **U3 WriteFileCard** | After parsing `change.diff` (unified diff) → `structuredPatch` shape that WriteFileCard already consumes |
| `file_change` (per-change, `kind === 'update' \| 'delete'`) | **U2 EditFileCard** | Same — parsed unified diff fed in as `structuredPatch` |
| `mcp__codex__<tool>` (after normalization) | **U15 MCPToolCard** | Existing wildcard catches it. Server displayed as "Codex" |
| `todo_list` | (hidden) | Routed to `TasksSection` in Context tab (out of scope here — see todo #133) |
| `turn/diff/updated` notification | **(out of scope or U2 ToolGroup)** | Optional: render as a "turn summary" card. Probably skip for v1 since per-change cards already cover it. |
| `item/fileChange/outputDelta` streaming | **(integrate with EditFileCard live state)** | Optional v2: streaming live-edit affordance. Skip for v1. |
| Anything else (future Codex tools) | **DefaultToolCard** fallback | Same as Claude default |

---

## Sub-plan breakdown (once decisions are confirmed)

If we proceed with the recommendations above:

### Plan F-A: Codex adapter parity

- Update `codex/adapter.ts` `getToolCategories()` to declare hidden/explore/subagent sets matching Codex semantics
- Update `codex/event-mapper.ts` to:
  - Normalize MCP tool names to `mcp__codex__<tool>` (or `mcp__<server>__<tool>` if server info is available in `McpToolCallItem`)
  - Optionally annotate `tool_use` blocks with category at emit time (if not already)
- Tests: adapter test covering the new categorization + event-mapper test for the MCP rename

### Plan F-B: Codex `file_change` → EditFileCard / WriteFileCard

Three sub-tasks since the data plumbing changes:

**F-B.1: Update `FileChangeItem` types**
- `packages/core/src/plugins/builtin/codex/types.ts:178-183` — add `diff: string` to each change, change `status` to `PatchApplyStatus` enum (`'inProgress' | 'completed' | 'failed' | 'declined'`)
- Regenerate or hand-update `PatchChangeKind` if Codex's `move_path` variant is needed (currently we only handle plain `add | delete | update`)

**F-B.2: Add unified-diff parser**
- New helper `packages/core/src/messages/parse-unified-diff.ts` — converts `"@@ -1,3 +1,3 @@\n-foo\n+bar\n ..."` → `Array<{ lines: string[]; oldStart?: number; newStart?: number }>` matching the `DiffHunk` shape that `EditFileCard` already consumes
- Tests covering: simple replace, add-only, delete-only, multi-hunk, empty diff
- Reuse existing `diff` package if available (search `pnpm-lock.yaml` for any diff-parser dependency we already pull in for Claude's `structuredPatch`); otherwise write the small custom parser

**F-B.3: Update event-mapper to emit one tool_use per file change**
- `packages/core/src/plugins/builtin/codex/event-mapper.ts:125-142` — instead of one `tool_use { name: 'file_change', input: { changes: [...] } }`, emit ONE tool_use per `change`:
  - `{ name: 'Edit' | 'Write', input: { file_path, ...parsed }, result: { structuredPatch: parsed } }` for each entry
  - Mapping: `kind === 'add'` → `Write`; `kind === 'update' | 'delete'` → `Edit`
  - This way the existing Claude `EditFileCard` / `WriteFileCard` handlers naturally take over with no render-side branching needed
- Decide: drop the `'turn/diff/updated'` and `'item/fileChange/outputDelta'` channels for v1 (not needed once per-file is wired). Leave the TODOs in place.

### Plan F-C: Wire `command_execution` to BashCard

- Desktop: add `case 'command_execution': return <BashCard ... />` to the dispatch in `render-tool-card.tsx`
- Mobile: same in `tools/index.tsx`
- BashCard prop adapter: Codex's `{ command, aggregatedOutput, exitCode }` → BashCard's expected `args.command`, `result.content`, `isError = exitCode !== 0`. Either:
  - Map at the dispatch point (simplest)
  - Or update BashCard to accept both shapes (cleaner but more code)
- Test: render BashCard with Codex-shaped data, confirm command + output + status dot all show correctly

### Plan F-D: Verification + changeset

- Workspace typecheck/test/build
- Single changeset covering all Codex unification work

---

## Open questions (please answer before we write tasks)

1. **D1, D2, D3, D4** — confirm the recommendations above OR pick alternatives.
2. Is Codex's `McpToolCallItem` actually exposing the source MCP server name? If yes, use it for the normalized name (`mcp__<actualServer>__<tool>`). If no, the generic `mcp__codex__<tool>` is the fallback.
3. Are Codex permission/approval items rendered inline in the chat stream or via a `BottomCard` (like Claude's `AskUserQuestion`)? This affects whether they need to be in `hidden`.
4. Are `webSearch` and `reasoning` Codex items intentionally skipped, or should they get cards too?
5. Branching strategy — new branch (`feat/codex-tool-cards`) off `main` after Claude PRs merge, or off `feat/tool-cards`? Recommend new branch off main once #262 lands.

Once answered, I'll convert this draft into a concrete Plan F-A through F-D with bite-sized tasks ready for `superpowers:subagent-driven-development`.
