# Mainframe API Reference

> Complete HTTP REST and WebSocket API documentation for `@qlan-ro/mainframe-core`

**Base URL**: `http://127.0.0.1:31415`
**WebSocket**: `ws://127.0.0.1:31415` (upgrades on the same HTTP port)

## Response Format

All REST endpoints return a standard envelope:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

---

## REST API

### Health Check

```
GET /health
```

Returns daemon health status.

**Response**: `{ status: 'ok', timestamp: string }`

---

### Projects

#### List Projects

```
GET /api/projects
```

Returns all registered projects, ordered by last opened.

**Response**: `ApiResponse<Project[]>`

```json
{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "name": "my-project",
      "path": "/Users/me/Projects/my-project",
      "createdAt": "2026-02-01T00:00:00.000Z",
      "lastOpenedAt": "2026-02-14T12:00:00.000Z"
    }
  ]
}
```

#### Get Project

```
GET /api/projects/:id
```

**Response**: `ApiResponse<Project>`

#### Create Project

```
POST /api/projects
Content-Type: application/json
```

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Absolute filesystem path |
| `name` | string | No | Display name (defaults to directory name) |

Returns 409 if a project with the same path already exists.

**Response**: `ApiResponse<Project>`

#### Delete Project

```
DELETE /api/projects/:id
```

Removes the project registration. Does not delete files.

**Response**: `ApiResponse<void>`

---

### Chats

#### List Chats

```
GET /api/projects/:projectId/chats
```

Returns all chats for a project.

**Response**: `ApiResponse<Chat[]>`

```json
{
  "success": true,
  "data": [
    {
      "id": "chat_xyz",
      "adapterId": "claude",
      "projectId": "abc123",
      "title": "Fix authentication bug",
      "claudeSessionId": "session_abc",
      "model": "claude-sonnet-4-5-20250929",
      "permissionMode": "default",
      "status": "active",
      "processState": "idle",
      "createdAt": "2026-02-14T10:00:00.000Z",
      "updatedAt": "2026-02-14T10:05:00.000Z",
      "totalCost": 0.0342,
      "totalTokensInput": 12400,
      "totalTokensOutput": 3200,
      "lastContextTokensInput": 8000,
      "worktreePath": null,
      "branchName": null
    }
  ]
}
```

#### Get Chat

```
GET /api/chats/:id
```

**Response**: `ApiResponse<Chat>`

#### Get Chat Messages

```
GET /api/chats/:id/messages
```

Returns display messages from daemon memory. Messages are ephemeral — they only exist while the daemon is running and the chat has been loaded.

**Response**: `ApiResponse<DisplayMessage[]>`

```json
{
  "success": true,
  "data": [
    {
      "id": "msg_001",
      "chatId": "chat_xyz",
      "type": "user",
      "content": [{ "type": "text", "text": "Fix the login bug" }],
      "timestamp": "2026-02-14T10:01:00.000Z"
    },
    {
      "id": "msg_002",
      "chatId": "chat_xyz",
      "type": "assistant",
      "content": [
        { "type": "thinking", "thinking": "Let me look at the auth module..." },
        { "type": "text", "text": "I'll fix the login bug." },
        {
          "type": "tool_call",
          "id": "tu_01",
          "name": "Read",
          "input": { "file_path": "/src/auth.ts" },
          "category": "explore"
        }
      ],
      "timestamp": "2026-02-14T10:01:05.000Z"
    }
  ]
}
```

#### Archive Chat

```
POST /api/chats/:id/archive
```

Kills the CLI process (if running) and sets status to `archived`.

**Response**: `ApiResponse<void>`

#### Unarchive Chat

```
POST /api/chats/:id/unarchive
```

Sets the chat status back to `active`.

**Response**: `ApiResponse<Chat>`

#### Get Pending Permission

```
GET /api/chats/:id/pending-permission
```

Returns the current pending permission request (front of queue), or `null`.

**Response**: `ApiResponse<PermissionRequest | null>`

```json
{
  "success": true,
  "data": {
    "requestId": "req_001",
    "toolName": "Bash",
    "toolUseId": "tu_02",
    "input": { "command": "npm install express" },
    "suggestions": ["Bash(npm install *)"]
  }
}
```

#### Get Chat Changes

```
GET /api/chats/:id/changes
```

Returns files modified during this chat session.

**Response**: `{ files: string[] }`

#### Get Session Context

```
GET /api/chats/:id/context
```

