# permission.respond Reliability

## Problem

The `permission.respond` WebSocket message is occasionally lost: the client logs it as sent, but the daemon never logs receipt. The session hangs indefinitely. No visible WS reconnect is required for this to happen.

## Root Cause Analysis

The daemon's WS message handler has a **silent failure path**:

```typescript
// websocket.ts — ws.on('message') handler
const parsed = ClientEventSchema.safeParse(raw);
if (!parsed.success) {
  this.sendError(ws, `Invalid message: ${...}`);  // sends error over WS
  return;  // ← NO pino log
}
```

If Zod validation fails, the daemon:
1. Sends `{ type: 'error', error: 'Invalid message: ...' }` back over WS
2. Logs nothing to pino

On the client, the `case 'error'` handler calls `setError(event.error)` with no `console.error`, so the error is invisible to the developer too.

Whether Zod actually fails (and why) is unconfirmed — requires the diagnostic logging below to determine.

## Implemented Fix (Approach 3 — Diagnostic + Recovery)

### 1. Daemon: log Zod failures

```typescript
// websocket.ts
if (!parsed.success) {
  log.warn({ issues: parsed.error.issues }, 'ws message validation failed');
  this.sendError(ws, `Invalid message: ${...}`);
  return;
}
```

### 2. Client: surface daemon error events

```typescript
// useDaemon.ts
case 'error':
  console.error('[daemon] received error event:', event.error);
  setError(event.error);
  break;
```

### 3. Client: recover from lost permission.respond

Track whether a `permission.respond` is "in flight" (sent but not confirmed). If the daemon sends back an error, or on reconnect, re-fetch `getPendingPermission` and restore the popup if the permission is still pending.

The reconnect recovery path already existed (`getPendingPermission` in the 500ms reconnect timer in `useChat`). What's added:
- React to daemon `error` events on the `permission.respond` path as a re-fetch trigger
- This covers Zod failures (no reconnect) and transport losses (with reconnect)

## Backup Plan (Approach 1 — HTTP POST)

If Approach 3 doesn't solve the issue, replace `daemonClient.respondToPermission()` WS call with an HTTP POST.

### Changes needed

**Daemon — add route** (`packages/core/src/server/routes/chats.ts`):
```typescript
router.post(
  '/api/chats/:id/permission-respond',
  asyncHandler(async (req: Request, res: Response) => {
    const chatId = param(req, 'id');
    const response = PermissionResponseSchema.parse(req.body);
    await ctx.chats.respondToPermission(chatId, response);
    res.json({ success: true });
  }),
);
```

**Client — replace WS call** (`packages/desktop/src/renderer/hooks/useDaemon.ts`):
```typescript
const respondToPermission = useCallback(async (...) => {
  if (!chatId || !pendingPermission) return;
  try {
    await postJson(`/api/chats/${chatId}/permission-respond`, {
      requestId: pendingPermission.requestId,
      toolUseId: pendingPermission.toolUseId,
      toolName: pendingPermission.toolName,
      behavior,
      updatedInput: overrideInput ?? pendingPermission.input,
      updatedPermissions: alwaysAllow,
      message,
      executionMode,
      clearContext,
    });
    useChatsStore.getState().removePendingPermission(chatId);
  } catch (err) {
    console.error('[permission] respond failed:', err);
    // Popup stays visible — user can retry
  }
}, [chatId, pendingPermission]);
```

Key difference: `removePendingPermission` only fires on HTTP 200. If the request fails, the popup stays — user retries by clicking Allow again. No silent loss.

### Why HTTP is the right long-term answer

- HTTP is request/response by design — acknowledgment is built in
- WS is appropriate for push events (messages streaming in, permissions popping up) but not for acknowledged user actions
- `postJson` is already in the codebase; adding one route is minimal
- The reconnect-recovery complexity disappears entirely
