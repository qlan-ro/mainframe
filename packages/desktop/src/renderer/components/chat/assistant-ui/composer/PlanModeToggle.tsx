import React from 'react';
import { ClipboardList } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/tooltip';
import type { PermissionMode } from '@qlan-ro/mainframe-types';

interface PlanModeToggleProps {
  active: boolean;
  onToggle: (enable: boolean) => void;
}

/**
 * Standalone toggle button for plan mode. Only rendered for adapters that support
 * plan mode (currently Claude only). Activating plan mode sends `permissionMode: 'plan'`
 * to the daemon; deactivating restores the last non-plan mode.
 */
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
        >
          <ClipboardList size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{active ? 'Plan mode: on' : 'Plan mode: off'}</TooltipContent>
    </Tooltip>
  );
}

/** True when the adapter supports plan mode. Only Claude supports it today. */
export function adapterSupportsPlanMode(adapterId: string): boolean {
  return adapterId === 'claude';
}

/**
 * Returns the effective permission mode for the dropdown display:
 * when plan mode is active the dropdown should fall back to `default`
 * so it doesn't show an item that is no longer in the list.
 */
export function displayModeForDropdown(mode: PermissionMode): Exclude<PermissionMode, 'plan'> {
  return mode === 'plan' ? 'default' : mode;
}
