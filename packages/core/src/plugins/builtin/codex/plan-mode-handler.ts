import type { ControlResponse } from '@qlan-ro/mainframe-types';
import type { PlanModeActionHandler, PlanActionContext } from '../../../chat/plan-mode-actions.js';

/**
 * Codex plan-mode uses per-turn `collaborationMode`. Answering the
 * requestUserInput exit prompt with the correct option + flipping
 * `chat.planMode` is sufficient to exit plan mode for the next turn.
 *
 * The approval-handler (see `approval-handler.ts`) knows how to map our
 * `allow`/`deny` behavior onto the Codex option index based on the rendered
 * option labels captured when the request arrived.
 */
export class CodexPlanModeHandler implements PlanModeActionHandler {
  async onApprove(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    ctx.db.chats.update(ctx.chatId, { planMode: false, permissionMode: exec });
    ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat });

    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      setPlanMode?(on: boolean): void;
      respondToPermission(r: ControlResponse): Promise<void>;
    } | null;
    if (session?.isSpawned) {
      session.setPlanMode?.(false);
      await session.respondToPermission(response);
    }
  }

  async onApproveAndClearContext(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    const planRaw = response.updatedInput?.plan;
    const plan = typeof planRaw === 'string' ? planRaw : undefined;

    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      respondToPermission(r: ControlResponse): Promise<void>;
      kill(): Promise<void>;
    } | null;

    if (session?.isSpawned) {
      // Close the requestUserInput by denying first so Codex unblocks the turn.
      await session.respondToPermission({ ...response, behavior: 'deny', message: 'Clearing context.' });
      ctx.permissions.shift(ctx.chatId);
      await session.kill();
      ctx.active.session = null;
    } else {
      ctx.permissions.shift(ctx.chatId);
    }

    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    // Codex's equivalent of `claudeSessionId` is the thread id; drop it to
    // force a new thread on respawn.
    ctx.chat.claudeSessionId = undefined;
    ctx.db.chats.update(ctx.chatId, {
      claudeSessionId: undefined,
      planMode: false,
      permissionMode: exec,
    });
    ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat });

    ctx.messages.set(ctx.chatId, []);
    ctx.clearDisplayCache(ctx.chatId);
    ctx.emitEvent({ type: 'messages.cleared', chatId: ctx.chatId });

    await ctx.startChat(ctx.chatId);
    if (plan) {
      await ctx.sendMessage(ctx.chatId, `Implement the following plan:\n\n${plan}`);
    }
  }

  async onReject(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      respondToPermission(r: ControlResponse): Promise<void>;
    } | null;
    if (session?.isSpawned) {
      await session.respondToPermission(response);
    }
  }

  async onRevise(_feedback: string, response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    // The caller attaches the user's revise feedback to `response.message`.
    // Forward unchanged — the approval-handler's resolve() translates the
    // free-form answer for Codex (falling back to the deny option if Codex
    // rejects free-form for this requestUserInput).
    const session = ctx.active.session as unknown as {
      isSpawned: boolean;
      respondToPermission(r: ControlResponse): Promise<void>;
    } | null;
    if (session?.isSpawned) {
      await session.respondToPermission(response);
    }
  }
}
