/**
 * Shared fixtures for the AcpChatController / AcpSessionPlane test family.
 * NOT a `.test.ts` file — vitest's include glob only picks up `*.test.ts(x)`,
 * so this module contributes no test cases of its own.
 *
 * `vi.mock(...)` calls stay in each test file (vitest hoists them per-module,
 * so a shared mock here would not apply to the importing file) — only the
 * fixture builders and the fake ACP client/WS live here.
 */
import { vi } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import type {
  Chat,
  ClientEvent,
  DaemonEvent,
  JsonRpcRequestId,
  PromptRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionResponse,
  SessionUpdate,
} from '@qlan-ro/mainframe-types';
import type { DaemonWsClient } from '../../../../lib/daemon/ws-client';
import type {
  GapListener,
  GateResolvedListener,
  PermissionRequestListener,
  ReplayCursor,
  CompactionListener,
  SessionUpdateListener,
} from '../../../../lib/daemon/acp-client';
import { AcpChatController, type AcpClientHandle } from '../acp-chat-controller';

export const CHAT_ID = 'chat-abc';
export const PORT = 9999;

// ---------------------------------------------------------------------------
// Fake ACP facade client — the `resolveClient` test seam.
// ---------------------------------------------------------------------------

export interface FakeAcpClient extends AcpClientHandle {
  readonly promptCalls: Array<{ sessionId: string; text: string; extra?: Pick<PromptRequest, '_meta'> }>;
  readonly resumeCalls: Array<{ sessionId: string; cursor: ReplayCursor | undefined }>;
  readonly cancelCalls: string[];
  readonly respondCalls: Array<{ id: JsonRpcRequestId; response: RequestPermissionResponse }>;
  /** Controls the next resume() response's `_meta['_mainframe.dev']`. */
  nextResumeMeta: { itemCount?: number; fullReplay?: boolean } | undefined;
  emitUpdate(sessionId: string, update: SessionUpdate): void;
  emitPermissionRequest(id: JsonRpcRequestId, request: RequestPermissionRequest): void;
  emitGateResolved(sessionId: string, requestId: string): void;
  emitCompaction(sessionId: string, phase: 'started' | 'done'): void;
  emitGap(): void;
}

