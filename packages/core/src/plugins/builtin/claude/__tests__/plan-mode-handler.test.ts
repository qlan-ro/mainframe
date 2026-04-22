import { describe, it, expect, vi } from 'vitest';
import { ClaudePlanModeHandler } from '../plan-mode-handler.js';
import type { PlanActionContext } from '../../../../chat/plan-mode-actions.js';
import type { ControlResponse } from '@qlan-ro/mainframe-types';

function mkContext(overrides: Partial<PlanActionContext> = {}): PlanActionContext {
  const session = {
    isSpawned: true,
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
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
    db: { chats: { update: vi.fn() } } as any,
    messages: { get: vi.fn().mockReturnValue([]) } as any,
    permissions: { shift: vi.fn() } as any,
    emitEvent: vi.fn(),
    clearDisplayCache: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
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
});
