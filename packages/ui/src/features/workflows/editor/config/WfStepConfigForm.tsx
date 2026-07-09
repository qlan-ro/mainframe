/**
 * WfStepConfigForm — maps `descriptorsFor(step.kind)` to `WfFieldControl`s.
 * Base (per-kind) fields render inline; the shared Advanced fields (retry,
 * onFailure, output — Task 11) render inside a collapsible "Advanced" section.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { descriptorsFor } from './step-descriptors';
import { WfFieldControl } from './WfFieldControl';
import type { WfStep } from '../wf-draft-types';
import type { WfScopeSource } from './wf-scope';

const ADVANCED_KEYS = new Set(['retry.attempts', 'onFailure', 'output']);

interface WfStepConfigFormProps {
  step: WfStep;
  onPatch: (patch: Partial<WfStep>) => void;
  scope: WfScopeSource[];
}

export function WfStepConfigForm({ step, onPatch, scope }: WfStepConfigFormProps): React.ReactElement {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const descs = descriptorsFor(step.kind);
  const base = descs.filter((d) => !ADVANCED_KEYS.has(d.key));
  const advanced = descs.filter((d) => ADVANCED_KEYS.has(d.key));

  return (
    <div className="space-y-[10px]">
      {base.map((desc) => (
        <WfFieldControl key={desc.key} desc={desc} step={step} onPatch={onPatch} scope={scope} />
      ))}

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger
          data-testid={`workflows-config-${step.id}-advanced-toggle`}
          className="flex items-center gap-[6px] text-label font-semibold text-muted-foreground"
        >
          <ChevronDown size={13} className={cn('transition-transform', advancedOpen && 'rotate-180')} aria-hidden />
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-[10px] pt-[8px]">
          {advanced.map((desc) => (
            <WfFieldControl key={desc.key} desc={desc} step={step} onPatch={onPatch} scope={scope} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
