# Claude CLI JSONL Schema Reference

> ## ⚠️ SUBORDINATE — [`SESSIONS_JSONL.md`](SESSIONS_JSONL.md) is authoritative
>
> Where this file and `SESSIONS_JSONL.md` disagree, **`SESSIONS_JSONL.md`
> wins.** This one is an empirical survey of CLI **2.0.76 – 2.1.34** session
> files; `SESSIONS_JSONL.md` is derived from the 2026-03-31 source leak
> reconciled against the installed **v2.1.220**, and its entry union and drift
> table are current.
>
> Known ways this file is behind: it predates the `permission-mode` and
> `relocated` entry types, `last-prompt.leafUuid`, and the
> `agent-*.meta.json` `toolUseId`/`spawnDepth` fields; its entry-type table is
> incomplete against the leaked `Entry` union; and it does not know that a
> worktree session's transcript relocates.
>
> **Read it for** what `SESSIONS_JSONL.md` does not carry: observed field
> *frequencies* across 850+ real files, and worked examples of payload shapes.
> Those are empirical and still useful. Treat the schema claims as dated.
>
> **Provenance:** lost in a history rewrite and recovered from unreachable git
> objects on 2026-07-25 (todo #241); byte-identical to `git show
> 75badd35:docs/adapters/claude/CLAUDE-JSONL-SCHEMA.md` apart from this banner.

Reference for all data available in Claude Code's session JSONL files (`~/.claude/projects/<encoded-path>/<session-id>.jsonl`). Derived from auditing 850+ session files across CLI versions 2.0.76 through 2.1.34.

## File Location

```
~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
~/.claude/projects/<encoded-project-path>/<session-id>/subagents/agent-a<hex-id>.jsonl
```

The encoded project path replaces `/` with `-` (e.g. `/Users/foo/project` becomes `-Users-foo-project`).

---

## Entry Types

| Type | Purpose | Frequency |
|------|---------|-----------|
| `assistant` | Model response blocks (1 content block per entry) | ~40% |
| `user` | User messages + tool results | ~25% |
| `progress` | Real-time progress updates (bash, hooks, MCP, subagents, search) | ~30% |
| `system` | Turn duration, compaction, errors, commands | ~2% |
| `file-history-snapshot` | File backup checkpoints | ~3% |
| `queue-operation` | Message queue management (enqueue/dequeue/remove/popAll) | rare |
| `summary` | Conversation branch labels | rare |
| `tool_use` | Standalone tool invocation (v2.0.x legacy format) | legacy only |
| `tool_result` | Standalone tool result (v2.0.x legacy format) | legacy only |

---

## Common Fields (present on most entry types)

| Field | Type | Description |
|-------|------|-------------|
| `uuid` | `string` | Unique entry ID |
| `parentUuid` | `string\|null` | Previous entry in chain (`null` at roots/compaction boundaries) |
| `timestamp` | `string` | ISO 8601 timestamp |
| `sessionId` | `string` | Session UUID |
| `cwd` | `string` | Working directory at time of entry |
| `gitBranch` | `string` | Git branch at time of entry (empty string if not in repo) |
| `isSidechain` | `boolean` | `true` for subagent conversations |
| `userType` | `string` | Always `"external"` |
| `slug` | `string` | Human-readable session name (`adjective-verb-noun`) |
| `version` | `string` | Claude CLI version |

---

## Entry Type: `assistant`

One entry per content block. A single API response with `[thinking, text, tool_use]` becomes 3 separate entries sharing the same `requestId` and `message.id`.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Groups entries from same API request. Key for reassembling complete turns. |
| `message` | `object` | Full Anthropic API message object |
| `agentId` | `string?` | Subagent identifier (hex, e.g. `"a3ac50c"`) — only on sidechain entries |
| `error` | `string?` | API error type (e.g. `"invalid_request"`) |
| `isApiErrorMessage` | `boolean?` | `true` for synthetic error messages |

### `message` sub-fields

| Field | Type | Description |
|-------|------|-------------|
| `message.id` | `string` | Anthropic message ID (e.g. `msg_01Yb81PSr...`). Same across entries from same API request. |
| `message.model` | `string` | Model that generated the response (see Model IDs below). `"<synthetic>"` for local error messages. |
| `message.role` | `string` | Always `"assistant"` |
| `message.type` | `string` | Always `"message"` |
| `message.content` | `array` | Always exactly 1 block per entry (see Content Blocks below) |
| `message.usage` | `object` | Token usage data (see Usage Object below) |
| `message.stop_reason` | `string\|null` | Usually `null` (streaming). `"stop_sequence"` on synthetic entries. |
| `message.stop_sequence` | `string\|null` | Usually `null` |

### Content blocks (`message.content[0]`)

#### `text`
```json
{ "type": "text", "text": "Here's the implementation..." }
```

#### `thinking`
```json
{
  "type": "thinking",
  "thinking": "The user wants me to...",
  "signature": "<base64 cryptographic signature>"
}
```

#### `tool_use`
```json
{
  "type": "tool_use",
  "id": "toolu_01ABC...",
  "name": "Edit",
  "input": { "file_path": "/path/to/file", "old_string": "...", "new_string": "..." }
}
```

### Usage object (`message.usage`)

```json
{
  "input_tokens": 1234,
  "output_tokens": 567,
  "cache_creation_input_tokens": 20369,
  "cache_read_input_tokens": 15000,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 20369,
    "ephemeral_1h_input_tokens": 0
  },
  "server_tool_use": {
    "web_search_requests": 0,
    "web_fetch_requests": 0
  },
  "service_tier": "standard",
  "inference_geo": "not_available"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `input_tokens` | `int` | Non-cached input tokens |
| `output_tokens` | `int` | Output tokens generated |
| `cache_creation_input_tokens` | `int` | Total tokens written to cache |
| `cache_read_input_tokens` | `int` | Tokens read from cache |
| `cache_creation.ephemeral_5m_input_tokens` | `int` | 5-minute cache tokens |
| `cache_creation.ephemeral_1h_input_tokens` | `int` | 1-hour cache tokens |
| `server_tool_use.web_search_requests` | `int` | Anthropic server-side web search count |
| `server_tool_use.web_fetch_requests` | `int` | Anthropic server-side web fetch count |
| `service_tier` | `string\|null` | `"standard"` or `null` |
| `inference_geo` | `string\|null` | Geographic inference location |

### Model IDs observed

- `claude-opus-4-6`
- `claude-opus-4-5-20251101`
- `claude-opus-4-1-20250805`
- `claude-sonnet-4-5-20250929`
- `claude-haiku-4-5-20251001`
- `<synthetic>` (locally generated error messages)

---

## Entry Type: `user`

Contains user-typed messages and tool results. Tool result entries have rich `toolUseResult` metadata.

### Top-level fields

| Field | Type | Presence | Description |
|-------|------|----------|-------------|
| `message` | `object` | 100% | `{ role: "user", content: string \| array }` |
| `toolUseResult` | `object\|string\|list` | ~93% | Rich structured tool result (absent on direct user messages) |
| `sourceToolAssistantUUID` | `string` | ~93% | UUID of the assistant entry that triggered this tool result |
| `sourceToolUseID` | `string` | ~93% | Tool use ID that triggered this entry |
| `permissionMode` | `string` | ~5% | Permission mode: `"default"`, `"bypassPermissions"` |
| `thinkingMetadata` | `object` | ~5% | `{ level, disabled, triggers, maxThinkingTokens }` |
| `imagePasteIds` | `number[]` | rare | Indices of pasted images |
| `isCompactSummary` | `boolean` | rare | Entry is a compaction summary |
| `isVisibleInTranscriptOnly` | `boolean` | rare | Not sent to model, transcript only |
| `planContent` | `string` | rare | Full plan markdown when executing via ExitPlanMode |
| `todos` | `array` | rare | Current todo list state at message time |
| `mcpMeta` | `object` | rare | MCP structured content: `{ _meta: { tool, _request_id }, structuredContent }` |

### `message.content` variants

**String content** (direct user messages): plain text, or XML-tagged commands:
```xml
<command-name>/clear</command-name>
<command-message>clear</command-message>
<command-args></command-args>
```

**In-chat slash commands** sent via stdin use this XML format. Two commands work in-chat:
- `/clear` — clears conversation history (full context reset)
- `/compact` — compresses context (keeps summary)

The `/clear` command produces these JSONL entries in sequence:
1. `user` entry with `<local-command-caveat>` (meta, `isMeta: true`)
2. `user` entry with `<command-name>/clear</command-name>` (the command itself)
3. `user` entry with `<local-command-stdout></local-command-stdout>` (command output, usually empty)

**Array content** (tool results): list of `tool_result` blocks:
```json
{
  "tool_use_id": "toolu_01ABC...",
  "type": "tool_result",
  "content": "The file was updated successfully.",
  "is_error": false
}
```

The `content` field inside tool_result can be a `string` or a `list` of `{ type: "text", text }` and `{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }` blocks.

---

## `toolUseResult` Shapes by Tool

### Edit

```json
{
  "filePath": "/absolute/path/to/file.ts",
  "oldString": "original text",
  "newString": "replacement text",
  "originalFile": "complete file content before edit",
  "replaceAll": false,
  "userModified": false,
  "structuredPatch": [
    {
      "oldStart": 25,
      "oldLines": 7,
      "newStart": 25,
      "newLines": 7,
      "lines": [
        " context line",
        "-removed line",
        "+added line",
        " context line"
      ]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filePath` | `string` | Absolute path to edited file |
| `oldString` | `string` | Text that was replaced |
| `newString` | `string` | Replacement text |
| `originalFile` | `string` | Complete file content BEFORE the edit |
| `replaceAll` | `boolean` | Whether replace_all was used |
| `userModified` | `boolean` | Whether user modified the edit (via permission override) |
| `structuredPatch` | `DiffHunk[]` | Unified diff hunks (see below) |

### Write

```json
{
  "type": "create",
  "filePath": "/absolute/path/to/new-file.ts",
  "content": "new file content",
  "originalFile": "previous file content (empty for create)",
  "structuredPatch": [ ... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | `"create"` for new files, `"update"` for overwrites |
| `filePath` | `string` | Absolute path |
| `content` | `string` | Written content |
| `originalFile` | `string` | Previous content (empty string for new files) |
| `structuredPatch` | `DiffHunk[]` | Unified diff hunks (present on `"update"` type) |

### Read

```json
{
  "type": "text",
  "file": {
    "filePath": "/absolute/path/to/file.ts",
    "content": "file content (possibly truncated)",
    "numLines": 50,
    "startLine": 1,
    "totalLines": 300
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `file.filePath` | `string` | Absolute path |
| `file.content` | `string` | File content (may be partial) |
| `file.numLines` | `int` | Number of lines returned |
| `file.startLine` | `int` | Starting line number (1-based) |
| `file.totalLines` | `int` | Total lines in file |

### Bash

```json
{
  "stdout": "command output here",
  "stderr": "error output if any",
  "interrupted": false,
  "isImage": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `stdout` | `string` | Standard output |
| `stderr` | `string` | Standard error |
| `interrupted` | `boolean` | Whether command was interrupted/timed out |
| `isImage` | `boolean` | Whether output contains image data |

### Glob

```json
{
  "filenames": ["/path/to/match1.ts", "/path/to/match2.ts"],
  "numFiles": 2,
  "durationMs": 45,
  "truncated": false
}
```

### Grep

```json
{
  "filenames": ["/path/to/match.ts"],
  "numFiles": 1,
  "mode": "files_with_matches",
  "content": "matching content lines (when mode=content)",
  "numLines": 15
}
```

### TaskCreate

```json
{
  "task": { "id": "1", "subject": "Implement feature X" }
}
```

### TaskUpdate

```json
{
  "success": true,
  "taskId": "1",
  "updatedFields": ["status"],
  "statusChange": { "from": "pending", "to": "in_progress" }
}
```

### AskUserQuestion

Plain text result:
```
User has answered your questions: "Do you prefer X or Y?"="X", "Which approach?"="Option A". You can now continue with the user's answers in mind.
```

### MCP tools

Array of content blocks:
```json
[
  { "type": "text", "text": "result text" },
  { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
]
```

### Error results

Plain string: `"Error: File does not exist."`, `"Sibling tool call errored"`, etc.

---

## DiffHunk Format

Used by both Edit and Write `structuredPatch` fields. Follows unified diff conventions.

```typescript
interface DiffHunk {
  oldStart: number;   // Starting line in original file
  oldLines: number;   // Number of lines in original
  newStart: number;   // Starting line in new file
  newLines: number;   // Number of lines in new
  lines: string[];    // Prefixed lines: "+" added, "-" removed, " " context
}
```

Each line in `lines` has a single-character prefix:
- `+` — added line
- `-` — removed line
- ` ` (space) — unchanged context line

---

## Entry Type: `progress`

Real-time progress updates during tool execution. Linked to tool invocations via `toolUseID`.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `toolUseID` | `string` | UUID of the tool invocation this progress belongs to |
| `parentToolUseID` | `string` | Parent tool invocation (for nested tools) |
| `data` | `object` | Progress payload (subtyped by `data.type`) |

### `data.type` variants

#### `bash_progress`

```json
{
  "type": "bash_progress",
  "output": "recent output (tail window)",
  "fullOutput": "complete accumulated stdout/stderr",
  "totalLines": 42,
  "elapsedTimeSeconds": 3.2,
  "timeoutMs": 120000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `output` | `string` | Recent/tail output (scrolling window) |
| `fullOutput` | `string` | Complete accumulated output |
| `totalLines` | `int` | Total output lines so far |
| `elapsedTimeSeconds` | `float` | Wall-clock time elapsed |
| `timeoutMs` | `int` | Configured timeout |

#### `hook_progress`

```json
{
  "type": "hook_progress",
  "hookEvent": "PostToolUse",
  "hookName": "PostToolUse:Edit",
  "command": "callback"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `hookEvent` | `string` | `"SessionStart"` or `"PostToolUse"` |
| `hookName` | `string` | Full hook identifier |
| `command` | `string` | Shell command or `"callback"` |

#### `mcp_progress`

```json
{
  "type": "mcp_progress",
  "status": "started",
  "serverName": "electron-mcp-server",
  "toolName": "take_screenshot",
  "elapsedTimeMs": 1234
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `"started"` or `"completed"` |
| `serverName` | `string` | MCP server name |
| `toolName` | `string` | MCP tool name |
| `elapsedTimeMs` | `int` | Only on `"completed"` entries |

#### `agent_progress`

```json
{
  "type": "agent_progress",
  "agentId": "a59dac3",
  "prompt": "original prompt given to the subagent",
  "message": {
    "type": "assistant",
    "timestamp": "...",
    "message": { "role": "assistant", "content": [...] }
  },
  "normalizedMessages": [...]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string` | Short hex subagent ID |
| `prompt` | `string` | Original prompt to subagent |
| `message` | `object` | Full entry-like object streaming the subagent's conversation |
| `normalizedMessages` | `array` | Accumulated message history |

#### `query_update`

```json
{ "type": "query_update", "query": "React useEffect cleanup pattern" }
```

#### `search_results_received`

```json
{ "type": "search_results_received", "resultCount": 10, "query": "React useEffect cleanup pattern" }
```

#### `waiting_for_task`

```json
{ "type": "waiting_for_task", "taskDescription": "Research auth patterns", "taskType": "Explore" }
```

---

## Entry Type: `system`

Metadata entries for turn timing, compaction, errors, and commands.

### `subtype` variants

#### `turn_duration`

```json
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 138852
}
```

#### `compact_boundary`

Full conversation compaction. Breaks the parent-child chain (`parentUuid: null`).

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "level": "info",
  "logicalParentUuid": "abc-123",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167637
  }
}
```

#### `microcompact_boundary`

Selective tool result clearing. Stays in parent-child chain.

```json
{
  "type": "system",
  "subtype": "microcompact_boundary",
  "content": "Context microcompacted",
  "microcompactMetadata": {
    "trigger": "auto",
    "preTokens": 59440,
    "tokensSaved": 34336,
    "compactedToolIds": ["toolu_01Xat...", "toolu_01TuF..."],
    "clearedAttachmentUUIDs": []
  }
}
```

#### `api_error`

```json
{
  "type": "system",
  "subtype": "api_error",
  "level": "error",
  "error": "{status: 529, headers: {...}}",
  "retryInMs": 538.28,
  "retryAttempt": 1,
  "maxRetries": 10
}
```

#### `local_command`

Slash command execution. Recorded for commands executed locally (terminal-based commands like `/mcp`, `/permissions`, `/hooks`). In-chat commands (`/clear`, `/compact`) are recorded as `user` entries with XML-tagged content instead.

```json
{
  "type": "system",
  "subtype": "local_command",
  "content": "<command-name>/mcp</command-name>\n<command-message>mcp</command-message>",
  "level": "info"
}
```

Commands that produce `local_command` entries: `/mcp`, `/permissions`, `/hooks`, `/config`, etc.
Commands that produce `user` entries with XML tags: `/clear`, `/compact`.

#### `stop_hook_summary`

```json
{
  "type": "system",
  "subtype": "stop_hook_summary",
  "hookCount": 2,
  "hookInfos": [{ "command": "bun script.cjs start" }],
  "hookErrors": [],
  "preventedContinuation": false,
  "hasOutput": true,
  "toolUseID": "f520e5c8-..."
}
```

---

## Entry Type: `file-history-snapshot`

```json
{
  "type": "file-history-snapshot",
  "messageId": "uuid-of-accompanying-message",
  "isSnapshotUpdate": true,
  "snapshot": {
    "messageId": "same-uuid",
    "timestamp": "2026-02-06T16:10:00.000Z",
    "trackedFileBackups": {
      "/path/to/file.ts": {
        "backupFileName": "file.ts.bak",
        "version": 3,
        "backupTime": "2026-02-06T16:10:00.000Z"
      }
    }
  }
}
```

Grows incrementally. `isSnapshotUpdate: false` for initial snapshot, `true` for updates.

---

## Entry Type: `queue-operation`

Message queue management when user types while Claude is busy.

| Operation | Has Content? | Description |
|-----------|-------------|-------------|
| `enqueue` | Yes — the queued user message | User typed while busy |
| `dequeue` | No | Message taken from queue |
| `remove` | No | Message removed |
| `popAll` | Yes — last queued message | All queued messages consumed |

The `enqueue` content for error cases contains a JSON payload with `total_cost_usd`, full `usage` breakdown, `duration_ms`, `num_turns`, `stop_reason`.

---

## Entry Type: `summary`

```json
{
  "type": "summary",
  "summary": "Fix Add Project Button IPC Integration",
  "leafUuid": "62dd6e12-..."
}
```

Labels conversation branches. `leafUuid` points to the conversation leaf this summary describes.

---

## Cross-Entry Relationships

### Parent-child chain
Every entry has `uuid` and `parentUuid`. The chain is fully connected and traversable as a tree. `parentUuid: null` at session start and after `compact_boundary` entries. `logicalParentUuid` preserves the logical link across compaction boundaries.

### `requestId` grouping (assistant entries)
Groups all content blocks from a single API request. One API call may produce multiple entries (thinking + text + tool_use). All share the same `requestId` and `message.id`.

### `sourceToolAssistantUUID` (user tool result entries)
Links tool result entries back to the assistant entry that invoked the tool. 100% match rate in tested sessions.

### `sourceToolUseID` (user tool result entries)
The specific `tool_use` block ID that triggered this result. Matches the `id` field inside the `tool_use` content block.

### `toolUseID` (progress entries)
Links progress updates to the tool invocation they report on.

---

## Subagent Files

Subagent conversations are stored in separate JSONL files:

```
<session-id>/subagents/agent-a<hex-id>.jsonl
<session-id>/subagents/agent-acompact-<hex-id>.jsonl
<session-id>/subagents/agent-aprompt_suggestion-<hex-id>.jsonl
```

| Pattern | Purpose | Typical size |
|---------|---------|-------------|
| `agent-a<hex>` | Standard subagent | 2-50 entries |
| `agent-acompact-<hex>` | Compact/summary subagent | small |
| `agent-aprompt_suggestion-<hex>` | Prompt suggestion | 3 entries (user, assistant, assistant) |

Same entry format as main sessions. First entry is always `user` type with `isSidechain: true` and `agentId`.

---

## Tool Inventory

### Built-in tools

| Tool | Input Keys |
|------|-----------|
| `Read` | `file_path`, `limit?`, `offset?` |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all?` |
| `Write` | `file_path`, `content` |
| `Bash` | `command`, `description?`, `timeout?` |
| `Glob` | `pattern`, `path?` |
| `Grep` | `pattern`, `path?`, `output_mode?`, `type?`, `glob?` |
| `Task` | `description`, `prompt`, `subagent_type?` |
| `TaskCreate` | `subject`, `description`, `activeForm?` |
| `TaskUpdate` | `taskId`, `status?`, `subject?`, `description?` |
| `TaskList` | (empty) |
| `TaskGet` | `taskId` |
| `TaskOutput` | `task_id`, `block?`, `timeout?` |
| `TaskStop` | `task_id` |
| `AskUserQuestion` | `questions: [{ question, header, options: [{ label, description }], multiSelect }]` |
| `TodoWrite` | `todos: [{ content, status, activeForm }]` |
| `WebSearch` | `query` |
| `WebFetch` | `url`, `prompt` |
| `Skill` | `skill`, `args?` |
| `EnterPlanMode` | (empty) |
| `ExitPlanMode` | `plan?`, `allowedPrompts?: [{ tool, prompt }]` |
| `KillShell` | `shell_id` |
| `ListMcpResourcesTool` | (empty) |

### Tool result formats (plain string)

| Tool | Result format |
|------|--------------|
| `AskUserQuestion` | `"User has answered your questions: \"Q1\"=\"A1\", \"Q2\"=\"A2\". You can now continue..."` |
| `TodoWrite` | `"Todos have been modified successfully..."` |
| `EnterPlanMode` | `"Entered plan mode. You should now focus on exploring..."` |
| `Skill` | `"Launching skill: <name>"` |
| `TaskCreate` | `"Task #1 created successfully: <subject>"` |
| `KillShell` | `{ "message": "Successfully killed shell: ...", "shell_id": "..." }` |

---

## What Mainframe Currently Extracts vs What's Available

### Currently used

- `entry.type` (user/assistant only)
- `entry.uuid`, `entry.timestamp`
- `entry.message.content` (text, tool_use, tool_result, thinking blocks)
- `entry.toolUseResult.structuredPatch` (Edit only, just added)

### Not yet used — high value

| Field | Feature it enables |
|-------|-------------------|
| `requestId` | Proper turn reassembly (instead of positional merging) |
| `message.usage` | Per-turn token counts, cost tracking, context window visualization |
| `message.model` | Model display per response |
| `toolUseResult.originalFile` | Before/after diff without filesystem access |
| `toolUseResult` (Read) `.file.*` | Show partial read context (lines X-Y of Z) |
| `toolUseResult` (Bash) `.stdout/.stderr/.interrupted` | Rich terminal output rendering |
| `toolUseResult` (Write) `.structuredPatch` | Diff rendering for file creates/updates |
| `toolUseResult` (Glob/Grep) | File search results with metadata |
| `toolUseResult` (TaskUpdate) `.statusChange` | Task status transitions |
| `sourceToolAssistantUUID` | Reliable tool result to tool_use linking |
| `progress` (bash_progress) | Live terminal output streaming |
| `progress` (agent_progress) | Subagent conversation streaming |
| `progress` (mcp_progress) | MCP tool execution timing |
| `progress` (query_update/search_results_received) | Web search progress |
| `system` (turn_duration) | Turn timing for performance metrics |
| `system` (api_error) | Retry status and error display |
| `system` (compact/microcompact) | Compaction markers in UI, token counts |
| `queue-operation` | "Message queued" indicator |
| `file-history-snapshot` | File version history / undo support |
| `cwd` / `gitBranch` | Per-message working directory and branch context |
| `summary` | Conversation branch labels |
