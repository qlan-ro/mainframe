# Permission Sync & Mobile Permission UI

## Problem

1. **Mobile permissions not handled**: The mobile app has basic PermissionCard plumbing but lacks AskUserQuestion and ExitPlanMode cards, and the response callback is too simple.
2. **No cross-client sync**: When one client resolves a permission, other clients still show the stale card. No event tells them the permission was handled.
3. **Double-response race**: Two clients can respond to the same permission simultaneously, causing duplicate CLI writes and queue corruption.

## Design

### A. New `permission.resolved` event

Add a daemon event broadcast after a permission response is successfully processed.

**Type** (in `packages/types/src/events.ts`):
```typescript
| { type: 'permission.resolved'; chatId: string; requestId: string }
```

**Emission point** (`permission-handler.ts` → `handleNormalPermission`):
After forwarding the response to the CLI and shifting the queue, emit `permission.resolved` with the resolved `requestId`. This happens before emitting the next `permission.requested` (if any), preserving causal order.

**Client handling**: Both desktop and mobile event routers receive `permission.resolved` and call `removePendingPermission(chatId)` — but only if the stored permission's `requestId` matches the resolved one (guard against stale state).

### B. requestId guard against double-response

Add a check in `permission-handler.ts` → `respondToPermission`:

```
currentPending = permissions.getPending(chatId)
if (!currentPending || currentPending.requestId !== response.requestId):
  log.warn('stale or duplicate permission response, ignoring')
  return
```

This makes the handler idempotent. If Client A already resolved the permission, Client B's response is silently dropped. No duplicate CLI writes, no queue corruption.

Also add a `matchesPending(chatId, requestId)` method to `PermissionManager` to keep the check clean.

### C. Mobile permission cards (full parity)

Three card types routed by `toolName` in the chat screen:

**ToolPermissionCard** (enhance existing `PermissionCard`):
- Tool name badge + collapsible input JSON
- Allow / Deny buttons
- Always Allow button when `request.suggestions.length > 0`

**AskUserQuestionCard** (new):
- Parse `request.input.questions` as array of `{ question, header?, options[], multiSelect? }`
- Render options as tappable rows (radio for single, checkbox for multi)
- "Other" option with TextInput
- Multi-question carousel with Back/Next
- Submit: `behavior: 'allow'`, `updatedInput: { ...request.input, answers }`
- Skip: `behavior: 'deny'`

**PlanApprovalCard** (new):
- Scrollable markdown preview of `request.input.plan`
- Bulleted list of `request.input.allowedPrompts`
- Approve button: `behavior: 'allow'`
- Reject button: `behavior: 'deny'`
- Revise button with TextInput for feedback: `behavior: 'deny'` + `message`

**respondToPermission callback**: Expand the `useChatSession` hook to accept the full signature: `(behavior, alwaysAllow?, overrideInput?, message?, executionMode?, clearContext?)`. Construct the `ControlResponse` and send via WebSocket.

**Client-side optimistic guard**: After responding, immediately remove the pending permission from the local store and disable buttons. The `permission.resolved` event is a confirmation, not the trigger.

### D. Files changed

**types** (`packages/types/src/events.ts`):
- Add `permission.resolved` to `DaemonEvent` union

**core** (`packages/core`):
- `permission-handler.ts`: Add requestId guard in `respondToPermission`, emit `permission.resolved` in `handleNormalPermission`
- `permission-manager.ts`: Add `matchesPending(chatId, requestId)` method

**desktop** (`packages/desktop`):
- `ws-event-router.ts`: Handle `permission.resolved` → remove matching pending permission

**mobile** (`packages/mobile`):
- `event-router.ts`: Handle `permission.resolved` → remove matching pending permission
- `hooks/useChatSession.ts`: Expand `respondToPermission` to full signature
- `components/chat/PermissionCard.tsx`: Enhance with Always Allow, collapsible input
- `components/chat/AskUserQuestionCard.tsx`: New component
- `components/chat/PlanApprovalCard.tsx`: New component
- `app/chat/[chatId].tsx` or `components/chat/MessageList.tsx`: Route to correct card based on `toolName`

### E. Event ordering guarantee

WebSocket preserves per-connection message order. The daemon emits events in this sequence:

1. `permission.resolved` (requestId = X)
2. `permission.requested` (requestId = Y, next in queue) — only if queue has more

Clients process them in order: clear X, then show Y. No race between these two events.

The only real race is two clients responding simultaneously — handled by the requestId guard (section B).
