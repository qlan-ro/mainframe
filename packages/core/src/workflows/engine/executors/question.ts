import type { DaemonEvent, WorkflowInteractionSummary } from '@qlan-ro/mainframe-types';
import type { QuestionStep, StepDef } from '../../dsl/types.js';
import type { InteractionRecord, InteractionStore } from '../../store/interaction-store.js';
import type { StepContext, StepOutcome } from '../types.js';
import { renderValue } from '../../template/render.js';

export function makeQuestionExecutor(interactions: InteractionStore, emitEvent: (e: DaemonEvent) => void = () => {}) {
  return async function executeQuestion(ctx: StepContext, step: StepDef): Promise<StepOutcome> {
    const q = (step as QuestionStep).question;
    // Re-entry after wake: the responder already committed our success row, so the walk
    // never re-executes us. If we ARE re-executed with a pending interaction, keep waiting.
    const existing = interactions.findPendingForStep(ctx.run.id, ctx.stepPath);
    const expiresAt = q.timeout ? Date.now() + q.timeout.afterMinutes * 60_000 : null;

    let title = existing?.title;
    if (!existing) {
      title = String(await renderValue(q.title, ctx.scope));
      const created = interactions.create({
        runId: ctx.run.id,
        stepPath: ctx.stepPath,
        title,
        formSchema: q.fields,
        expiresAt,
      });
      emitEvent({ type: 'workflow.interaction.created', interaction: toInteractionSummary(created) });
    }

    // Human phrase for the run-tree's waiting indicator — prefer the rendered
    // question title, falling back when it's empty.
    const waitFor = title && title.trim().length > 0 ? title : 'your answer';

    return {
      type: 'wait',
      wait: { kind: 'question', wakeAt: existing?.expiresAt ?? expiresAt },
      scratch: { waitFor },
    };
  };
}

function toInteractionSummary(record: InteractionRecord): WorkflowInteractionSummary {
  return {
    id: record.id,
    runId: record.runId,
    stepPath: record.stepPath,
    title: record.title,
    formSchema: record.formSchema,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}
