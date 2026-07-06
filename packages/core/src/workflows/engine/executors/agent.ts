import type { AgentStep, StepDef } from '../../dsl/types.js';
import type { StepContext, StepOutcome } from '../types.js';
import { renderValue } from '../../template/render.js';
import type { AgentWaitService } from '../../agent-waits.js';

export interface AgentChatPort {
  createChatAndSend(args: {
    projectId: string | undefined;
    adapterId: string;
    model: string | undefined;
    permissionMode: string | undefined;
    worktree: { baseBranch?: string; branchName: string } | undefined;
    prompt: string;
    origin: { runId: string; stepPath: string };
  }): Promise<{ chatId: string }>;
}

export function makeAgentExecutor(port: AgentChatPort, waits: AgentWaitService) {
  return async function executeAgent(ctx: StepContext, step: StepDef): Promise<StepOutcome> {
    const agentStep = step as AgentStep;
    const scratch = ctx.prior?.scratch as { chatId?: string } | null;
    const timeoutMinutes = agentStep.agent.timeoutMinutes ?? 120;
    const wakeAt = timeoutMinutes === 0 ? null : Date.now() + timeoutMinutes * 60_000;

    if (scratch?.chatId) {
      // Already sent — still waiting on the chat. Keep the existing wait.
      return { type: 'wait', wait: { kind: 'agent', wakeAt }, scratch: { chatId: scratch.chatId } };
    }

    const prompt = String(await renderValue(agentStep.agent.prompt, ctx.scope));
    const { chatId } = await port.createChatAndSend({
      projectId: agentStep.agent.projectId,
      adapterId: agentStep.agent.adapterId ?? 'claude',
      model: agentStep.agent.model,
      permissionMode: agentStep.agent.permissionMode,
      worktree: agentStep.agent.worktree,
      prompt,
      origin: { runId: ctx.run.id, stepPath: ctx.stepPath },
    });

    // Register the wait row immediately after chat creation. If the daemon
    // crashes between createChatAndSend and this line, the boot reconciler
    // (Task 16) finds a waiting step with no agent_waits row and marks it
    // ambiguous — the scratch chatId is the recovery source.
    waits.register(chatId, ctx.run.id, ctx.stepPath);

    return { type: 'wait', wait: { kind: 'agent', wakeAt }, scratch: { chatId } };
  };
}
