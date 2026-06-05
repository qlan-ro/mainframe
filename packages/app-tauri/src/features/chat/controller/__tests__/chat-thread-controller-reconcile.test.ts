/**
 * Behavior tests for the `reconcilePendingOnAdd` logic (fix #5).
 *
 * reconcilePendingOnAdd is private, so we drive it through the controller's
 * public surface:
 *
 *   1. Call sendMessage() to enqueue an optimistic pending entry.
 *   2. Deliver a `display.message.added` DaemonEvent through the ws onEvent
 *      handler (captured from the fake client).
 *   3. Assert on getState().pendingUserMessages.
 *
 * The fake WS client captures the onEvent handler so the test can invoke it
 * directly to simulate the daemon echoing the user message back.
 *
 * Module mocks
 * ------------
 * - lib/api/attachments → uploadAttachments
 * - lib/api/chats       → getChatMessages, resumeChat (and others)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type { DaemonEvent, DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';

// ---------------------------------------------------------------------------
// Mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock('../../../../lib/api/attachments', () => ({
  uploadAttachments: vi.fn().mockResolvedValue(['id-1']),
}));

vi.mock('../../../../lib/api/chats', () => ({
  getChatMessages: vi.fn().mockResolvedValue([]),
  resumeChat: vi.fn().mockResolvedValue(undefined),
  interruptChat: vi.fn().mockResolvedValue(undefined),
  cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
  editQueuedMessage: vi.fn().mockResolvedValue(undefined),
}));

import { ChatThreadController } from '../chat-thread-controller';

// ---------------------------------------------------------------------------
// Fake WS client — exposes captured onEvent handler so tests can push events
// ---------------------------------------------------------------------------

interface FakeWs {
  fakeClient: DaemonWsClient;
  pushEvent: (event: DaemonEvent) => void;
}

function makeFakeWs(): FakeWs {
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;

  const fakeClient: DaemonWsClient = {
    get connected() {
      return false;
    },
    send: () => {},
    onEvent(handler: (event: DaemonEvent) => void) {
      capturedHandler = handler;
      return () => {
        capturedHandler = null;
      };
    },
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection: () => () => {},
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;

  function pushEvent(event: DaemonEvent): void {
    if (!capturedHandler) throw new Error('onEvent handler not yet registered');
    capturedHandler(event);
  }

  return { fakeClient, pushEvent };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = 'chat-rec';
const PORT = 9999;

function textMsg(text: string): AppendMessage {
  return {
    role: 'user',
    content: text ? [{ type: 'text', text }] : [],
    attachments: [],
    parentId: null,
  } as unknown as AppendMessage;
}

function attachOnlyMsg(): AppendMessage {
  return {
    role: 'user',
    content: [],
    attachments: [
      {
        id: 'att-1',
        type: 'image',
        name: 'photo.png',
        contentType: 'image/png',
        status: { type: 'complete' },
        content: [{ type: 'image', image: 'data:image/png;base64,aGVsbG8=' }],
      },
    ],
    parentId: null,
  } as unknown as AppendMessage;
}

/** Build a display.message.added DaemonEvent for CHAT_ID. */
function addedEvent(id: string, content: DisplayContent[]): DaemonEvent {
  const message: DisplayMessage = {
    id,
    chatId: CHAT_ID,
    type: 'user',
    content,
    timestamp: new Date().toISOString(),
  };
  return { type: 'display.message.added', chatId: CHAT_ID, message };
}

/** Trigger ensureWsSubscription by subscribing a listener. */
function activate(ctrl: ChatThreadController): () => void {
  return ctrl.subscribe(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (a) Attachment-only optimistic send reconciles on an image-only echo
// ---------------------------------------------------------------------------

describe('reconcilePendingOnAdd — attachment-only optimistic send', () => {
  it('removes the pending entry when the echoed server message has no text block', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    activate(ctrl);

    await ctrl.sendMessage(attachOnlyMsg());

    // One pending entry with empty text must exist before the echo.
    const beforePending = Object.values(ctrl.getState().pendingUserMessages);
    expect(beforePending).toHaveLength(1);
    expect(beforePending[0]!.text).toBe('');

    // Deliver a server user message that has only an image block (no text).
    pushEvent(addedEvent('srv-msg-1', [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }]));

    // The pending entry must be reconciled (removed).
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (b) No cross-contamination: text-bearing server message does NOT reconcile
//     an attachment-only pending
// ---------------------------------------------------------------------------

describe('reconcilePendingOnAdd — no cross-contamination', () => {
  it('does NOT reconcile an attachment-only pending when the server message has text', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    activate(ctrl);

    await ctrl.sendMessage(attachOnlyMsg());

    const beforePending = Object.values(ctrl.getState().pendingUserMessages);
    expect(beforePending).toHaveLength(1);
    expect(beforePending[0]!.text).toBe('');

    // Deliver a server message WITH text — must not reconcile the empty-text pending.
    pushEvent(addedEvent('srv-msg-2', [{ type: 'text', text: 'some text from another message' }]));

    // The pending entry must still be present.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
    expect(Object.values(ctrl.getState().pendingUserMessages)[0]!.text).toBe('');
  });

  it('does NOT reconcile a text pending when the server message has no text block', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    activate(ctrl);

    await ctrl.sendMessage(textMsg('hello world'));

    const beforePending = Object.values(ctrl.getState().pendingUserMessages);
    expect(beforePending).toHaveLength(1);
    expect(beforePending[0]!.text).toBe('hello world');

    // Deliver a server message with only an image block — must not reconcile
    // the text-bearing pending entry.
    pushEvent(addedEvent('srv-msg-3', [{ type: 'image', mediaType: 'image/png', data: 'abc' }]));

    // The text-bearing pending must still be present.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
    expect(Object.values(ctrl.getState().pendingUserMessages)[0]!.text).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// (c) Text-fingerprint match still works
// ---------------------------------------------------------------------------

describe('reconcilePendingOnAdd — text-fingerprint match', () => {
  it('reconciles a text-bearing pending when the echoed server message text matches', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    activate(ctrl);

    await ctrl.sendMessage(textMsg('  Hello   World  '));

    const beforePending = Object.values(ctrl.getState().pendingUserMessages);
    expect(beforePending).toHaveLength(1);
    expect(beforePending[0]!.text).toBe('Hello   World');

    // Deliver a server message with matching text (normalized: "hello world").
    pushEvent(addedEvent('srv-msg-4', [{ type: 'text', text: 'Hello   World' }]));

    // The pending entry must be removed.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(0);
  });

  it('does NOT reconcile when the text fingerprints differ', async () => {
    const { fakeClient, pushEvent } = makeFakeWs();
    const ctrl = new ChatThreadController(CHAT_ID, PORT, fakeClient);
    activate(ctrl);

    await ctrl.sendMessage(textMsg('hello'));

    // Deliver a server message with different text.
    pushEvent(addedEvent('srv-msg-5', [{ type: 'text', text: 'goodbye' }]));

    // The pending must remain.
    expect(Object.keys(ctrl.getState().pendingUserMessages)).toHaveLength(1);
    expect(Object.values(ctrl.getState().pendingUserMessages)[0]!.text).toBe('hello');
  });
});
