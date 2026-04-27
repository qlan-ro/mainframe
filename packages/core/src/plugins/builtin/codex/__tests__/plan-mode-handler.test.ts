import { describe, it, expect, vi } from 'vitest';
import { CodexPlanModeHandler } from '../plan-mode-handler.js';
import type { PlanActionContext } from '../../../../chat/plan-mode-actions.js';
import type { ControlResponse } from '@qlan-ro/mainframe-types';

function mkCtx(overrides: { hasSession?: boolean } = {}) {
  const { hasSession = true } = overrides;
  const session = hasSession
    ? {
        isSpawned: true,
        setPlanMode: vi.fn(),
        respondToPermission: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
      }
    : null;
  const chat = {
    id: 'c1',
    planMode: true,
    permissionMode: 'acceptEdits' as const,
    adapterId: 'codex',
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
    messages: { get: vi.fn().mockReturnValue([]), set: vi.fn() } as any,
    permissions: { shift: vi.fn() } as any,
    emitEvent: vi.fn(),
    clearDisplayCache: vi.fn(),
    startChat: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as PlanActionContext;
}

describe('CodexPlanModeHandler', () => {
  const planText = 'PROPOSED PLAN TEXT';
  const baseResponse: ControlResponse = {
    requestId: 'r1',
    toolUseId: 'tc1',
    behavior: 'allow',
    toolName: 'ExitPlanMode',
    executionMode: 'acceptEdits',
    updatedInput: { plan: planText },
  };

  it('onApprove responds with first option and clears planMode', async () => {
    const ctx = mkCtx();
    const h = new CodexPlanModeHandler();
    await h.onApprove(baseResponse, ctx);
    expect(ctx.chat.planMode).toBe(false);
    expect(ctx.db.chats.update).toHaveBeenCalledWith('c1', { planMode: false, permissionMode: 'acceptEdits' });
    expect((ctx.active.session as any).setPlanMode).toHaveBeenCalledWith(false);
    expect((ctx.active.session as any).respondToPermission).toHaveBeenCalledWith(baseResponse);
    expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.updated' }));
  });

  // Option A (chat-manager restart flow): assert ctx.startChat + ctx.sendMessage,
  // mirroring ClaudePlanModeHandler. We avoid adding a parallel startNewThread
  // API on CodexSession — the chat-manager restart path already does a full
  // respawn and Codex's first sendMessage creates a new thread when
  // claudeSessionId (thread id) is cleared.
  it('onApproveAndClearContext kills session, clears thread id, and triggers chat-manager restart with plan', async () => {
    const ctx = mkCtx();
    const session = ctx.active.session as any;
    const h = new CodexPlanModeHandler();
    await h.onApproveAndClearContext(baseResponse, ctx);

    expect(session.respondToPermission).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'deny', requestId: 'r1' }),
    );
    expect(session.kill).toHaveBeenCalled();
    expect(ctx.db.chats.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ claudeSessionId: undefined, planMode: false, permissionMode: 'acceptEdits' }),
    );
    expect(ctx.chat.planMode).toBe(false);
    expect(ctx.messages.set).toHaveBeenCalledWith('c1', []);
    expect(ctx.clearDisplayCache).toHaveBeenCalledWith('c1');
    expect(ctx.emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'messages.cleared', chatId: 'c1' }));
    expect(ctx.startChat).toHaveBeenCalledWith('c1');
    expect(ctx.sendMessage).toHaveBeenCalledWith('c1', expect.stringContaining(planText));
  });

  it('onApproveAndClearContext works when session is null (no-process path)', async () => {
    const ctx = mkCtx({ hasSession: false });
    const h = new CodexPlanModeHandler();
    await expect(h.onApproveAndClearContext(baseResponse, ctx)).resolves.not.toThrow();
    expect(ctx.permissions.shift).toHaveBeenCalledWith('c1');
    expect(ctx.startChat).toHaveBeenCalledWith('c1');
  });

  it('onReject responds with the deny option', async () => {
    const ctx = mkCtx();
    const h = new CodexPlanModeHandler();
    const rejectResp: ControlResponse = { ...baseResponse, behavior: 'deny' };
    await h.onReject(rejectResp, ctx);
    expect((ctx.active.session as any).respondToPermission).toHaveBeenCalledWith(rejectResp);
  });

  it('onRevise forwards the response (with feedback in message) to the session', async () => {
    const ctx = mkCtx();
    const h = new CodexPlanModeHandler();
    const reviseResp: ControlResponse = { ...baseResponse, behavior: 'deny', message: 'rework step 3' };
    await h.onRevise('rework step 3', reviseResp, ctx);
    expect((ctx.active.session as any).respondToPermission).toHaveBeenCalledWith(reviseResp);
  });
});
