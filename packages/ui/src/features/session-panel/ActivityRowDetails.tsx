import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { formatElapsed } from './background-activity-view';
import type { ActivityEntry } from './activity-model';

export interface RowAction {
  key: string;
  icon: LucideIcon;
  label: string;
  text: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-1.5">
      <span>{label}</span>
      {children}
    </div>
  );
}

function ScheduleFields({ row }: { row: ActivityEntry }) {
  return (
    <>
      {row.schedule && (
        <Field label="Schedule">
          <span className="font-mono">{row.schedule}</span>
        </Field>
      )}
      {row.nextAt && (
        <Field label="Next run">
          <span>{new Date(row.nextAt).toLocaleString()}</span>
        </Field>
      )}
    </>
  );
}

export function DetailFields({
  row,
  run,
  output,
}: {
  row: ActivityEntry;
  run?: ClaudeWorkflowRun;
  output: string | null;
}) {
  return (
    <div className="space-y-1.5 border-t border-border/50 px-2.5 py-2 text-xs text-muted-foreground">
      {row.prompt && (
        <Field label="Prompt">
          <span className="wrap-break-word text-foreground">{row.prompt}</span>
        </Field>
      )}
      {row.usage && (
        <Field label="Usage">
          <span>
            {row.usage.totalTokens.toLocaleString()} tokens · {row.usage.toolUses} tool uses ·{' '}
            {formatElapsed(0, row.usage.durationMs)}
          </span>
        </Field>
      )}
      <ScheduleFields row={row} />
      {row.command && (row.kind === 'command' || row.kind === 'monitor') && (
        <Field label={row.kind === 'monitor' ? 'Target' : 'Command'}>
          <code className="min-w-0 wrap-break-word">{row.command}</code>
        </Field>
      )}
      {run && (
        <Field label="Phases">
          <span>{run.phases.map((phase) => phase.title).join(' → ')}</span>
        </Field>
      )}
      {row.summary && <p className="wrap-break-word">{row.summary}</p>}
      {(output || row.task?.lastOutputLine) && (
        <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">
          {output || row.task?.lastOutputLine}
        </pre>
      )}
    </div>
  );
}

export function ActionFooter({ actions }: { actions: RowAction[] }) {
  return (
    <div className="flex justify-end gap-1 px-2.5 pb-2">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={action.disabled}
          onClick={action.onClick}
          className={cn(
            'rounded px-2 py-0.5 text-xs',
            action.destructive
              ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {action.text}
          {action.key === 'source' && <ExternalLink className="ml-1 inline size-3" />}
        </button>
      ))}
    </div>
  );
}
