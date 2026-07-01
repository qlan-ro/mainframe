import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { QuestionStep, StepDef } from '../../dsl/types.js';
import type { InteractionStore } from '../../store/interaction-store.js';
import type { StepContext, StepOutcome } from '../types.js';
import { renderValue } from '../../template/render.js';

export function makeQuestionExecutor(interactions: InteractionStore, emitEvent: (e: DaemonEvent) => void = () => {}) {
  return async function executeQuestion(ctx: StepContext, step: StepDef): Promise<StepOutcome> {
    const q = (step as QuestionStep).question;
    // Re-entry after wake: the responder already committed our success row, so the walk
    // never re-executes us. If we ARE re-executed with a pending interaction, keep waiting.
    const existing = interactions.findPendingForStep(ctx.run.id, ctx.stepPath);
    const expiresAt = q.timeout ? Date.now() + q.timeout.afterMinutes * 60_000 : null;

    if (!existing) {
      const title = String(await renderValue(q.title, ctx.scope));
      const created = interactions.create({
        runId: ctx.run.id,
        stepPath: ctx.stepPath,
        title,
        formSchema: q.fields,
        expiresAt,
      });
      emitEvent({ type: 'workflow.interaction.created', interaction: created } as never);
    }

    return {
      type: 'wait',
      wait: { kind: 'question', wakeAt: existing?.expiresAt ?? expiresAt },
    };
  };
}
