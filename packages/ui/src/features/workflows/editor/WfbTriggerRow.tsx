/**
 * WfbTriggerRow — one row in the builder's Triggers section. Split out of
 * WfBuilderPane.tsx (mirrors WfbOutputRow.tsx / WfbVarRow.tsx) to keep that
 * file under the size limit.
 */
import { X, Play, Calendar, BoltIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import type { WfTrigger } from './wf-draft-types';

const TRIGGER_ICON_MAP: Record<string, typeof Play> = {
  manual: Play,
  schedule: Calendar,
  event: BoltIcon,
};

const TRIGGER_LABEL_MAP: Record<string, string> = {
  manual: 'Manual',
  schedule: 'Schedule',
  event: 'Event',
};

function triggerDetail(trigger: WfTrigger): string {
  switch (trigger.kind) {
    case 'schedule':
      return trigger.label ?? trigger.cron;
    case 'event':
      return trigger.on;
    case 'manual':
      return 'started by hand';
  }
}

interface WfbTriggerRowProps {
  trigger: WfTrigger;
  onRemove: () => void;
}

export function WfbTriggerRow({ trigger, onRemove }: WfbTriggerRowProps): React.ReactElement {
  const TriggerIcon = TRIGGER_ICON_MAP[trigger.kind] ?? Play;
  const label = TRIGGER_LABEL_MAP[trigger.kind] ?? trigger.kind;
  const detail = triggerDetail(trigger);

  return (
    <div className="flex items-center gap-[9px] rounded-md border border-border bg-card px-[10px] py-[8px]">
      <span className="inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-sm bg-muted">
        <TriggerIcon size={12} className="text-muted-foreground" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-label font-semibold text-foreground">{label}</div>
        <div className="font-mono text-micro text-mf-text-3">{detail}</div>
      </div>
      <Hint label="Remove trigger">
        <button
          type="button"
          aria-label="Remove trigger"
          onClick={onRemove}
          className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground"
        >
          <X size={12} aria-hidden />
        </button>
      </Hint>
    </div>
  );
}