export function makeFakeAcpClient(): FakeAcpClient {
  const updateListeners = new Set<SessionUpdateListener>();
  const permissionListeners = new Set<PermissionRequestListener>();
  const gateResolvedListeners = new Set<GateResolvedListener>();
  const compactionListeners = new Set<CompactionListener>();
  const gapListeners = new Set<GapListener>();

  const client: FakeAcpClient = {
    promptCalls: [],
    resumeCalls: [],
    cancelCalls: [],
    respondCalls: [],
    nextResumeMeta: undefined,

    ensureConnected: vi.fn().mockResolvedValue(undefined),

    onSessionUpdate(listener) {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    onPermissionRequest(listener) {
      permissionListeners.add(listener);
      return () => permissionListeners.delete(listener);
    },
    onGateResolved(listener) {
      gateResolvedListeners.add(listener);
      return () => gateResolvedListeners.delete(listener);
    },
    onCompaction(listener) {
      compactionListeners.add(listener);
      return () => compactionListeners.delete(listener);
    },
    onGap(listener) {
      gapListeners.add(listener);
      return () => gapListeners.delete(listener);
    },
    async prompt(sessionId, text, extra) {
      client.promptCalls.push({ sessionId, text, extra });
      return { _meta: {} } as PromptResponse;
    },
    cancel(sessionId) {
      client.cancelCalls.push(sessionId);
    },
    async resume(sessionId, _cwd, cursor) {
      client.resumeCalls.push({ sessionId, cursor });
      const meta = client.nextResumeMeta;
      return (meta ? { _meta: { '_mainframe.dev': meta } } : {}) as ResumeSessionResponse;
    },
    respondPermission(id, response) {
      client.respondCalls.push({ id, response });
    },

    emitUpdate(sessionId, update) {
      for (const l of updateListeners) l(sessionId, update);
    },
    emitPermissionRequest(id, request) {
      for (const l of permissionListeners) l(id, request);
    },
    emitGateResolved(sessionId, requestId) {
      for (const l of gateResolvedListeners) l(sessionId, requestId);
    },
    emitCompaction(sessionId, phase) {
      for (const l of compactionListeners) l(sessionId, phase);
    },
    emitGap() {
      for (const l of gapListeners) l();
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// Fake side-band WS client — same shape the legacy suites used.
// ---------------------------------------------------------------------------

export interface FakeWs {
  fakeClient: DaemonWsClient;
  sentEvents: ClientEvent[];
  pushEvent: (event: DaemonEvent) => void;
  connectionListeners: Array<() => void>;
}

export function makeFakeWs(options: { connected?: boolean } = {}): FakeWs {
  const sentEvents: ClientEvent[] = [];
  const connectionListeners: Array<() => void> = [];
  let capturedHandler: ((event: DaemonEvent) => void) | null = null;

  const fakeClient: DaemonWsClient = {
    get connected() {
      return options.connected ?? true;
    },
    send(event: ClientEvent) {
      sentEvents.push(event);
    },
    onEvent(handler: (event: DaemonEvent) => void) {
      capturedHandler = handler;
      return () => {
        capturedHandler = null;
      };
    },
    subscribe: () => {},
    unsubscribe: () => {},
    subscribeConnection(listener: () => void) {
      connectionListeners.push(listener);
      return () => {
        const i = connectionListeners.indexOf(listener);
        if (i >= 0) connectionListeners.splice(i, 1);
      };
    },
    setPort: () => {},
    connect: () => {},
    disconnect: () => {},
  } as unknown as DaemonWsClient;

  return {
    fakeClient,
    sentEvents,
    connectionListeners,
    pushEvent(event: DaemonEvent) {
      if (!capturedHandler) throw new Error('onEvent handler not yet registered — call subscribeLive() first');
      capturedHandler(event);
    },
  };
}

// ---------------------------------------------------------------------------
// Message / chat fixtures
// ---------------------------------------------------------------------------

export function makeChat(overrides: Partial<Chat> = {}): Chat {
  return { id: CHAT_ID, adapterId: 'claude', projectId: 'p1', directoryMissing: false, ...overrides } as Chat;
}

export function makeMsg(text: string, attachments: NonNullable<AppendMessage['attachments']> = []): AppendMessage {
  return {
    role: 'user',
    content: text ? [{ type: 'text', text }] : [],
    attachments,
    parentId: null,
  } as unknown as AppendMessage;
}

export function makeCompleteAttachment(name: string): NonNullable<AppendMessage['attachments']>[number] {
  return {
    id: `att-${name}`,
    type: 'image',
    name,
    contentType: 'image/png',
    status: { type: 'complete' },
    content: [{ type: 'image', image: 'data:image/png;base64,aGVsbG8=' }],
  };
}

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export function userMessageUpdate(messageId: string, text: string): SessionUpdate {
  return { sessionUpdate: 'user_message', messageId, content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Controller factory — always injects a fake resolveClient so a test never
// falls through to the real `getAcpFacadeClient` (which would try to open an
// actual WebSocket in the test environment).
// ---------------------------------------------------------------------------

export interface ControllerRig {
  ctrl: AcpChatController;
  ws: FakeWs;
  acpClient: FakeAcpClient;
}

export function makeController(chatId: string = CHAT_ID, options: { connected?: boolean } = {}): ControllerRig {
  const ws = makeFakeWs(options);
  const acpClient = makeFakeAcpClient();
  const ctrl = new AcpChatController(chatId, PORT, ws.fakeClient, () => acpClient);
  return { ctrl, ws, acpClient };
}