Returns the full session context including context files, mentions, attachments, and modified files.

**Response**: `ApiResponse<SessionContext>`

```json
{
  "success": true,
  "data": {
    "globalFiles": [{ "path": "~/.claude/CLAUDE.md", "content": "...", "source": "global" }],
    "projectFiles": [{ "path": "CLAUDE.md", "content": "...", "source": "project" }],
    "mentions": [],
    "attachments": [],
    "modifiedFiles": ["src/auth.ts"],
    "skillFiles": []
  }
}
```

#### Add Mention

```
POST /api/chats/:id/mentions
Content-Type: application/json
```

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `'file' \| 'agent'` | Yes | Mention type |
| `name` | string | Yes | Display name |
| `path` | string | No | File path (for file mentions) |

**Response**: `ApiResponse<SessionMention>`

#### Get Session File Content

```
GET /api/chats/:id/session-file?path=<relative-path>
```

Reads a file from the chat's effective working directory (worktree path or project path).

**Response**: `{ path: string, content: string }`

---

### Attachments

#### Upload Attachments

```
POST /api/chats/:id/attachments
Content-Type: application/json
```

**Body**:

```json
{
  "attachments": [
    {
      "name": "screenshot.png",
      "mediaType": "image/png",
      "sizeBytes": 102400,
      "data": "<base64-encoded>",
      "kind": "image",
      "originalPath": "/tmp/screenshot.png"
    }
  ]
}
```

**Limits**:
- Max 10 attachments per upload
- Max 5MB per attachment

**Response**: `ApiResponse<{ attachments: SessionAttachment[] }>`

#### Get Attachment

```
GET /api/chats/:chatId/attachments/:attachmentId
```

Returns attachment metadata and data.

**Response**: `SessionAttachment` with data

---

### File System

All project file system endpoints accept an optional `chatId` query parameter. When provided and the chat has a worktree, operations use the worktree path instead of the project path.

#### Browse Filesystem

```
GET /api/filesystem/browse?path=<absolute-path>
```

Browses directories within the user's home directory. Returns only non-hidden, non-ignored subdirectories. Defaults to the home directory when `path` is omitted.

**Response**:

```json
{ "path": "/Users/me/Projects", "entries": [{ "name": "my-project", "path": "/Users/me/Projects/my-project" }] }
```

#### File Tree

```
GET /api/projects/:id/tree?path=<relative-dir>&chatId=<optional>
```

Returns directory entries, filtered (hides dotfiles and `node_modules`), sorted directories-first.

**Response**:

```json
[
  { "name": "src", "type": "directory", "path": "src" },
  { "name": "package.json", "type": "file", "path": "package.json" }
]
```

#### File Content

```
GET /api/projects/:id/files?path=<relative-path>&chatId=<optional>&encoding=<optional>
```

Returns file content. Pass `encoding=base64` to receive binary files (max 10MB); default is UTF-8 text (max 2MB).

**Response**: `{ path: string, content: string }` — or `{ path: string, content: string, encoding: 'base64' }` for base64.

#### File Search

```
GET /api/projects/:id/search/files?q=<query>&limit=50&chatId=<optional>
```

Searches file names with substring + fuzzy matching. Minimum query length: 1 character.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search query |
| `limit` | number | 50 | Max results (max 200) |
| `chatId` | string | — | Use chat's worktree path |

**Response**:

```json
[
  { "name": "auth.ts", "path": "src/auth.ts", "type": "file" }
]
```

#### Flat File Listing

```
GET /api/projects/:id/files-list?limit=5000&chatId=<optional>
```

Returns all file paths in the project (up to limit), excluding common ignore patterns.

**Response**: `string[]`

---

### Git

#### Git Status

```
GET /api/projects/:id/git/status?chatId=<optional>
```

**Response**:

```json
{
  "files": [
    { "status": "M", "path": "src/auth.ts" },
    { "status": "??", "path": "src/new-file.ts" },
    { "status": "R", "path": "src/new-name.ts", "oldPath": "src/old-name.ts" }
  ]
}
```

#### Git Branch

```
GET /api/projects/:id/git/branch?chatId=<optional>
```

**Response**: `{ branch: string | null }`

#### Diff

```
GET /api/projects/:id/diff?file=<path>&source=git|session&oldPath=<optional>&chatId=<optional>
```

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | string | — | Specific file to diff |
| `source` | `'git' \| 'session'` | `'git'` | Diff source |
| `oldPath` | string | — | Original path for renames |
| `chatId` | string | — | Chat ID for worktree context |

