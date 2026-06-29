import { ShieldIcon, PencilIcon, ZapIcon } from 'lucide-react';
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
  { id: 'yolo', label: 'Unattended', Icon: ZapIcon, desc: 'Run everything, no prompts' },
];

export interface PlanExecModeControlProps {
  value: ExecutionMode;
  onChange: (m: ExecutionMode) => void;
}

export function PlanExecModeControl({ value, onChange }: PlanExecModeControlProps) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-border bg-mf-raised p-0.5">
      {EXEC_MODE_OPTIONS.map(({ id, label, Icon, desc }) => {
        const selected = value === id;
        const isYolo = id === 'yolo';

        return (
          <Hint key={id} label={desc}>
            <button
              type="button"
              data-testid={`chat-plan-execmode-${id}`}
              onClick={() => onChange(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1',
                'text-label font-semibold transition-colors',
                selected && isYolo && 'bg-background text-destructive shadow-sm',
                selected && !isYolo && 'bg-background text-primary shadow-sm',
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
