/**
 * DraftPreview — read-only When/Do block list for a drafted (not-yet-saved)
 * automation (ts153 wf2-runtime.jsx `WfDraftPreview`, ported onto the real
 * `AutomationCreateInput`). ts153 gave every step a free-text `title`/`sub`;
 * the contract only carries one (`AskMeStep.title`) — the same
 * contract-driven deviation `editor/StepCard.tsx` already documents. Title
 * falls back to `stepLabel`; subtitle is ask_me's joined field labels only,
 * matching ts153's own conditional (nothing else got a subtitle there
 * either).
 */
import type { ActionCatalogEntry, AutomationCreateInput, AutomationStep } from '../contract';
import { stepLabel } from '../domain/tokens';
import { VERB_META } from '../editor/verb-meta';
import { TriggerChips } from '../library/TriggerChips';

function stepSubtitle(step: AutomationStep): string | null {
  if (step.kind !== 'ask_me') return null;
  const labels = step.fields.map((f) => f.label).filter(Boolean);
  return labels.length > 0 ? labels.join(', ') : null;
}

function DraftStepLine({ step, catalog }: { step: AutomationStep; catalog: ActionCatalogEntry[] }) {
  const meta = VERB_META[step.kind];
  const Icon = meta.icon;
  const subtitle = stepSubtitle(step);
  return (
    <div className="flex items-start gap-2.5 rounded-md border-[0.5px] border-border bg-card px-2.5 py-2">
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${meta.tintClass}`}>
        <Icon size={12} className={meta.iconClass} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-label font-semibold text-foreground">{stepLabel(step, catalog)}</div>
        {subtitle && <div className="mt-0.5 text-caption text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}

export interface DraftPreviewProps {
  draft: AutomationCreateInput;
  catalog: ActionCatalogEntry[];
}

export function DraftPreview({ draft, catalog }: DraftPreviewProps) {
  return (
    <div data-testid="automations-draft-preview" className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-label font-semibold text-muted-foreground">When</div>
        {draft.definition.triggers.length > 0 ? (
          <TriggerChips triggers={draft.definition.triggers} />
        ) : (
          <span className="text-caption text-muted-foreground">Manually</span>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-label font-semibold text-muted-foreground">Do</div>
        <div className="flex flex-col gap-1.5">
          {draft.definition.steps.map((step) => (
            <DraftStepLine key={step.id} step={step} catalog={catalog} />
          ))}
        </div>
      </div>
    </div>
  );
}
