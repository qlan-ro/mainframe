import { describe, it, expect, vi } from 'vitest';
import { PlanModeHandler, type PlanModeContext } from '../chat/plan-mode-handler.js';
import type { Chat, ControlResponse } from '@qlan-ro/mainframe-types';
import type { ActiveChat } from '../chat/types.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { PlanModeActionHandler } from '../chat/plan-mode-actions.js';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    permissionMode: 'default',
    planMode: true,
    processState: 'working',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

function makeSession(active = true) {
  if (!active) return null;
  return {
    isSpawned: true,
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    removeAllListeners: vi.fn(),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockHandler(): PlanModeActionHandler & {
  onApprove: ReturnType<typeof vi.fn>;
  onApproveAndClearContext: ReturnType<typeof vi.fn>;
  onReject: ReturnType<typeof vi.fn>;
  onRevise: ReturnType<typeof vi.fn>;
} {
  return {
    onApprove: vi.fn().mockResolvedValue(undefined),
    onApproveAndClearContext: vi.fn().mockResolvedValue(undefined),
    onReject: vi.fn().mockResolvedValue(undefined),
    onRevise: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAdapters(handler: PlanModeActionHandler | null): AdapterRegistry {
  const factory = handler ? () => handler : undefined;
  const adapter = {
    id: 'claude',
    name: 'Claude',
    capabilities: { planMode: handler !== null },
    ...(factory ? { createPlanModeHandler: factory } : {}),
  };
  return {
    get: vi.fn().mockReturnValue(adapter),
  } as unknown as AdapterRegistry;
}

function makeContext(
  hasActiveSession = true,
  actionHandler: PlanModeActionHandler | null = makeMockHandler(),
): PlanModeContext & {
  emitEvent: ReturnType<typeof vi.fn>;
  startChat: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof makeSession>;
  handler: PlanModeActionHandler | null;
} {
  const chat = makeChat();
  const session = makeSession(hasActiveSession);
  const activeChat: ActiveChat = { chat, session: session as any };

  return {
    permissions: {
      shift: vi.fn(),
      enqueue: vi.fn(),
      hasPending: vi.fn(),
      clear: vi.fn(),
    } as any,
    messages: {
      get: vi.fn().mockReturnValue([]),
      set: vi.fn(),
    } as any,
    db: {
      chats: { update: vi.fn(), addPlanFile: vi.fn().mockReturnValue(false) },
    } as any,
    adapters: makeAdapters(actionHandler),
    getActiveChat: vi.fn().mockReturnValue(activeChat),
    emitEvent: vi.fn(),
    clearDisplayCache: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    session,
    handler: actionHandler,
  };
}

function makeResponse(overrides?: Partial<ControlResponse>): ControlResponse {
  return {
    requestId: 'req-1',
    toolUseId: 'tu-1',
    behavior: 'allow',
    updatedInput: {},
    ...overrides,
  };
}

describe('PlanModeHandler (dispatcher)', () => {
  describe('handleNoProcess', () => {
    it('updates permissionMode and clears planMode without delegating', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleNoProcess('chat-1', active, makeResponse({ executionMode: 'yolo' }));

      expect(ctx.db.chats.update).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ permissionMode: 'yolo', planMode: false }),
      );
      expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
      expect(active.chat.permissionMode).toBe('yolo');
      expect(active.chat.planMode).toBe(false);
      // Does NOT delegate — the adapter handler should not be invoked from no-process.
      const h = ctx.handler as ReturnType<typeof makeMockHandler>;
      expect(h.onApprove).not.toHaveBeenCalled();
      expect(h.onApproveAndClearContext).not.toHaveBeenCalled();
    });

    it('falls back to "default" when executionMode is not provided', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleNoProcess('chat-1', active, makeResponse());

      expect(ctx.db.chats.update).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ permissionMode: 'default', planMode: false }),
      );
    });

    it('does not emit chat.updated when mode is unchanged and planMode is already false', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;
      active.chat.permissionMode = 'default';
      active.chat.planMode = false;

      await handler.handleNoProcess('chat-1', active, makeResponse({ executionMode: 'default' }));

      expect(ctx.emitEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
      expect(ctx.db.chats.update).not.toHaveBeenCalled();
    });

    it('emits chat.updated when planMode is true even if permissionMode unchanged', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;
      active.chat.permissionMode = 'default';
      active.chat.planMode = true;

      await handler.handleNoProcess('chat-1', active, makeResponse({ executionMode: 'default' }));

      expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
      expect(active.chat.planMode).toBe(false);
    });
  });

  describe('handleClearContext', () => {
    it('delegates to the adapter handler onApproveAndClearContext', async () => {
      const ctx = makeContext(true);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;
      const response = makeResponse();

      await handler.handleClearContext('chat-1', active, response);

      const h = ctx.handler as ReturnType<typeof makeMockHandler>;
      expect(h.onApproveAndClearContext).toHaveBeenCalledTimes(1);
      expect(h.onApproveAndClearContext).toHaveBeenCalledWith(
        response,
        expect.objectContaining({
          chatId: 'chat-1',
          active,
          chat: active.chat,
        }),
      );
    });

    it('returns without throwing when adapter has no createPlanModeHandler factory', async () => {
      const ctx = makeContext(true, null);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await expect(handler.handleClearContext('chat-1', active, makeResponse())).resolves.not.toThrow();
      // No delegation happened (handler is null), and no chat mutation either.
      expect(ctx.startChat).not.toHaveBeenCalled();
    });

    it('returns without throwing when adapter is not registered', async () => {
      const ctx = makeContext(true, null);
      // Simulate registry returning undefined
      (ctx.adapters.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await expect(handler.handleClearContext('chat-1', active, makeResponse())).resolves.not.toThrow();
    });
  });

  describe('handleEscalation', () => {
    it('delegates to the adapter handler onApprove', async () => {
      const ctx = makeContext(true);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;
      const response = makeResponse({ executionMode: 'yolo' });

      await handler.handleEscalation('chat-1', active, response);

      const h = ctx.handler as ReturnType<typeof makeMockHandler>;
      expect(h.onApprove).toHaveBeenCalledTimes(1);
      expect(h.onApprove).toHaveBeenCalledWith(
        response,
        expect.objectContaining({
          chatId: 'chat-1',
          active,
          chat: active.chat,
        }),
      );
    });

    it('returns without throwing when adapter has no createPlanModeHandler factory', async () => {
      const ctx = makeContext(true, null);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await expect(handler.handleEscalation('chat-1', active, makeResponse())).resolves.not.toThrow();
    });
  });
});
