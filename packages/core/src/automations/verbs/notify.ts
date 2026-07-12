// packages/core/src/automations/verbs/notify.ts
//
// Task 20 (contract Decision 4, §4, §5). `makeNotifyExecutor` is the notify
// arm of VerbPorts: it renders the message, emits `automation.notification`
// (the WS event the UI/mobile feed reads), and best-effort pushes through
// PushService — mirroring chat/event-handler.ts's `chat.notification`
// pattern of firing the WS event unconditionally and treating push as a
// side channel that must never fail the step.
//
// VerbContext (engine/types.ts) carries only runId/stepRef/tokens/signal —
// no automationId or automation name, since Tasks 8/9 didn't need either.
// Rather than widen that shared interface (and its call sites in walk.ts,
// interpreter.ts, and every other verb's tests) for one verb, notify looks
// up both via the same `db`/`store` handles AgentWaitService (Task 19)
// already takes as plain deps.
import type { Logger } from 'pino';
import type { DaemonEvent, NotifyStep } from '@qlan-ro/mainframe-types';
import type { AutomationDb } from '../db.js';
import type { RunStore } from '../store/run-store.js';
import type { AutomationCheckpointStep } from '../store/types.js';
import { renderChipText } from '../tokens/substitute.js';
import type { StepOutcome, VerbContext } from '../engine/types.js';

export interface NotifyPushMessage {
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: 'default' | 'high';
}

/** Narrow port over PushService (push/push-service.ts) — keeps notify.ts free of a concrete-class dependency, same shape as ask-agent.ts's AgentChatPort. */
export interface NotifyPushPort {
  sendPush(message: NotifyPushMessage): Promise<void>;
}

export interface NotifyDeps {
  db: AutomationDb;
  store: RunStore;
  emitEvent: (event: DaemonEvent) => void;
  pushService?: NotifyPushPort;
  logger: Logger;
}

export function makeNotifyExecutor(deps: NotifyDeps) {
  return async function notify(step: NotifyStep, ctx: VerbContext): Promise<StepOutcome> {
    const run = deps.store.getRun(ctx.runId);
    if (!run) return { type: 'failed', error: `automation run not found: ${ctx.runId}` };

    const title = getAutomationName(deps.db, run.automationId);
    const body = renderChipText(ctx.tokens, step.message);
    const chatIds = collectAgentChatIds(ctx.tokens.steps);

    deps.emitEvent({
      type: 'automation.notification',
      runId: ctx.runId,
      automationId: run.automationId,
      title,
      body,
      links: { runId: ctx.runId, chatIds },
    });

    if (deps.pushService) {
      deps.pushService
        .sendPush({ title, body, data: { runId: ctx.runId }, priority: 'default' })
        .catch((err: unknown) => deps.logger.warn({ err }, 'automation notify push failed'));
    }

    return { type: 'completed', outputs: {} };
  };
}

function getAutomationName(db: AutomationDb, automationId: string): string {
  const row = db.prepare(`SELECT name FROM automations WHERE id = ?`).get(automationId) as { name: string } | undefined;
  return row?.name ?? automationId;
}

/** Dedupes chatIds off every ask_agent entry seen so far in the checkpoint (Decision 4: "links (chatIds from checkpoint agent steps)"). */
function collectAgentChatIds(steps: Record<string, AutomationCheckpointStep>): string[] {
  const chatIds = new Set<string>();
  for (const entry of Object.values(steps)) {
    if (entry.kind === 'ask_agent' && entry.chatId) chatIds.add(entry.chatId);
  }
  return [...chatIds];
}
