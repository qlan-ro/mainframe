/**
 * RunRepeatGroup — a Repeat block's fan-out, grouped by iteration (contract
 * §2's `<innerStepId>#<iteration>` stepRef) and rendered as nested,
 * non-spine `RunStepRow`s indented under a tinted left rule — ts153
 * wf2-runtime.jsx `WfRunStep`'s `step.children` branch, extracted into its
 * own component since the real model needs a grouping pass first (the
 * prototype's mock data pre-nested `children`; the wire gives a flat array).
 */
import { cn } from '@/lib/utils';
import type {
  ActionCatalogEntry,
  AutomationInteractionSummary,
  AutomationStep,
  AutomationTimelineEntry,
  RepeatBlock,
} from '../contract';
import { VERB_META } from '../editor/verb-meta';
import { RunStepRow } from './RunStepRow';
import { groupRepeatIterations } from './run-timeline';

export interface RunRepeatGroupProps {
  repeatStep: RepeatBlock;
  timeline: AutomationTimelineEntry[];
  steps: AutomationStep[];
  catalog: ActionCatalogEntry[];
  interactions: AutomationInteractionSummary[];
  onOpenChat: (chatId: string) => void;
  onInteractionSubmitted: () => void;
}

export function RunRepeatGroup({
  repeatStep,
  timeline,
  steps,
  catalog,
  interactions,
  onOpenChat,
  onInteractionSubmitted,
}: RunRepeatGroupProps) {
  const testId = `automations-run-repeat-${repeatStep.id}`;
  const groups = groupRepeatIterations(timeline, repeatStep);

  if (groups.length === 0) {
    return (
      <div data-testid={testId} className="pl-[12px] text-caption text-muted-foreground">
        No iterations yet.
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      className={cn('flex flex-col gap-2.5 border-l-2 pl-[12px]', VERB_META.repeat.borderClass)}
    >
      {groups.map((group) => (
        <div
          key={group.iteration}
          data-testid={`${testId}-iteration-${group.iteration}`}
          className="flex flex-col gap-2"
        >
          {group.entries.map((entry) => (
            <RunStepRow
              key={entry.stepRef}
              entry={entry}
              timeline={timeline}
              steps={steps}
              catalog={catalog}
              interactions={interactions}
              onOpenChat={onOpenChat}
              onInteractionSubmitted={onInteractionSubmitted}
              spine={false}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
