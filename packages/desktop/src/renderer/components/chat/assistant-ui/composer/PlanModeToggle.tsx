import React from 'react';
import { ClipboardList } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/tooltip';

interface PlanModeToggleProps {
  active: boolean;
  onToggle: (enable: boolean) => void;
}

export function PlanModeToggle({ active, onToggle }: PlanModeToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onToggle(!active)}
          className={`flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small transition-colors ${
            active
              ? 'text-mf-accent bg-mf-hover'
              : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
          }`}
          aria-label={active ? 'Plan mode enabled — click to disable' : 'Plan mode disabled — click to enable'}
          aria-pressed={active}
          data-testid="plan-mode-toggle"
          data-active={active ? 'true' : 'false'}
        >
          <ClipboardList size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{active ? 'Plan mode: on' : 'Plan mode: off'}</TooltipContent>
    </Tooltip>
  );
}
