import { describe, it, expect, vi } from 'vitest';
import { ClaudePlanModeHandler } from '../plan-mode-handler.js';
import type { PlanActionContext } from '../../../../chat/plan-mode-actions.js';
import type { ControlResponse } from '@qlan-ro/mainframe-types';

function mkContext(overrides: Partial<PlanActionContext> & { hasSession?: boolean } = {}): PlanActionContext {
  const { hasSession = true, ...rest } = overrides;
  const session = hasSession
    ? {
        isSpawned: true,
        setPermissionMode: vi.fn().mockResolvedValue(undefined),
        respondToPermission: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
      }
    : null;
  const chat = {
    id: 'c1',
    planMode: true,
    permissionMode: 'acceptEdits' as const,
    adapterId: 'claude',
    projectId: 'p1',
    status: 'active' as const,
    createdAt: '',
    updatedAt: '',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
  };
  return {
    chatId: 'c1',
    active: { chat, session: session as any },
    chat,
    db: { chats: { update: vi.fn(), addPlanFile: vi.fn().mockReturnValue(false) } } as any,
    messages: { get: vi.fn().mockReturnValue([]), set: vi.fn() } as any,
    permissions: { shift: vi.fn() } as any,
    emitEvent: vi.fn(),
    clearDisplayCache: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...rest,
  };
}

describe('ClaudePlanModeHandler', () => {
  const baseResponse: ControlResponse = {
    requestId: 'r1',
    toolUseId: 't1',
    behavior: 'allow',
    toolName: 'ExitPlanMode',
    executionMode: 'acceptEdits',
  };

  it('onApprove clears planMode and calls setPermissionMode with the base mode', async () => {
    const ctx = mkContext();
    const handler = new ClaudePlanModeHandler();
    await handler.onApprove(baseResponse, ctx);

    expect(ctx.chat.planMode).toBe(false);
    expect(ctx.db.chats.update).toHaveBeenCalledWith('c1', { planMode: false, permissionMode: 'acceptEdits' });
    expect(ctx.active.session!.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('onReject forwards the deny message with Claude preamble handled by respondToPermission', async () => {
    const ctx = mkContext();
    const handler = new ClaudePlanModeHandler();
    const denyResponse: ControlResponse = { ...baseResponse, behavior: 'deny', message: 'needs more work' };
    await handler.onReject(denyResponse, ctx);
    expect(ctx.active.session!.respondToPermission).toHaveBeenCalledWith(denyResponse);
  });

  it('onApproveAndClearContext kills session, resets claudeSessionId, clears messages, starts new chat', async () => {
    const ctx = mkContext();
    const session = ctx.active.session!;
    const handler = new ClaudePlanModeHandler();
    await handler.onApproveAndClearContext(baseResponse, ctx);

    expect(session.kill).toHaveBeenCalled();
    expect(ctx.db.chats.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ claudeSessionId: undefined, planMode: false, permissionMode: 'acceptEdits' }),
    );
    expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'messages.cleared', chatId: 'c1' }));
    expect(ctx.startChat).toHaveBeenCalledWith('c1');
    expect(ctx.messages.set).toHaveBeenCalledWith('c1', []);
    expect(ctx.clearDisplayCache).toHaveBeenCalledWith('c1');
  });

  it('onApproveAndClearContext sends follow-up message when plan is provided in updatedInput', async () => {
    const ctx = mkContext();
    const handler = new ClaudePlanModeHandler();
    const responseWithPlan: ControlResponse = {
      ...baseResponse,
      updatedInput: { plan: 'Step 1: do the thing.' },
    };
    await handler.onApproveAndClearContext(responseWithPlan, ctx);

    expect(ctx.sendMessage).toHaveBeenCalledWith('c1', expect.stringContaining('Step 1: do the thing.'));
  });

  it('onApproveAndClearContext works when session is null (no-process path)', async () => {
    const ctx = mkContext({ hasSession: false });
    const handler = new ClaudePlanModeHandler();

    await expect(handler.onApproveAndClearContext(baseResponse, ctx)).resolves.not.toThrow();
    expect(ctx.permissions.shift).toHaveBeenCalledWith('c1');
    expect(ctx.startChat).toHaveBeenCalledWith('c1');
  });
});