**`source=git`**: Returns `git diff` output plus original/modified file contents.

```json
{
  "diff": "--- a/src/auth.ts\n+++ b/src/auth.ts\n...",
  "original": "// original content",
  "modified": "// modified content",
  "source": "git"
}
```

**`source=session`** (no file): Returns list of files modified in the session.

```json
{ "files": ["src/auth.ts", "src/login.ts"], "source": "session" }
```

**`source=session`** (with file): Returns original (from HEAD) and current file content.

```json
{
  "original": "// from git HEAD",
  "modified": "// current content",
  "source": "session",
  "file": "src/auth.ts"
}
```

---

### Adapters

#### List Adapters

```
GET /api/adapters
```

Returns all registered adapters with installation status.

**Response**: `ApiResponse<AdapterInfo[]>`

```json
{
  "success": true,
  "data": [
    {
      "id": "claude",
      "name": "Claude CLI",
      "description": "Anthropic Claude Code CLI",
      "installed": true,
      "version": "1.0.23"
    }
  ]
}
```

---

### Skills

#### List Skills

```
GET /api/adapters/:adapterId/skills?projectPath=<path>
```

**Response**: `ApiResponse<Skill[]>`

#### Create Skill

```
POST /api/adapters/:adapterId/skills
Content-Type: application/json
```

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectPath` | string | Yes | Project directory path |
| `name` | string | Yes | Skill identifier |
| `displayName` | string | No | Human-readable name |
| `description` | string | No | Skill description |
| `content` | string | No | Skill file content |
| `scope` | `'project' \| 'global'` | No | Skill scope |

**Response**: `ApiResponse<Skill>`

#### Update Skill

```
PUT /api/adapters/:adapterId/skills/:id
Content-Type: application/json
```

**Body**: `{ projectPath: string, content: string }`

**Response**: `ApiResponse<Skill>`

#### Delete Skill

```
DELETE /api/adapters/:adapterId/skills/:id?projectPath=<path>
```

**Response**: `ApiResponse<void>`

---

### Agents (Subagent Configs)

#### List Agents

```
GET /api/adapters/:adapterId/agents?projectPath=<path>
```

**Response**: `ApiResponse<AgentConfig[]>`

#### Create Agent

```
POST /api/adapters/:adapterId/agents
Content-Type: application/json
```

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectPath` | string | Yes | Project directory path |
| `name` | string | Yes | Agent identifier |
| `description` | string | No | Agent description |
| `content` | string | No | Agent config content |
| `scope` | `'project' \| 'global'` | No | Agent scope |

**Response**: `ApiResponse<AgentConfig>`

#### Update Agent

```
PUT /api/adapters/:adapterId/agents/:id
Content-Type: application/json
```

**Body**: `{ projectPath: string, content: string }`

**Response**: `ApiResponse<AgentConfig>`

#### Delete Agent

```
DELETE /api/adapters/:adapterId/agents/:id?projectPath=<path>
```

**Response**: `ApiResponse<void>`

---

### Settings

#### Get General Settings

```
GET /api/settings/general
```

Returns general application settings merged with defaults.

**Response**: `ApiResponse<Record<string, unknown>>`

#### Update General Settings

```
PUT /api/settings/general
Content-Type: application/json
```

**Response**: `ApiResponse<void>`

#### Get Provider Settings

```
GET /api/settings/providers
```

Returns per-adapter default settings.

**Response**:

```json
{
  "success": true,
  "data": {
    "claude": {
      "defaultModel": "claude-sonnet-4-5-20250929",
      "defaultMode": "default"
    }
  }
}
```

#### Update Provider Settings

```
PUT /api/settings/providers/:adapterId
Content-Type: application/json
```

**Body**:

| Field | Type | Description |
|-------|------|-------------|
| `defaultModel` | string | Default model for new chats |
| `defaultMode` | `'default' \| 'acceptEdits' \| 'plan' \| 'yolo'` | Default permission mode |
| `planExecutionMode` | `'default' \| 'acceptEdits' \| 'yolo'` | Execution mode after ExitPlanMode approval |
| `executablePath` | string | Path to the adapter CLI binary |

**Response**: `ApiResponse<void>`

#### Config Conflicts

```
GET /api/adapters/:adapterId/config-conflicts
```

Detects conflicts between Mainframe settings and the adapter's native config. Currently only checks Claude CLI's `~/.claude/settings.json` for `defaultMode`, `allowedTools`, `deniedTools`.

