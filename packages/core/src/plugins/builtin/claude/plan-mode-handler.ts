import type { ControlResponse } from '@qlan-ro/mainframe-types';
import type { PlanModeActionHandler, PlanActionContext } from '../../../chat/plan-mode-actions.js';
import { extractLatestPlanFileFromMessages } from '../../../chat/context-tracker.js';

export class ClaudePlanModeHandler implements PlanModeActionHandler {
  async onApprove(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    ctx.db.chats.update(ctx.chatId, { planMode: false, permissionMode: exec });
    ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat });

    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.setPermissionMode(exec);
      await ctx.active.session.respondToPermission(response);
    }
  }

  async onApproveAndClearContext(response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    const exec = (response.executionMode ?? 'default') as 'default' | 'acceptEdits' | 'yolo';
    const plan = (response.updatedInput as Record<string, unknown> | undefined)?.plan as string | undefined;

    const recoveredPlanPath = extractLatestPlanFileFromMessages(ctx.messages.get(ctx.chatId) ?? []);
    if (recoveredPlanPath && ctx.db.chats.addPlanFile(ctx.chatId, recoveredPlanPath)) {
      ctx.emitEvent({ type: 'context.updated', chatId: ctx.chatId });
    }

    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.respondToPermission({
        ...response,
        behavior: 'deny',
        message: 'User chose to clear context and start a new session.',
      });
      ctx.permissions.shift(ctx.chatId);
      await ctx.active.session.kill();
      ctx.active.session = null;
    } else {
      ctx.permissions.shift(ctx.chatId);
    }

    ctx.chat.claudeSessionId = undefined;
    ctx.chat.planMode = false;
    ctx.chat.permissionMode = exec;
    ctx.db.chats.update(ctx.chatId, { claudeSessionId: undefined, planMode: false, permissionMode: exec });
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
    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.respondToPermission(response);
    }
  }

  async onRevise(_feedback: string, response: ControlResponse, ctx: PlanActionContext): Promise<void> {
    // Claude handles feedback via respondToPermission's message field
    if (ctx.active.session?.isSpawned) {
      await ctx.active.session.respondToPermission(response);
    }
  }
}
