import { useState } from 'react';
import { AlarmClock, CalendarClock, CalendarX, CalendarDays, Activity, ChevronRight, ChevronDown } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

type ScheduleTool = 'ScheduleWakeup' | 'CronCreate' | 'CronDelete' | 'CronList' | 'Monitor';

interface Props {
  toolName: ScheduleTool;
  args: Record<string, unknown>;
  result?: { content?: string; isError?: boolean } | string;
  isError?: boolean;
}

function formatDelay(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function parseResult(result: Props['result']): { content: string; obj: unknown } {
  const content = typeof result === 'string' ? result : (result?.content ?? '');
  try {
    return { content, obj: JSON.parse(content) };
  } catch {
    return { content, obj: null };
  }
}

const ICONS: Record<ScheduleTool, typeof AlarmClock> = {
  ScheduleWakeup: AlarmClock,
  CronCreate: CalendarClock,
  CronDelete: CalendarX,
  CronList: CalendarDays,
  Monitor: Activity,
};

export function SchedulePill({ toolName, args, result, isError }: Props) {
  const Icon = ICONS[toolName];
  const pending = result === undefined;
  const errored = !pending && (isError || (typeof result === 'object' && result?.isError));
  const [open, setOpen] = useState(false);
  const { obj, content } = parseResult(result);

  let label: React.ReactNode = '';
  let tooltip: string | null = null;
  let body: React.ReactNode = null;

  if (errored) {
    label = `Failed: ${toolName}`;
    tooltip = content || null;
  } else if (pending) {
    if (toolName === 'ScheduleWakeup') label = 'Scheduling wakeup…';
    else if (toolName === 'CronCreate') label = 'Creating schedule…';
    else if (toolName === 'CronDelete') label = 'Removing schedule…';
    else if (toolName === 'CronList') label = 'Listing schedules…';
    else if (toolName === 'Monitor') {
      const desc = String(args.description ?? args.command ?? '');
      label = (
        <>
          Monitoring: <span className="text-mf-accent">{desc}</span>
        </>
      );
    }
  } else if (toolName === 'ScheduleWakeup') {
    const delay = Number(args.delaySeconds ?? 0);
    const reason = String(args.reason ?? '');
    label = (
      <>
        Will resume in <span className="text-mf-accent">{formatDelay(delay)}</span>
        {reason ? ` · ${reason}` : ''}
      </>
    );
    tooltip = String(args.prompt ?? '') || null;
  } else if (toolName === 'CronCreate') {
    const o = obj as Record<string, unknown> | null;
    const human = String(o?.humanSchedule ?? args.cron ?? '');
    const recurring = (o?.recurring ?? args.recurring) as boolean | undefined;
    const durable = o?.durable as boolean | undefined;
    label = (
      <>
        Scheduled: <span className="text-mf-accent">{human}</span>
        {' · '}
        <span className="text-mf-text-secondary/60">{recurring ? 'recurring' : 'one-shot'}</span>
        {durable === false ? <span className="text-mf-text-secondary/60"> · session-only</span> : null}
      </>
    );
    tooltip = `${args.cron ?? ''}\n\n${args.prompt ?? ''}` || null;
  } else if (toolName === 'CronDelete') {
    label = (
      <>
        Removed schedule · <span className="font-mono text-mf-accent">{String(args.id ?? '')}</span>
      </>
    );
  } else if (toolName === 'CronList') {
    const jobs = Array.isArray(obj) ? obj : [];
    label = (
      <>
        Listed <span className="text-mf-accent">{jobs.length}</span> scheduled job{jobs.length === 1 ? '' : 's'}
      </>
    );
    if (jobs.length > 0) {
      body = (
        <div className="text-mf-small font-mono text-mf-text-secondary/60 space-y-1 max-h-[300px] overflow-y-auto">
          {jobs.map((j: Record<string, unknown>) => (
            <div key={String(j.id ?? '')}>
              <div>
                • <span className="text-mf-accent">{String(j.id ?? '')}</span> {String(j.humanSchedule ?? j.cron ?? '')}{' '}
                <span className="opacity-60">
                  ({j.recurring ? 'recurring' : 'one-shot'}
                  {j.durable === false ? ', session-only' : ''})
                </span>
              </div>
              {j.prompt ? <div className="pl-3 opacity-60">prompt: {String(j.prompt)}</div> : null}
            </div>
          ))}
        </div>
      );
    }
  } else if (toolName === 'Monitor') {
    const desc = String(args.description ?? args.command ?? '');
    label = (
      <>
        Stopped monitoring: <span className="text-mf-accent">{desc}</span>
      </>
    );
    if (content) {
      body = (
        <pre className="text-mf-small font-mono text-mf-text-secondary/60 whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {content}
        </pre>
      );
    }
  }

  const expandable = body != null && !pending && !errored;
  const Chevron = open ? ChevronDown : ChevronRight;

  const pill = (
    <button
      type="button"
      onClick={() => expandable && setOpen((v) => !v)}
      disabled={!expandable}
      className={
        errored
          ? 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 border border-mf-chat-error/30'
          : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-mf-hover/50 hover:bg-mf-hover/70 transition-colors disabled:cursor-default'
      }
    >
      <Icon size={12} className="text-mf-text-secondary shrink-0" />
      <span className="font-mono text-[11px] text-mf-text-secondary">{label}</span>
      {pending ? (
        <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse" />
      ) : errored ? (
        <span className="w-2 h-2 rounded-full bg-mf-chat-error" />
      ) : null}
      {expandable ? <Chevron size={12} className="text-mf-text-secondary/60 shrink-0" /> : null}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-2 my-1">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{pill}</TooltipTrigger>
          <TooltipContent className="max-w-[480px] whitespace-pre-wrap">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
      {open && expandable ? (
        <div className="w-full rounded-mf-card border border-mf-divider bg-mf-hover/20 px-3 py-2">{body}</div>
      ) : null}
    </div>
  );
}
