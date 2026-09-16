# Driving Mainframe over ACP

The Mainframe daemon speaks the [Agent Client Protocol](https://agentclientprotocol.com) (ACP, protocol version 2) to chat clients. If you want to drive Mainframe-managed agents from your own UI, a bot, an editor plugin, or a script, this is the socket to use. Everything the desktop app does in a chat (send, stream, approve tool calls, reconnect) goes through it.

This guide is for integrators. It covers the wire contract and the behaviors a client has to get right. For the route-by-route reference, see the [API reference](../API-REFERENCE.md#acp-chat-facade-acpprofile); for the design rationale, the [protocol spec](../specs/2026-08-28-todo-350-wire-protocol-payload-grammar.md).

Mainframe follows ACP wherever ACP has a construct. Where it does not (queued prompts, heartbeats, rich permission answers, display fidelity), the extra data rides a `_mainframe.dev` namespace inside ACP's `_meta` fields or arrives as `_mainframe.dev/*` notifications. A stock ACP client that ignores that namespace still gets a coherent chat. A Mainframe-aware client gets the full experience.

## Before you start

You need a running daemon (see [Running the daemon](./running-the-daemon.md)) with at least one agent CLI installed, and a chat to drive. ACP sessions in Mainframe are chats, so create one over REST first:

```bash
# register a project, then create a chat on it
curl -s -X POST http://127.0.0.1:31415/api/projects -H 'content-type: application/json' \
  -d '{"path":"/path/to/repo"}'
curl -s -X POST http://127.0.0.1:31415/api/chats -H 'content-type: application/json' \
  -d '{"projectId":"<project id>","adapterId":"claude"}'
```

The chat's `id` is your ACP `sessionId`. `GET /api/adapters` lists the adapter ids you can pass and whether each CLI is installed.

Authentication follows the daemon's usual rule. A loopback caller never needs a token. A remote caller (through a tunnel) needs a paired device token, passed as `?token=` on the upgrade URL because browser WebSocket clients cannot set headers. Pairing is described under [Authentication](../API-REFERENCE.md#authentication).

## Connect

```
GET ws://127.0.0.1:31415/acp/{profile}[?token=<device token>]
```

`profile` is an adapter id (`claude`, `codex`). Connect to the profile of the chats you intend to drive. An unauthenticated remote upgrade gets `401`; an unknown profile gets `404`, checked after auth so the adapter list cannot be probed anonymously.

Every frame is one JSON-RPC 2.0 message in a WebSocket text frame. Requests carry an `id`, notifications do not, and the daemon sends requests of its own (permission gates) that you answer with a response frame. Binary frames are ignored.

## Handshake

Send `initialize` first. Anything else sent before it is refused with error `-32002 initialize required` (requests) or dropped silently (notifications).

```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": 2, "info": { "name": "my-client", "version": "0.1.0" } } }
```

```json
{ "jsonrpc": "2.0", "id": 1, "result": {
    "protocolVersion": 2,
    "info": { "name": "mainframe-daemon", "version": "2.2.0" },
    "capabilities": { "session": {} },
    "_meta": { "_mainframe.dev": {
      "richPermissionAnswers": true, "queuedPrompts": true,
      "retryMarkers": true, "heartbeatIntervalMs": 15000 } } } }
```

Only protocol version 2 is accepted. Another version gets `-32001 unsupported protocol version` with `data.supported: [2]`, and the connection stays open so you can retry. `info.name` and `info.version` are required.

The `_mainframe.dev` capabilities tell you which extensions this daemon has. Read `heartbeatIntervalMs`; you will need it below.

## Sessions are chats

There is no `session/new` on this socket (it returns `-32601`). A session id is a chat id from `POST /api/chats`. A connection starts observing a session the moment it sends `session/prompt` or `session/resume` for it, and from then on receives that session's `session/update` stream and permission gates. One connection can observe any number of sessions.

## Send a prompt

```json
{ "jsonrpc": "2.0", "id": 2, "method": "session/prompt",
  "params": { "sessionId": "chat_9f2a3b1c", "prompt": [ { "type": "text", "text": "Run the tests" } ] } }
```

The daemon joins the text blocks with newlines. Image blocks in `prompt` are not read; attach files by uploading them to `POST /api/chats/{id}/attachments` first and naming the returned ids in the request's `_meta`:

```json
"_meta": { "_mainframe.dev": {
  "attachmentIds": ["att_01HZY3A"],
  "command": { "name": "review", "source": "project", "args": "HEAD~1" } } }
```

`command` records a slash-command invocation. `name` must match `^[a-zA-Z0-9_-]+$` and `source` must be non-empty; `GET /api/commands` lists the built-ins.

The reply means the prompt was accepted, not that the turn finished. If a turn is already running, the prompt is queued and the reply says where:

```json
{ "jsonrpc": "2.0", "id": 2, "result": { "_meta": { "_mainframe.dev": { "position": 2 } } } }
```

An immediate prompt returns `{}`. Your own prompt comes back as a `user_message` item before the reply, and the reply may also trail the `state_update: running` frame it caused, because prompts run off the socket loop so a slow agent start does not stall other sessions. Read run state from the stream, never from reply order.

Prompt errors are `-32602` for malformed params and `-32002 session unavailable: ...` when the chat does not exist or its adapter refused the send.

To stop a running turn, send the `session/cancel` notification. It has no reply; the turn ends with a `cancelled` stop reason and every open gate on the session is cancelled.

```json
{ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": "chat_9f2a3b1c" } }
```

## Read the stream

Turn output arrives as `session/update` notifications:

```json
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "chat_9f2a3b1c", "update": { "sessionUpdate": "agent_message_chunk",
    "messageId": "msg_agent_01", "content": { "type": "text", "text": "Looking into it" } } } }
```

The daemon coalesces updates per connection every 100 ms, so several chunks for the same item can arrive as one, and it never re-sends an item's accumulated content after that item's first frame. Your job is to keep an accumulator keyed by item id and apply each update to it.

| `sessionUpdate` | Payload | Effect on your accumulator |
|---|---|---|
| `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` | `messageId`, one `content` block | Append. A text chunk extends the trailing text block; anything else starts a new block. |
| `user_message`, `agent_message`, `agent_thought` | `messageId`, `content?`, `_meta?` | Upsert. `content` omitted leaves it, an array replaces it wholesale. |
| `tool_call_update` | `toolCallId` plus patch fields | Create or patch (see below). |
| `tool_call_content_chunk` | `toolCallId`, one `content` entry | Append one entry to the tool call's content. |
| `state_update` | `state`, `stopReason?` | The session's run state. |
| `usage_update` | `used`, `size`, `cost?` | Context-window occupancy. |

### Items and ids

Every message, thought, and tool call has a stable id. The same id identifies the item in the live stream, in a `session/resume` replay, and in `GET /api/chats/{id}/messages`. Message ids are the provider's message id (`msg_*`), tool-call ids are the tool-use id (`toolu_*`). Because ids are stable, you can apply a replay on top of what you already hold without duplicating anything.

### Chunks, upserts, and the clear frame

An item's first frame is always an upsert carrying its full content and `_meta`. After that, text that extends the last block arrives as chunks when the adapter streams tokens (Claude Code 1.0.109 or newer); an adapter without token streaming sends one frame per completed block instead. A frame with no `content` key is a metadata-only patch, which is how turn cost and duration land on a message after it ends. A revision that rewrites earlier content (a provider retry, for example) arrives as a full upsert, and the retry is marked:

```json
{ "sessionUpdate": "agent_message", "messageId": "msg_agent_01",
  "content": [ { "type": "text", "text": "Looking into it" } ],
  "_meta": { "_mainframe.dev": { "attempt": 2, "reason": "overloaded_error" } } }
```

When a partial message is abandoned (retry, interrupt, adapter death), the daemon sends one clear frame so you do not keep text the transcript never got. The clear frame is exactly `content: []` together with `_meta: null`; delete the item on that pair and only that pair. An empty `content` alone is a legitimate empty item.

Only `text` and `image` content blocks are used. Images carry base64 `data` and a `mimeType`.

### Tool calls

A tool call starts with a `tool_call_update` carrying `title`, `kind`, `status: "pending"`, `locations`, and `rawInput`, then patches follow. Patch fields use three states: a field omitted from the frame is unchanged, `null` clears it, a value replaces it. `content` on a `tool_call_update` replaces the whole list; `tool_call_content_chunk` appends one entry.

Results arrive as `content` entries. A plain result is `{ type: "content", content: { type: "text", ... } }`. An edit result adds a `diff` entry with the affected path in `changes` and a git patch in `patch`; its own `_meta["_mainframe.dev"]` carries the structured hunks and the full before/after file text if you want to render a richer diff than the patch. A truncated result's text block carries `_meta["_mainframe.dev"]: { truncated: true, fullBytes }`; the full output is at `GET /api/chats/{id}/tool-result/{toolUseId}`.

Subagents are flat: a subagent's tool calls are ordinary tool-call items whose `_meta["_mainframe.dev"].parentToolCallId` names the launching tool call.

### Turn state

`state_update` has three states in the schema. The daemon emits `running` when a turn starts and `idle` when it ends; `requires_action` is not emitted today. On `idle`, `stopReason` is `end_turn`, `cancelled`, or `_mainframe.dev/error` (the schema also lists `max_tokens`, `max_turn_requests`, and `refusal`, which no adapter produces yet). A `state_update` without `stopReason` is the one a `session/resume` replay ends with; it reports the current state, not a transition.

### Display metadata

Every item carries `_meta["_mainframe.dev"]` with what the core grammar has no field for: `timestamp`, `containerId` (the chat message the item belongs to, so you can group items back into messages), `kind: "system" | "error"` with `errorText`, `isCompacted`, `skillLoaded`, `groupId` (tool calls the daemon groups together share the first member's id), `subagent: true` on a task launch, and `messageMeta` (the raw message metadata map: attachments, command, cost, turn duration). All of it is optional to consume.

### Usage

`usage_update` carries `used` and `size` in tokens, `cost` when known, and `_meta["_mainframe.dev"].percentage`, the CLI's own occupancy figure. Prefer the percentage for a context gauge; the CLI reserves part of the window, so `used / size` reads low.

## Permission gates

When the agent needs approval, the daemon sends you a request:

```json
{ "jsonrpc": "2.0", "id": "gate-req_001", "method": "session/request_permission",
  "params": {
    "sessionId": "chat_9f2a3b1c",
    "title": "Allow Bash to run?",
    "subject": { "type": "tool_call", "toolCall": { "toolCallId": "toolu_01A", "title": "Bash" } },
    "options": [
      { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "allow-always", "name": "Always allow", "kind": "allow_always" },
      { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" } ],
    "_meta": { "_mainframe.dev": { "controlRequest": { "requestId": "req_001", "toolUseId": "toolu_01A",
      "toolName": "Bash", "input": { "command": "rm -rf /tmp/scratch" }, "suggestions": [] } } } } }
```

Updates keep streaming while the gate is open. Answer with a JSON-RPC response under the same id. Note the nesting: the result has an `outcome` object, which has its own `outcome` tag.

```json
{ "jsonrpc": "2.0", "id": "gate-req_001",
  "result": { "outcome": { "outcome": "selected", "optionId": "allow-once" } } }
```

Rules that matter:

- Render the options the daemon offers and send back one of their ids. Do not infer what an option does from its `kind` or `name`; the adapter owns the effect. `allow-always` is only offered when the adapter has something durable to save.
- A plain answer with an `optionId` the daemon did not offer is logged and ignored. The gate stays open and you receive nothing back, so validate against the offered list before sending.
- An error response (`"error": {...}`) under the gate id denies the request.
- `{ "outcome": { "outcome": "cancelled" } }` only withdraws the gate from your connection. It does not resolve it for the agent; send `session/cancel` for that.
- Unknown `kind` values may appear from a newer daemon. Render them neutrally and treat them as deny, never as approval.

A Mainframe-aware client can attach a rich answer under `_meta["_mainframe.dev"].controlResponse`: the full `ControlResponse` (behavior, `updatedInput`, `updatedPermissions`, `executionMode`, `clearContext`). It must repeat the request's `requestId` and `toolUseId` or it is ignored in favor of the plain `optionId`. This is how the desktop app edits a command before allowing it, or answers plan-approval and question gates that have no clickable option.

Gates are shared. Every connection observing the session receives the same request under the same id; the first answer wins. When a gate resolves elsewhere (another client, or the CLI itself), everyone still holding it gets:

```json
{ "jsonrpc": "2.0", "method": "_mainframe.dev/gate_resolved",
  "params": { "sessionId": "chat_9f2a3b1c", "requestId": "gate-req_001" } }
```

A late answer to a resolved gate is dropped without a reply. An open gate is redelivered by `session/resume` under its original id.

## Queued prompts

Prompts accepted mid-turn wait in a queue the daemon owns. Queued prompts are not transcript items; the daemon tells you about them with a snapshot notification, sent on every change and at the end of every resume replay, even when empty:

```json
{ "jsonrpc": "2.0", "method": "_mainframe.dev/queue_state",
  "params": { "sessionId": "chat_1", "refs": [
    { "messageId": "dmsg_0003", "chatId": "chat_1", "uuid": "a1b2c3d4",
      "content": "Continue with the fix", "timestamp": "2026-07-08T10:15:30.000Z" } ] } }
```

Replace your local queue with `refs` each time. Editing or cancelling a queued prompt is REST: `PATCH` or `DELETE /api/chats/{id}/queue/{messageId}`.

## Stay in sync

The daemon sends a heartbeat every `heartbeatIntervalMs`:

```json
{ "jsonrpc": "2.0", "method": "_mainframe.dev/heartbeat", "params": { "sequence": 42 } }
```

`sequence` starts at 1 and increments by one. A jump larger than one, or silence for twice the interval, means you missed frames. Do not guess what you missed; call `session/resume`.

```json
{ "jsonrpc": "2.0", "id": 3, "method": "session/resume",
  "params": { "sessionId": "chat_9f2a3b1c", "cwd": "/path/to/repo",
              "replayFrom": { "type": "item", "itemId": "msg_agent_01" } } }
```

`cwd` is required by the ACP schema and ignored by the daemon. `replayFrom` is `{ "type": "start" }` for the whole transcript or `{ "type": "item", "itemId" }` to replay from after an item you already hold. An unknown item id (for example one compacted away) falls back to a full replay, and the reply says so:

```json
{ "jsonrpc": "2.0", "id": 3, "result": { "_meta": { "_mainframe.dev": { "itemCount": 57, "fullReplay": true } } } }
```

`itemCount` is the size of the daemon's full snapshot. If you hold items and get `itemCount: 0`, the daemon has no history for that chat yet; keep what you have rather than blanking. Resuming a chat id the daemon does not know is not an error; it replies with `itemCount: 0` and an `idle` state, and the mistake surfaces on the first prompt.

The replay arrives in a fixed order after the reply: the item updates, then one `state_update` with the current state, then the open gate if there is one, then `queue_state`. The daemon buffers anything that happens live during the replay and delivers it afterwards, so you never see a live delta for an item before its replayed base. Stable ids make the replay idempotent on top of a partial accumulator.

Three more notifications ask you to resync:

| Notification | Params | What to do |
|---|---|---|
| `_mainframe.dev/transcript_cleared` | `{ sessionId }` | The daemon wiped the transcript (plan mode's clear-context). Drop your local items and resume from start. |
| `_mainframe.dev/resync` | `{ sessionId }` | Your accumulator has diverged (the daemon's message cache evicted from the front, or a resume failed on the daemon's side). Resume from start without wiping first. |
| `_mainframe.dev/compaction` | `{ sessionId, phase: "started" \| "done" }` | Show a compaction indicator. The durable marker is `isCompacted` on the item. |

Back off between consecutive resync-driven resumes (the desktop client starts at one second and caps at thirty). A resume that fails repeatably on the daemon triggers a resync only once per failure streak, so a naive client does not loop, but a polite one still waits.

## Several sessions on one connection

Nothing stops you from prompting or resuming many sessions on one socket; frames carry `sessionId`. If your client follows one active session at a time, tell the daemon when you leave one so it stops streaming it and drops that session's pending gates from your connection:

```json
{ "jsonrpc": "2.0", "method": "_mainframe.dev/session_detach", "params": { "sessionId": "chat_1" } }
```

Coming back is a `session/resume`.

## Errors

| Code | Meaning |
|---|---|
| `-32700` | The frame was not JSON. |
| `-32600` | The frame was JSON but not a JSON-RPC message. |
| `-32601` | Unknown method (this includes `session/new`, `session/load`, and the `fs/*` and `terminal/*` client services). |
| `-32602` | Params failed validation; `message` says which field. |
| `-32603` | The daemon failed while handling the call. A `_mainframe.dev/resync` may follow. |
| `-32001` | Unsupported `protocolVersion`; `data.supported` lists what works. |
| `-32002` | `initialize required`, or `session unavailable: Chat <id> not running` (unknown chat, or the adapter refused the send). |

## Differences from stock ACP

If you already have an ACP client, expect these deviations:

- Sessions come from REST, not `session/new`. There is no `session/load`.
- Resume takes a `replayFrom` cursor and replays with stable ids.
- The daemon never calls `fs/read_text_file`, `fs/write_text_file`, or `terminal/*` on the client. The agent CLIs do their own file and shell work.
- `session/request_permission` subjects are always `tool_call`. The option list is adapter-supplied.
- Only `text` and `image` content blocks are used. `audio`, `resource`, and `resource_link` never appear.
- `_mainframe.dev/error` is an added stop reason.
- Everything under `_meta["_mainframe.dev"]` and every `_mainframe.dev/*` method is additive. Ignore what you do not understand.

## A minimal client

Node 22 or newer has a global `WebSocket`, so this needs no dependencies. It initializes, replays a chat, sends one prompt, prints agent text as it arrives (the first upsert, then any streamed chunks), approves every gate, and exits when the turn ends.

```js
// node client.mjs <chatId> "<prompt>"
const [chatId, text] = process.argv.slice(2);
const ws = new WebSocket(`ws://127.0.0.1:31415/acp/claude`);
let nextId = 1;
const pending = new Map();

const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
const notify = (method, params) => ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));

ws.onmessage = ({ data }) => {
  const frame = JSON.parse(data);
  if ('id' in frame && !('method' in frame)) {
    const waiter = pending.get(frame.id);
    pending.delete(frame.id);
    frame.error ? waiter.reject(frame.error) : waiter.resolve(frame.result);
    return;
  }
  if (frame.method === 'session/request_permission') {
    const first = frame.params.options[0];
    console.log(`\n[gate] ${frame.params.title} -> ${first.name}`);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id,
      result: { outcome: { outcome: 'selected', optionId: first.optionId } } }));
    return;
  }
  if (frame.method !== 'session/update') return;
  const { update } = frame.params;
  if (update.sessionUpdate === 'agent_message' && update.content) {
    process.stdout.write('\n' + update.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  } else if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
    process.stdout.write(update.content.text);
  } else if (update.sessionUpdate === 'tool_call_update' && update.title) {
    console.log(`\n[tool] ${update.title}`);
  } else if (update.sessionUpdate === 'state_update' && update.state === 'idle' && update.stopReason) {
    console.log(`\n[done] ${update.stopReason}`);
    ws.close();
  }
};

ws.onopen = async () => {
  await call('initialize', { protocolVersion: 2, info: { name: 'example', version: '0.0.1' } });
  await call('session/resume', { sessionId: chatId, cwd: '/', replayFrom: { type: 'start' } });
  await call('session/prompt', { sessionId: chatId, prompt: [{ type: 'text', text }] });
};
```

A real client also watches heartbeats and resumes on a gap, keeps an accumulator instead of printing, and handles `queue_state`, `gate_resolved`, and the resync notifications above.

## What is not on this socket

The ACP socket carries the chat surface only. The list of chats, project and git state, launch configs, worktrees, automations, and everything else stays on REST and the side-band WebSocket at `/`, documented in the [API reference](../API-REFERENCE.md). Chat creation, archiving, renaming, and queued-prompt edits are REST too.