**Response**: `ApiResponse<{ conflicts: string[] }>`

---

### Authentication

Device pairing endpoints for the mobile companion app. These require `AUTH_TOKEN_SECRET` to be set in the daemon environment.

#### Request Pairing

```
POST /api/auth/pair
Content-Type: application/json
```

Initiates a new device pairing by generating a short-lived pairing code.

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deviceName` | string | No | Human-readable name for the device |

**Response**: `ApiResponse<{ pairingCode: string }>`

#### Confirm Pairing

```
POST /api/auth/confirm
Content-Type: application/json
```

Exchanges a valid pairing code for a bearer token. The pairing code expires after 5 minutes.

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pairingCode` | string | Yes | Code from `POST /api/auth/pair` |

**Response**: `ApiResponse<{ token: string, deviceId: string }>`

#### Auth Status

```
GET /api/auth/status
Authorization: Bearer <token>
```

Validates the provided bearer token. When auth is disabled (no `AUTH_TOKEN_SECRET`), always returns `valid: true`.

**Response**: `ApiResponse<{ valid: boolean, authEnabled?: boolean, deviceId?: string }>`

#### Register Push Token

```
POST /api/auth/register-push
Content-Type: application/json
```

Registers a device's push notification token.

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deviceId` | string | Yes | Device ID from pairing |
| `pushToken` | string | Yes | Platform push notification token |

**Response**: `ApiResponse<void>`

#### List Devices

```
GET /api/auth/devices
```

Returns all paired devices.

**Response**: `ApiResponse<Device[]>`

#### Remove Device

```
DELETE /api/auth/devices/:deviceId
```

Revokes a paired device's access.

**Response**: `ApiResponse<void>`

---

### Commands

#### List Commands

```
GET /api/commands
```

Returns all available custom commands, combining built-in Mainframe commands with any commands registered by installed adapters.

**Response**: `ApiResponse<CustomCommand[]>`

---

### External Sessions

External sessions are Claude CLI sessions that exist on disk but have not been imported into Mainframe.

#### List External Sessions

```
GET /api/projects/:projectId/external-sessions
```

Scans for importable external sessions for the project and starts periodic background scanning.

**Response**: `ApiResponse<ExternalSession[]>`

#### Import External Session

```
POST /api/projects/:projectId/external-sessions/import
Content-Type: application/json
```

Imports an external session as a new chat record.

**Body**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | The external session ID (alphanumeric and hyphens) |
| `adapterId` | string | Yes | Adapter that owns the session |
| `title` | string | No | Display title for the imported chat |

**Response**: `ApiResponse<Chat>`

---

### Launch

Launch manages dev-server processes defined in a project's `.mainframe/launch.json` configuration file.

#### Get Launch Status

```
GET /api/projects/:id/launch/status
```

Returns the current status of all configured launch processes, plus any active tunnel URLs.

**Response**:

```json
{
  "success": true,
  "data": {
    "statuses": {
      "dev": "running",
      "api": "stopped"
    },
    "tunnelUrls": {
      "dev": "https://abc123.tunnel.example.com"
    }
  }
}
```

#### Get Launch Configs

```
GET /api/projects/:id/launch/configs
```

Returns the parsed launch configurations from `.mainframe/launch.json`. Returns an empty array if no file exists.

**Response**: `ApiResponse<LaunchConfiguration[]>`

```json
{
  "success": true,
  "data": [
    {
      "name": "dev",
      "runtimeExecutable": "node",
      "runtimeArgs": ["server.js"],
      "port": 3000,
      "url": null,
      "preview": true
    }
  ]
}
```

#### Start Launch Process

```
POST /api/projects/:id/launch/:name/start
```

Starts a named launch configuration. Reads the config from disk — the request body is not used.

**Response**: `ApiResponse<void>`

#### Stop Launch Process

```
POST /api/projects/:id/launch/:name/stop
```

Stops a named running process.

**Response**: `ApiResponse<void>`

---

## WebSocket API

Connect to `ws://127.0.0.1:31415`. WebSocket upgrades on the same HTTP port. Messages are JSON-encoded.

### Client → Server (ClientEvent)

Send JSON messages to perform actions:

