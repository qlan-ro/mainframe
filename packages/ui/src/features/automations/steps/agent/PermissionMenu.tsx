/**
 * PermissionMenu — the Agent card's execution-scope chip (todo #234 T15).
 * Modes and their order come from the contract's `EXECUTION_MODES`, not a
 * local list, so a mode added to the wire type surfaces here automatically;
 * only the copy is local.
 *
 * Labels match the composer's `config-toolbar/PermissionSelect` verbatim —
 * the same three modes should never read differently in two surfaces. Left
 * duplicated rather than extracted at two call sites (the shared-helper rule
 * is 3+).
 */
import { Shield } from 'lucide-react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AskAgentStep } from '../../contract';
import { EXECUTION_MODES } from '../../contract';
import { ChipButton } from './ChipButton';

const MODE_COPY: Record<ExecutionMode, { label: string; hint: string }> = {
  default: { label: 'Interactive', hint: 'Approve every action' },
  acceptEdits: { label: 'Auto-Edits', hint: 'Edits auto-applied; commands ask' },
  yolo: { label: 'Unattended', hint: 'Runs without prompts' },
};

export interface PermissionMenuProps {
  /** `AskAgentStep.permissionMode` is a bare wire `string`; anything off the mode list falls back to the first. */
  value: string | undefined;
  onChange: (patch: Pick<AskAgentStep, 'permissionMode'>) => void;
  testId: string;
}

export function PermissionMenu({ value, onChange, testId }: PermissionMenuProps) {
  const active = EXECUTION_MODES.find((mode) => mode === value) ?? EXECUTION_MODES[0];
  const { label } = MODE_COPY[active];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton
          icon={Shield}
          label={`Permission: ${label}`}
          testId={`${testId}-permission`}
          destructive={active === 'yolo'}
        >
          {label}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-testid={`${testId}-permission-menu`} align="start" sideOffset={6} className="min-w-44">
        {EXECUTION_MODES.map((mode) => (
          <DropdownMenuItem
            key={mode}
            data-testid={`${testId}-permission-option-${mode}`}
            onSelect={() => onChange({ permissionMode: mode })}
            className={mode === active ? 'bg-sidebar-selection font-medium' : ''}
          >
            <div className="flex flex-col">
              <span>{MODE_COPY[mode].label}</span>
              <span className="text-xs text-muted-foreground">{MODE_COPY[mode].hint}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
