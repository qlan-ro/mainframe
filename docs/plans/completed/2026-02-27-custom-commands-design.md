# Custom Commands Design

## Problem

Mainframe has no way to invoke provider-specific commands (`/clear`, `/compact`) or Mainframe-defined commands from the desktop UI. The Claude CLI supports slash commands via stdin, but `sendCommand()` isn't exposed through the WebSocket API. There's also no mechanism for Mainframe to inject its own commands that the AI processes and responds to.

## Two Command Types

### Provider Custom Commands

Commands that an adapter's CLI natively supports. For Claude: `/clear` (reset conversation) and `/compact` (compress context). These are sent via `sendCommand()` which writes XML-tagged user messages to the CLI's stdin. The CLI processes them internally — `/clear` and `/compact` both re-emit `system:init`.

### Mainframe Custom Commands

Commands defined by Mainframe itself, not by any CLI adapter. The daemon intercepts these, wraps them in a structured prompt template, and sends the wrapped content as a regular user message to the CLI. The model responds normally; sentinel tags in the response are stripped before rendering.

## Design

### 1. Command Registry & Discovery

**Adapter manifests** declare their supported commands:

```json
{
  "id": "claude",
  "commands": [
    { "name": "clear", "description": "Clear conversation history" },
    { "name": "compact", "description": "Compress context to save tokens" }
  ]
}
```

**Mainframe commands** are registered in a static registry in core:

```typescript
const MAINFRAME_COMMANDS: CustomCommand[] = [];
// Empty for v1 — framework only, no concrete commands yet
```

**REST endpoint** `GET /api/commands?projectPath=...` returns a unified list:

```json
[
  { "name": "clear", "description": "Clear conversation history", "source": "claude" },
  { "name": "compact", "description": "Compress context to save tokens", "source": "claude" }
]
```

Desktop fetches this alongside skills and merges both into the `/` popover.

### 2. Sending Commands

Commands are sent through the existing `message.send` WebSocket event, annotated with metadata.

**Desktop sends:**

```typescript
{
  type: 'message.send',
  chatId: 'abc',
  content: '/compact',
  metadata: {
    command: { name: 'compact', source: 'claude' }
  }
}
```

**`MessageSend` schema** gets an optional `metadata` field:

```typescript
const MessageSend = z.object({
  type: z.literal('message.send'),
  chatId: z.string().min(1),
  content: z.string(),
  attachmentIds: z.array(z.string()).optional(),
  metadata: z.object({
    command: z.object({
      name: z.string(),
      source: z.string(),
      args: z.string().optional(),
    }).optional(),
  }).optional(),
});
```

**ChatManager routing:**

1. If `metadata.command` is present and `source` matches an adapter → call `session.sendCommand(name, args)`.
2. If `source === 'mainframe'` → intercept, build prompt from template, send via `session.sendMessage()`.
3. No metadata → regular `session.sendMessage()` (existing behavior).

### 3. Mainframe Command Encoding

When a mainframe command fires, the daemon wraps it:

```xml
<mainframe-command name="init" id="cmd_abc123">
{command.promptTemplate}

Wrap your entire response in:
<mainframe-command-response id="cmd_abc123">
YOUR RESPONSE HERE
</mainframe-command-response>
</mainframe-command>
```

- `id` links request to response for reliable extraction.
- `promptTemplate` is defined per command in the registry.
- On the user message side, the `<mainframe-command>` tags are hidden in the UI — the user sees a clean command bubble.
- On the assistant response side, sentinel tags are stripped — rendered as normal assistant text.

### 4. UI

**Composer popover (`ContextPickerMenu`):**

- Commands appear in the same flat list as skills when typing `/`.
- Differentiated by icon: wrench for commands, zap for skills.
- Badge shows source (`claude`, `mainframe`).
- No confirmation dialogs for v1.

**Chat messages:**

- User side: command invocations render like skill invocations — wrench icon + `/commandName`. Reuses `parseCommandMessage`/`parseRawCommand` with an icon swap when the item is a command.
- Provider command responses: rendered as normal assistant messages. `/clear` and `/compact` trigger `system:init` re-emission (already handled).
- Mainframe command responses: sentinel tags stripped, rendered as normal assistant text.
- Mainframe command user messages: `<mainframe-command>` wrapper hidden in UI.

### 5. Types

```typescript
interface CustomCommand {
  name: string;
  description: string;
  source: string;        // adapter id or 'mainframe'
  promptTemplate?: string; // mainframe commands only
}
```

Added to `@mainframe/types` as the canonical command type.

### 6. Data Flow

```
User types /compact in composer
    ↓
ContextPickerMenu shows it (fetched from GET /api/commands)
    ↓
User selects → composer text becomes "/compact"
    ↓
User presses Send
    ↓
Desktop sends WS: { type: 'message.send', content: '/compact',
                     metadata: { command: { name: 'compact', source: 'claude' } } }
    ↓
ChatManager sees metadata.command, source='claude'
    ↓
Calls session.sendCommand('compact')
    ↓
Claude CLI receives XML-tagged command via stdin
    ↓
CLI re-emits system:init + processes command
    ↓
Events flow back through normal JSONL pipeline
    ↓
Desktop renders: user sees command bubble, assistant response as normal
```

For mainframe commands the flow diverges at ChatManager — it wraps the prompt template and sends via `sendMessage()` instead of `sendCommand()`.

## Non-Goals for v1

- No concrete mainframe commands (framework only).
- No confirmation dialogs.
- No command arguments UI (just name-based invocation).
- No command response cards or special rendering — just tag stripping.