```typescript
// Create a new chat session
{ "type": "chat.create", "projectId": "abc", "adapterId": "claude", "model": "claude-sonnet-4-5-20250929" }

// Resume an existing chat
{ "type": "chat.resume", "chatId": "chat_xyz" }

// Send a message
{ "type": "message.send", "chatId": "chat_xyz", "content": "Fix the bug", "attachmentIds": ["att_01"] }

// Send a message triggered by a slash command
{
  "type": "message.send",
  "chatId": "chat_xyz",
  "content": "/my-command arg",
  "metadata": { "command": { "name": "my-command", "source": "project", "args": "arg" } }
}

// Respond to permission request
{ "type": "permission.respond", "chatId": "chat_xyz", "response": {
  "requestId": "req_001",
  "toolUseId": "tu_02",
  "behavior": "allow",
  "updatedPermissions": ["Bash(npm install *)"]
}}

// Interrupt running process
{ "type": "chat.interrupt", "chatId": "chat_xyz" }

// End chat session
{ "type": "chat.end", "chatId": "chat_xyz" }

// Update chat configuration
{ "type": "chat.updateConfig", "chatId": "chat_xyz", "model": "claude-opus-4-6" }

// Git worktree management
{ "type": "chat.enableWorktree", "chatId": "chat_xyz" }
{ "type": "chat.disableWorktree", "chatId": "chat_xyz" }

// Subscribe/unsubscribe to chat events
{ "type": "subscribe", "chatId": "chat_xyz" }
{ "type": "unsubscribe", "chatId": "chat_xyz" }
```

### Server → Client (DaemonEvent)

Events are broadcast to clients subscribed to the relevant chat:

```typescript
// Chat lifecycle
{ "type": "chat.created", "chat": { /* Chat object */ } }
{ "type": "chat.created", "chat": { /* Chat object */ }, "source": "import" } // when imported
{ "type": "chat.updated", "chat": { /* Chat object */ } }
{ "type": "chat.ended", "chatId": "chat_xyz" }

// Process lifecycle
{ "type": "process.started", "chatId": "chat_xyz", "process": { /* AdapterProcess */ } }
{ "type": "process.ready", "processId": "proc_01", "claudeSessionId": "session_abc" }
{ "type": "process.stopped", "processId": "proc_01" }

// Raw messages (internal, adapter-level)
{ "type": "message.added", "chatId": "chat_xyz", "message": { /* ChatMessage */ } }
{ "type": "messages.cleared", "chatId": "chat_xyz" }

// Display messages (UI-ready, grouped and enriched)
{ "type": "display.message.added", "chatId": "chat_xyz", "message": { /* DisplayMessage */ } }
{ "type": "display.message.updated", "chatId": "chat_xyz", "message": { /* DisplayMessage */ } }
{ "type": "display.messages.set", "chatId": "chat_xyz", "messages": [ /* DisplayMessage[] */ ] }

// Permissions
{ "type": "permission.requested", "chatId": "chat_xyz", "request": { /* ControlRequest */ } }
{ "type": "permission.resolved", "chatId": "chat_xyz", "requestId": "req_001" }

// Context
{ "type": "context.updated", "chatId": "chat_xyz" }

// Plugin UI
{ "type": "plugin.panel.registered", "pluginId": "my-plugin", "zone": "left-panel", "label": "My Panel", "icon": "LayoutDashboard" }
{ "type": "plugin.panel.unregistered", "pluginId": "my-plugin" }
{ "type": "plugin.notification", "pluginId": "my-plugin", "title": "Done", "body": "Task complete", "level": "info" }

// Launch process events
{ "type": "launch.output", "projectId": "abc123", "name": "dev", "data": "Server started\n", "stream": "stdout" }
{ "type": "launch.status", "projectId": "abc123", "name": "dev", "status": "running" }
{ "type": "launch.tunnel", "projectId": "abc123", "name": "dev", "url": "https://abc.tunnel.example.com" }
{ "type": "launch.tunnel.failed", "projectId": "abc123", "name": "dev", "error": "Tunnel service unavailable" }
{ "type": "launch.port.timeout", "projectId": "abc123", "name": "dev", "port": 3000 }

// External sessions
{ "type": "sessions.external.count", "projectId": "abc123", "count": 3 }

// Errors
{ "type": "error", "chatId": "chat_xyz", "error": "Process crashed unexpectedly" }
```

### Subscription Model

Clients must subscribe to specific chats to receive their events. Events without a `chatId` (global errors) are broadcast to all clients.

```
1. Connect to WebSocket
2. Send: { "type": "subscribe", "chatId": "chat_xyz" }
3. Receive: DaemonEvents for chat_xyz
4. Send: { "type": "unsubscribe", "chatId": "chat_xyz" }
```

