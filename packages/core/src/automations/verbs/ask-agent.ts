// packages/core/src/automations/verbs/ask-agent.ts
//
// Task 19 (contract §5, §9). `makeAskAgentExecutor` is the ask_agent arm of
// VerbPorts: it renders the prompt, creates a chat via the injected
// AgentChatPort, registers the wait, and parks. `AgentWaitService`
// (agent-waits.ts) is the waker: chat.updated wiring (Task 23) calls
// onChatFinished, which writes the outcome into the checkpoint and advances.
//
// PREREQUISITE (contract §9): `createChatWithDefaults` has no
// autoApprove/timeoutMinutes params today — autoApprove is authorable but
// not executable until that lands, so the step fails loudly instead of
// silently dropping the scope. timeoutMinutes IS wired at the engine level
// via `wakeAt` (the interpreter's deadline sweep); only the "ChatManager
// itself isn't told to stop generating" gap gets a warning.
import type { Logger } from 'pino';
import type { AskAgentStep } from '@qlan-ro/mainframe-types';
import { renderChipText } from '../tokens/substitute.js';
import type { AgentWaitService } from './agent-waits.js';
import type { StepOutcome, VerbContext } from '../engine/types.js';

export interface AgentChatPort {
  createChatAndSend(args: {
    projectId: string | undefined;
    adapterId: string;
    model: string | undefined;
    permissionMode: string | undefined;
    worktree: { baseBranch?: string; branchName: string } | undefined;
    prompt: string;
  }): Promise<{ chatId: string }>;
  sendMessage(chatId: string, content: string): Promise<void>;
}

export function makeAskAgentExecutor(port: AgentChatPort, waits: AgentWaitService, logger: Logger) {
  return async function askAgent(step: AskAgentStep, ctx: VerbContext): Promise<StepOutcome> {
    const existing = waits.findByRunStep(ctx.runId, ctx.stepRef);
    if (existing) return { type: 'wait', wakeAt: null, kind: 'ask_agent' };

    if (step.autoApprove && step.autoApprove.length > 0) {
      logger.warn(
        { stepId: step.id, autoApprove: step.autoApprove },
        'ask_agent.autoApprove is authorable but not yet executable (contract §9 prerequisite unmet)',
      );
      return { type: 'failed', error: 'auto-approve scope not yet supported' };
    }
    if (step.timeoutMinutes !== undefined) {
      logger.warn(
        { stepId: step.id, timeoutMinutes: step.timeoutMinutes },
        'ask_agent.timeoutMinutes only stops the automation from waiting past the deadline; the chat itself is not told to stop generating',
      );
    }

    const prompt = renderChipText(ctx.tokens, step.prompt);
    const worktree = step.worktree
      ? { baseBranch: step.worktree.baseBranch, branchName: renderChipText(ctx.tokens, step.worktree.branchName) }
      : undefined;

    const { chatId } = await port.createChatAndSend({
      projectId: step.projectId,
      adapterId: step.adapterId ?? 'claude',
      model: step.model,
      permissionMode: step.permissionMode,
      worktree,
      prompt,
    });

    waits.register(chatId, ctx.runId, ctx.stepRef);

    const wakeAt = step.timeoutMinutes !== undefined ? Date.now() + step.timeoutMinutes * 60_000 : null;
    return { type: 'wait', wakeAt, kind: 'ask_agent' };
  };
}
