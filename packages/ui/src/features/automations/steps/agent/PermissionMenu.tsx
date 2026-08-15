/**
 * PermissionMenu — the Agent card's execution-scope chip (todo #234 T15).
 * Modes and their order come from the contract's `EXECUTION_MODES`, not a
 * local list; only the copy is local. What the menu *offers* is narrower:
 * `auto` is the Claude CLI's own mode, so it appears only for a provider
 * whose adapter advertises `capabilities.autoMode` (todo #325). The active
 * mode is still resolved against the whole list, so a step carrying a mode
 * its provider cannot offer reads as that mode rather than silently
 * relabelling itself.
 *
 * Labels match the composer's `config-toolbar/PermissionSelect` verbatim —
 * the same modes should never read differently in two surfaces. Left
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
import { Hint } from '@/components/ui/hint';
import { useAdapters } from '@/store/adapters';
import type { AskAgentStep } from '../../contract';
import { EXECUTION_MODES } from '../../contract';
import { ChipButton } from './ChipButton';
import { resolveStepAdapter } from './resolve-step-adapter';

const MODE_COPY: Record<ExecutionMode, { label: string; hint: string }> = {
  default: { label: 'Interactive', hint: 'Approve every action' },
  acceptEdits: { label: 'Auto-Edits', hint: 'Edits auto-applied; commands ask' },
  auto: { label: 'Auto', hint: 'Claude decides which actions need approval' },
  yolo: { label: 'Unattended', hint: 'Runs without prompts' },
};

export interface PermissionMenuProps {
  /** The step's provider — which modes it can offer. Unset resolves the same way the model chip does. */
  adapterId: string | undefined;
  /** `AskAgentStep.permissionMode` is a bare wire `string`; anything off the mode list falls back to the first. */
  value: string | undefined;
  onChange: (patch: Pick<AskAgentStep, 'permissionMode'>) => void;
  testId: string;
}

export function PermissionMenu({ adapterId, value, onChange, testId }: PermissionMenuProps) {
  const adapters = useAdapters();
  const autoAllowed = resolveStepAdapter(adapters, adapterId)?.capabilities.autoMode === true;
  const offered = EXECUTION_MODES.filter((mode) => mode !== 'auto' || autoAllowed);
  const active = EXECUTION_MODES.find((mode) => mode === value) ?? EXECUTION_MODES[0];
  const { label } = MODE_COPY[active];

  return (
    <DropdownMenu>
      {/* Hint WRAPS the trigger — inside it, TooltipTrigger's asChild would
          swallow the menu's own ref and onClick. */}
      <Hint label={`Permission: ${label}`}>
        <DropdownMenuTrigger asChild>
          <ChipButton
            icon={Shield}
            label={`Permission: ${label}`}
            testId={`${testId}-permission`}
            destructive={active === 'yolo'}
            caution={active === 'auto'}
          >
            {label}
          </ChipButton>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent data-testid={`${testId}-permission-menu`} align="start" sideOffset={6} className="min-w-44">
        {offered.map((mode) => (
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
