import { describe, it, expect, vi } from 'vitest';
import { PlanModeHandler, type PlanModeContext } from '../chat/plan-mode-handler.js';
import type { Chat, PermissionResponse } from '@mainframe/types';
import type { ActiveChat } from '../chat/types.js';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    permissionMode: 'plan',
    processState: 'working',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    ...overrides,
  };
}

function makeProcess() {
  return {
    id: 'proc-1',
    adapterId: 'claude',
    chatId: 'chat-1',
    pid: 0,
    status: 'ready' as const,
    projectPath: '/tmp',
    model: 'test',
  };
}

function makeContext(activeProcess = true): PlanModeContext & {
  emitEvent: ReturnType<typeof vi.fn>;
  startChat: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  adapter: { respondToPermission: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> };
} {
  const chat = makeChat();
  const process = activeProcess ? makeProcess() : null;
  const adapter = {
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
  const activeChat: ActiveChat = { chat, process };

  return {
    permissions: {
      getPlanExecutionMode: vi.fn().mockReturnValue(undefined),
      deletePlanExecutionMode: vi.fn(),
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
    adapters: {
      get: vi.fn().mockReturnValue(adapter),
    } as any,
    getActiveChat: vi.fn().mockReturnValue(activeChat),
    emitEvent: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    adapter,
  };
}

function makeResponse(overrides?: Partial<PermissionResponse>): PermissionResponse {
  return {
    requestId: 'req-1',
    toolUseId: 'tu-1',
    behavior: 'allow',
    updatedInput: {},
    ...overrides,
  };
}

describe('PlanModeHandler', () => {
  describe('handleNoProcess', () => {
    it('updates permissionMode when response specifies a new mode', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleNoProcess('chat-1', active, makeResponse({ executionMode: 'yolo' }));

      expect(ctx.db.chats.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({ permissionMode: 'yolo' }));
      expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
    });

    it('does not emit chat.updated when mode is unchanged', async () => {
      const ctx = makeContext();
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;
      active.chat.permissionMode = 'plan';

      await handler.handleNoProcess('chat-1', active, makeResponse({ executionMode: 'plan' }));

      expect(ctx.emitEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
    });
  });

  describe('handleClearContext', () => {
    it('kills process, resets session, clears messages, starts new chat', async () => {
      const ctx = makeContext(true);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleClearContext('chat-1', active, makeResponse());

      expect(ctx.adapter.kill).toHaveBeenCalled();
      expect(ctx.db.chats.update).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ claudeSessionId: undefined }),
      );
      expect(ctx.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'messages.cleared', chatId: 'chat-1' }),
      );
      expect(ctx.startChat).toHaveBeenCalledWith('chat-1');
    });

    it('sends follow-up message when plan is provided', async () => {
      const ctx = makeContext(true);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await handler.handleClearContext(
        'chat-1',
        active,
        makeResponse({
          updatedInput: { plan: 'Step 1: do the thing.' },
        }),
      );

      expect(ctx.sendMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('Step 1: do the thing.'));
    });

    it('works without an active process (process=null)', async () => {
      const ctx = makeContext(false);
      const handler = new PlanModeHandler(ctx);
      const active = ctx.getActiveChat('chat-1')!;

      await expect(handler.handleClearContext('chat-1', active, makeResponse())).resolves.not.toThrow();
      expect(ctx.startChat).toHaveBeenCalledWith('chat-1');
    });
  });

  describe('handleEscalation', () => {
    it('updates permissionMode and calls setPermissionMode on adapter', async () => {
      const mockProcess = makeProcess();
      const ctx = makeContext();
      const active = ctx.getActiveChat('chat-1')!;
      active.process = mockProcess;
      ctx.adapters.get = vi.fn().mockReturnValue({
        setPermissionMode: vi.fn().mockResolvedValue(undefined),
        ...ctx.adapter,
      });

      const handler = new PlanModeHandler(ctx);
      await handler.handleEscalation('chat-1', active, makeResponse({ executionMode: 'yolo' }));

      expect(ctx.db.chats.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({ permissionMode: 'yolo' }));
      expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
    });
  });
});
