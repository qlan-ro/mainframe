import { ShieldIcon, PencilIcon, SparklesIcon, ZapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import type { ComponentType } from 'react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';

interface ExecModeOption {
  id: ExecutionMode;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  desc: string;
}

const EXEC_MODE_OPTIONS: ExecModeOption[] = [
  { id: 'default', label: 'Interactive', Icon: ShieldIcon, desc: 'Ask before each tool' },
  { id: 'acceptEdits', label: 'Auto-edits', Icon: PencilIcon, desc: 'Apply edits, ask to run' },
  { id: 'auto', label: 'Auto', Icon: SparklesIcon, desc: 'Claude decides which actions need approval' },
  { id: 'yolo', label: 'Unattended', Icon: ZapIcon, desc: 'Run everything, no prompts' },
];

/** Selected ink per mode; anything unlisted reads as the neutral `text-primary`.
 *  Auto is a caution, not a hazard — only Unattended keeps the destructive ink. */
const SELECTED_INK: Partial<Record<ExecutionMode, string>> = {
  auto: 'text-warning',
  yolo: 'text-destructive',
};

export interface PlanExecModeControlProps {
  value: ExecutionMode;
  onChange: (m: ExecutionMode) => void;
  /** Only an adapter advertising `capabilities.autoMode` gets the Auto segment. */
  autoAllowed?: boolean;
}

/**
 * Deliberately NOT a `ToggleGroup`: every segment is Hint-wrapped, and
 * `TooltipTrigger asChild` overwrites the child's `data-state`, so the
 * primitive's whole `data-[state=on]:*` treatment would be dead and re-specified
 * here anyway. Radix's `type="single"` also swaps `aria-pressed` for
 * `role="radio"`/`aria-checked`, which an e2e case pins. Chrome is the ledger's
 * segmented recipe: a `bg-muted` pad, active item `bg-background shadow-sm`.
 */
export function PlanExecModeControl({ value, onChange, autoAllowed }: PlanExecModeControlProps) {
  const options = EXEC_MODE_OPTIONS.filter((o) => o.id !== 'auto' || autoAllowed === true);

  return (
    <div className="inline-flex gap-0.5 rounded-md border border-border bg-muted p-0.5">
      {options.map(({ id, label, Icon, desc }) => {
        const selected = value === id;

        return (
          <Hint key={id} label={desc}>
            <button
              type="button"
              data-testid={`chat-plan-execmode-${id}`}
              aria-pressed={selected}
              onClick={() => onChange(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1',
                'text-xs font-semibold transition-colors',
                selected && ['bg-background shadow-sm', SELECTED_INK[id] ?? 'text-primary'],
                !selected && 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3 shrink-0" />
              {label}
            </button>
          </Hint>
        );
      })}
    </div>
  );
}