When creating or resuming a chat, the client is auto-subscribed.

---

## Type Definitions

### Chat

```typescript
interface Chat {
  id: string;
  adapterId: string;
  projectId: string;
  title?: string;
  claudeSessionId?: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo';
  status: 'active' | 'paused' | 'ended' | 'archived';
  createdAt: string;
  updatedAt: string;
  totalCost: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  lastContextTokensInput: number;
  contextFiles?: string[];
  mentions?: SessionMention[];
  modifiedFiles?: string[];
  worktreePath?: string;
  branchName?: string;
  processState?: 'working' | 'idle' | null;
  displayStatus?: 'idle' | 'working' | 'waiting';
  isRunning?: boolean;
}
```

### DisplayMessage

```typescript
interface DisplayMessage {
  id: string;
  chatId: string;
  type: 'user' | 'assistant' | 'system' | 'error' | 'permission';
  content: DisplayContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

type DisplayContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; mediaType: string; data: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      input: Record<string, unknown>;
      category: 'default' | 'explore' | 'hidden' | 'progress' | 'subagent';
      result?: ToolCallResult;
    }
  | { type: 'tool_group'; calls: DisplayContent[] }
  | { type: 'task_group'; agentId: string; calls: DisplayContent[] }
  | { type: 'permission_request'; request: unknown }
  | { type: 'error'; message: string };

interface ToolCallResult {
  content: string;
  isError: boolean;
  structuredPatch?: DiffHunk[];
  originalFile?: string;
  modifiedFile?: string;
}
```

### ChatMessage

```typescript
interface ChatMessage {
  id: string;
  chatId: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'permission' | 'system' | 'error';
  content: MessageContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean; structuredPatch?: DiffHunk[]; originalFile?: string; modifiedFile?: string }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'error'; message: string };
```

### PermissionRequest

```typescript
interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  suggestions: string[];
  decisionReason?: string;
}
```

### PermissionResponse

```typescript
interface PermissionResponse {
  requestId: string;
  toolUseId: string;
  toolName?: string;
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: string[];
  message?: string;
  executionMode?: 'default' | 'acceptEdits' | 'yolo';
  clearContext?: boolean;
}
```

### SessionContext

```typescript
interface SessionContext {
  globalFiles: ContextFile[];
  projectFiles: ContextFile[];
  mentions: SessionMention[];
  attachments: SessionAttachment[];
  modifiedFiles: string[];
  skillFiles: SkillFileEntry[];
}
```

### Skill

```typescript
interface Skill {
  id: string;
  adapterId: string;
  name: string;
  displayName: string;
  description: string;
  scope: 'project' | 'global' | 'plugin';
  pluginName?: string;
  filePath: string;
  content: string;
  invocationName?: string;
}
```

### AgentConfig

```typescript
interface AgentConfig {
  id: string;
  adapterId: string;
  name: string;
  description: string;
  scope: 'project' | 'global';
  filePath: string;
  content: string;
}
```

### LaunchConfiguration

```typescript
type LaunchProcessStatus = 'stopped' | 'starting' | 'running' | 'failed';

interface LaunchConfiguration {
  name: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  port: number | null;
  url: string | null;
  preview?: boolean;
  env?: Record<string, string>;
}

interface LaunchConfig {
  version: string;
  configurations: LaunchConfiguration[];
}
```

### PluginManifest

```typescript
type PluginCapability =
  | 'storage'
  | 'ui:panels'
  | 'ui:notifications'
  | 'daemon:public-events'
  | 'chat:read'
  | 'chat:read:content'
  | 'chat:create'
  | 'adapters'
  | 'process:exec'
  | 'http:outbound';

type UIZone =
  | 'fullview'      // replaces Left + Center + Right; trigger in TitleBar
  | 'left-panel'    // replaces entire LeftPanel; trigger icon in Left Rail
  | 'right-panel'   // replaces entire RightPanel; trigger icon in Right Rail
  | 'left-tab'      // tab appended to LeftPanel tab strip
  | 'right-tab';    // tab appended to RightPanel tab strip

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  capabilities: PluginCapability[];
  ui?: {
    zone: UIZone;
    label: string;
    icon?: string;
  };
  adapter?: {
    binaryName: string;
    displayName: string;
  };
  commands?: Array<{ name: string; description: string }>;
}
```

### Device

```typescript
interface Device {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastSeen: string | null;
}
```
