import { cn } from '@/lib/utils';

export type ExecMode = 'default' | 'acceptEdits' | 'yolo';

interface ExecModeOption {
  id: ExecMode;
  label: string;
}

const EXEC_MODE_OPTIONS: ExecModeOption[] = [
  { id: 'default', label: 'Interactive' },
  { id: 'acceptEdits', label: 'Auto-edits' },
  { id: 'yolo', label: 'Unattended' },
];

export interface PlanExecModeControlProps {
  value: ExecMode;
  onChange: (m: ExecMode) => void;
}

export function PlanExecModeControl({ value, onChange }: PlanExecModeControlProps) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-border bg-mf-raised p-0.5">
      {EXEC_MODE_OPTIONS.map((mode) => {
        const selected = value === mode.id;
        const isYolo = mode.id === 'yolo';

        return (
          <button
            key={mode.id}
            type="button"
            data-testid={`chat-plan-execmode-${mode.id}`}
            onClick={() => onChange(mode.id)}
            className={cn(
              'rounded-md px-2.5 py-1 text-label font-semibold transition-colors',
              selected && isYolo && 'border border-destructive text-destructive bg-background',
              selected && !isYolo && 'border border-primary text-primary bg-background',
              !selected && 'border border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
