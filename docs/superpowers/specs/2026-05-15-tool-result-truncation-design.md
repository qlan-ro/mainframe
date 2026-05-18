# Tool-Result Truncation + Expand-on-Demand

**Date:** 2026-05-15
**Todo:** #166 (assistant-ui message graph grows unbounded across long sessions)
**Related:** #178 (idle whole-chat offload — reuses the JSONL-read primitive defined here)

## Problem

The renderer's message graph grows monotonically across long sessions. The dominant
contributor is not message *count* (the zustand store already caps at 2000) but the
*size* of individual `tool_result` content strings: a single `Read` of a large file,
or verbose `Bash`/`Grep` output, holds the full payload as a string in the
`DisplayMessage` graph for the lifetime of the chat in memory.

## Goal

Shrink the client-facing copy of large `tool_result` content while preserving the
ability to view the full output on demand, with zero impact on functional behavior or
rendering correctness.

## Safety Analysis (why this is sound)

`tool_result.content` is consumed in two distinct places:

1. **Ingestion (functional)** — `packages/core/src/plugins/builtin/claude/events.ts`
   scans the *full* content at ingestion for PR URLs (`detected_prs`), plan-file paths
   (`Your plan has been saved to: …`), and Task IDs (`Task #N`). These run upstream of
   the display pipeline.
2. **Display (presentational)** — the `DisplayMessage` graph the renderer consumes.
   `content` is treated as opaque text. Diffs render from `structuredPatch` /
   `originalFile` / `modifiedFile` (or tool *arguments* for new-file writes), never
   from `result.content`. Images load via a separate API. `result.content` is used
   only for error display.

Because truncation happens in the **display pipeline — strictly downstream of
ingestion** — the functional parsers always see full content; only the client-facing
copy shrinks. The diff viewer (inline and full Monaco) never reads `result.content`,
so it is unaffected.

### Known limitation (recorded, out of scope)

`originalFile` / `modifiedFile` on Edit/Write results are full inlined file bodies and
are **not** truncated by this feature. A very large file edit still retains the full
modified body in the graph via `modifiedFile`. This is a separate, smaller memory
vector and a candidate follow-up; it is explicitly not in scope here.

## Design

### 1. Truncation in the display pipeline

Location: `toToolCallResult()` / `convertAssistantContent()` in
`packages/core/src/messages/display-helpers.ts`.

- Threshold: `Buffer.byteLength(content, 'utf8') > 32 * 1024`.
- Strategy: **head + tail** — first 100 lines + a marker
  `\n…[truncated N lines · M KB — expand]…\n` + last 100 lines. (Head+tail because
  command output often carries the important bits at the end — exit status, errors —
  while file reads carry them at the start.)
- Content at or below the threshold is passed through untouched with no flag.

Type change (single canonical definition in `@qlan-ro/mainframe-types`,
`ToolCallResult`):

- `truncated?: boolean`
- `fullBytes?: number`
- `toolUseId: string` (already present or added so the client can request the full
  payload)

The renderer detects truncation via the `truncated` flag, never by parsing the marker
text (avoids collision with user content).

### 2. Persisted session-file path

Schema: add `session_file_path TEXT` to the `chats` table via an idempotent inline
migration in `packages/core/src/db/schema.ts` (same pattern as existing column adds).

Populate at spawn/resume: when the CLI process is spawned and `claudeSessionId` + cwd
are unambiguously known (lifecycle-manager / claude session init), compute
`~/.claude/projects/<encoded(cwd)>/<claudeSessionId>.jsonl` once and persist it on the
chat row. Encoding matches the existing convention:
`cwd.replace(/[^a-zA-Z0-9-]/g, '-')`. `cwd` is the chat's `worktreePath` if set, else
the project path.

This column is the single source of truth for locating the transcript. It is immune
to later worktree removal or project moves, and #178 (offload cold-reload) reads the
same column — no path re-derivation anywhere.

### 3. Expand endpoint

`GET /api/chats/:id/tool-result/:toolUseId`

- Zod-validated params; `toolUseId` must match `^[a-zA-Z0-9_-]+$`.
- Read `session_file_path` from the chat row.
  - If null (legacy chats predating the column): derive from `worktreePath` → project
    path; on success, backfill the column.
- Stream-parse the JSONL, locate the `tool_result` block whose `tool_use_id` matches,
  return its full `content`.
- File missing (old/cleaned session) or id not found → `404` with a typed error body.

This endpoint is the shared JSONL-read primitive #178 will reuse for whole-graph
rebuild.

### 4. Renderer behavior & the memory invariant

Tool-result rendering components (`convert-message.ts` mapping plus the tool-result
display components, e.g. `WriteFileCard.tsx` / `EditFileCard.tsx` and the generic
result view) check `result.truncated`. When true:

- Render the truncated `content` plus a "Show full output" button labeled with
  `fullBytes` (e.g. "Show full output · 1.2 MB").
- On click → `GET /api/chats/:id/tool-result/:toolUseId` → swap to full content in
  **local component state only**. A "Collapse" control restores the truncated view and
  discards the fetched copy.
- Loading: spinner on the button while fetching. On `404`: button becomes disabled
  text "full output no longer available"; truncated view persists.

**Memory invariant (the point of the feature):** the full string is never written
back into `useChatsStore` or the assistant-ui graph. It lives only in the expanded
component's local state while mounted; unmount or collapse frees it. N truncated
results cost ~32 KB each in the store regardless of original size; only
currently-expanded results transiently hold their full payload.

## Testing

**Core (unit):**

- `toToolCallResult`: < 32 KB untouched, no flag; > 32 KB → head 100 + marker +
  tail 100 with `truncated`/`fullBytes`/`toolUseId` set; exact-boundary
  (32 KB ± 1 byte); non-string Task content (flattened) truncates correctly.
- Regression (safety guarantee): a Bash `tool_result` with a PR URL *past* the 32 KB
  mark still populates `detected_prs`; a plan-file path past the mark still tracked;
  `Task #N` past the mark still parsed. Proves truncation is downstream of ingestion.

**Core (integration):**

- Expand endpoint returns full content for a known `toolUseId` from a fixture JSONL;
  `404` when file missing and when id absent.
- `session_file_path` populated on spawn; legacy chat (null column) falls back to
  derivation and backfills.
- Schema migration idempotent (run twice, column added once, no error).

**Renderer:**

- Truncated result shows the expand button with size; click fetches + swaps; collapse
  restores; assert `useChatsStore` still holds only the truncated copy after expand
  (memory invariant).
- `404` → disabled "full output no longer available"; truncated view persists.

## Out of Scope

- Truncating `originalFile` / `modifiedFile` on large edits (known limitation above).
- Whole-chat offload lifecycle and JSONL cold-reload (todo #178; reuses the
  `session_file_path` column and the JSONL-read primitive defined here).
- Daemon-side message pagination / renderer virtualization.
