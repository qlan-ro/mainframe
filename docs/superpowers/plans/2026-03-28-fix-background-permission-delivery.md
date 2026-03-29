# Fix Background Chat Permission Delivery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep WS subscriptions alive for visited chats so permission requests and status updates reach the client even when the chat tab is in the background.

**Architecture:** Track visited chatIds in `DaemonClient`. Stop unsubscribing on tab switch. On WS reconnect, re-subscribe visited chats with lightweight `subscribe()` (no CLI spawn). No daemon-side changes.

**Tech Stack:** TypeScript, React hooks, Vitest

---

### Task 1: Add visited-chats tracking to DaemonClient

**Files:**
- Modify: `packages/desktop/src/renderer/lib/client.ts:10-18` (class properties)
- Modify: `packages/desktop/src/renderer/lib/client.ts:46-51` (onopen handler)
- Modify: `packages/desktop/src/renderer/lib/client.ts:147-150` (resumeChat)
- Test: `packages/desktop/src/__tests__/hooks/daemon-client.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/__tests__/hooks/daemon-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal WebSocket mock
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  // Event handlers assigned by DaemonClient
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
}

vi.stubGlobal('WebSocket', MockWebSocket);

// Must import after stubbing WebSocket
const { DaemonClient } = await import('../../renderer/lib/client');

function connectClient(client: InstanceType<typeof DaemonClient>): MockWebSocket {
  client.connect();
  // Get the socket created by connect()
  const ws = (client as unknown as { ws: MockWebSocket }).ws;
  ws.onopen?.();
  return ws;
}

describe('DaemonClient visited chats', () => {
  let client: InstanceType<typeof DaemonClient>;

  beforeEach(() => {
    client = new DaemonClient();
  });

  it('tracks chatId in visitedChats on resumeChat', () => {
    const ws = connectClient(client);
    ws.sent = [];

    client.resumeChat('chat-1');

    expect(client.visitedChats.has('chat-1')).toBe(true);
  });

  it('re-subscribes visited chats on reconnect', () => {
    const ws1 = connectClient(client);
    client.resumeChat('chat-1');
    client.resumeChat('chat-2');

    // Simulate disconnect + reconnect
    ws1.readyState = MockWebSocket.CLOSED;
    (client as unknown as { ws: MockWebSocket | null }).ws = null;
    const ws2 = connectClient(client);
    ws2.sent = [];

    // Trigger the resubscribe that happens after flush
    // The onopen handler should have re-subscribed both chats
    // We need to check what was sent during onopen
    // Reset and re-trigger to isolate
    (client as unknown as { ws: MockWebSocket | null }).ws = null;
    const ws3 = connectClient(client);

    const subscribes = ws3.sent
      .map((s) => JSON.parse(s))
      .filter((e: { type: string }) => e.type === 'subscribe');

    expect(subscribes).toHaveLength(2);
    expect(subscribes.map((s: { chatId: string }) => s.chatId).sort()).toEqual(['chat-1', 'chat-2']);
  });

  it('uses lightweight subscribe (not chat.resume) on reconnect', () => {
    const ws1 = connectClient(client);
    client.resumeChat('chat-1');

    // Reconnect
    (client as unknown as { ws: MockWebSocket | null }).ws = null;
    const ws2 = connectClient(client);

    const resumes = ws2.sent
      .map((s) => JSON.parse(s))
      .filter((e: { type: string }) => e.type === 'chat.resume');

    // No chat.resume on reconnect — only lightweight subscribe
    expect(resumes).toHaveLength(0);
  });

  it('removes chatId from visitedChats on unsubscribe', () => {
    connectClient(client);
    client.resumeChat('chat-1');
    expect(client.visitedChats.has('chat-1')).toBe(true);

    client.unsubscribe('chat-1');
    expect(client.visitedChats.has('chat-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- --run src/__tests__/hooks/daemon-client.test.ts`
Expected: FAIL — `visitedChats` property does not exist on `DaemonClient`.

- [ ] **Step 3: Implement the changes to DaemonClient**

In `packages/desktop/src/renderer/lib/client.ts`:

Add the `visitedChats` property after line 18:

```typescript
  readonly visitedChats = new Set<string>();
```

In the `socket.onopen` handler (line 46-51), add re-subscribe logic after `this.flushPendingMessages()`:

```typescript
    socket.onopen = () => {
      log.info('connected');
      this.reconnectAttempts = 0;
      this.flushPendingMessages();
      this.resubscribeVisitedChats();
      this.notifyConnectionListeners();
    };
```

Add the private method after `flushPendingMessages()` (after line 124):

```typescript
  private resubscribeVisitedChats(): void {
    for (const chatId of this.visitedChats) {
      this.send({ type: 'subscribe', chatId });
    }
  }
```

In `resumeChat` (line 147-150), add tracking:

```typescript
  resumeChat(chatId: string): void {
    this.visitedChats.add(chatId);
    this.send({ type: 'chat.resume', chatId });
    log.debug('resumeChat', { chatId });
  }
```

In `unsubscribe` (line 186-188), also remove from visited:

```typescript
  unsubscribe(chatId: string): void {
    this.visitedChats.delete(chatId);
    this.send({ type: 'unsubscribe', chatId });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- --run src/__tests__/hooks/daemon-client.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/client.ts packages/desktop/src/__tests__/hooks/daemon-client.test.ts
git commit -m "fix(desktop): track visited chats for WS resubscribe on reconnect"
```

---

### Task 2: Remove unsubscribe from useChatSession cleanup

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useChatSession.ts:70-75` (cleanup function)

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/__tests__/hooks/useChatSession-subscription.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the daemon client module
const mockResumeChat = vi.fn();
const mockUnsubscribe = vi.fn();
const mockSubscribeConnection = vi.fn(() => vi.fn());

vi.mock('../../renderer/lib/client', () => ({
  daemonClient: {
    resumeChat: mockResumeChat,
    unsubscribe: mockUnsubscribe,
    subscribeConnection: mockSubscribeConnection,
    connected: true,
  },
}));

vi.mock('../../renderer/lib/api', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  getPendingPermission: vi.fn().mockResolvedValue(null),
  uploadAttachments: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../renderer/store/chats', () => {
  const state = {
    messages: new Map(),
    pendingPermissions: new Map(),
    setMessages: vi.fn(),
    addPendingPermission: vi.fn(),
  };
  return {
    useChatsStore: Object.assign(
      (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
      { getState: () => state },
    ),
  };
});

const { useChatSession } = await import('../../renderer/hooks/useChatSession');

describe('useChatSession subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls resumeChat on mount', () => {
    renderHook(() => useChatSession('chat-1'));
    expect(mockResumeChat).toHaveBeenCalledWith('chat-1');
  });

  it('does NOT call unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useChatSession('chat-1'));
    unmount();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it('does NOT call unsubscribe when chatId changes', () => {
    const { rerender } = renderHook(({ chatId }) => useChatSession(chatId), {
      initialProps: { chatId: 'chat-1' as string | null },
    });
    rerender({ chatId: 'chat-2' });
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- --run src/__tests__/hooks/useChatSession-subscription.test.ts`
Expected: FAIL — "does NOT call unsubscribe on unmount" fails because cleanup still calls `unsubscribe`.

- [ ] **Step 3: Remove unsubscribe from cleanup**

In `packages/desktop/src/renderer/hooks/useChatSession.ts`, change the cleanup function (lines 70-75) from:

```typescript
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (verifyPermissionTimerRef.current) clearTimeout(verifyPermissionTimerRef.current);
      daemonClient.unsubscribe(chatId);
      unsubConnection();
    };
```

to:

```typescript
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (verifyPermissionTimerRef.current) clearTimeout(verifyPermissionTimerRef.current);
      unsubConnection();
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- --run src/__tests__/hooks/useChatSession-subscription.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Run all desktop tests to check for regressions**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- --run`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useChatSession.ts packages/desktop/src/__tests__/hooks/useChatSession-subscription.test.ts
git commit -m "fix(desktop): stop unsubscribing background chats on tab switch

Background chats were missing permission.requested and chat.updated
events because useChatSession cleanup called unsubscribe(chatId).
The daemon then stopped forwarding events, leaving the CLI blocked
forever waiting for a permission response no one could see.

Fixes #49"
```

---

### Task 3: Typecheck and verify

- [ ] **Step 1: Run typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test -- --run`
Expected: All tests pass across all packages.

- [ ] **Step 3: Add changeset**

Run: `pnpm changeset` — pick `@qlan-ro/mainframe-desktop`, bump type `patch`.

Summary: `fix: keep WS subscriptions alive for background chats so permission requests are not silently dropped`

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for background permission fix"
```
