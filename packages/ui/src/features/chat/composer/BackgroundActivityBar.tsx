/**
 * BackgroundActivityBar — compact chip above the composer surfacing live
 * background work (subagents, background bash tasks, workflows) while the
 * composer stays fully active. Hidden when the live set is empty; clicking
 * opens a popover listing each item with its kind icon and elapsed time.
 *
 * Data: `extras.state.backgroundTasks`, fed by `background_task.*` events and
 * resynced from `chat.updated`'s `backgroundActivity` (see chat-thread-state).
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, SquareTerminal, Workflow } from 'lucide-react';
import type { BackgroundActivityTask, BackgroundWorkKind } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';

const KIND_ICONS: Record<BackgroundWorkKind, typeof Bot> = {
  agent: Bot,
  bash: SquareTerminal,
  workflow: Workflow,
  other: SquareTerminal,
};

/** "2 agents · 1 task · 1 workflow" — bash and unknown kinds both read as tasks. */
export function summarizeByKind(tasks: BackgroundActivityTask[]): string {
  const counts = { agent: 0, task: 0, workflow: 0 };
  for (const t of tasks) {
    if (t.kind === 'agent') counts.agent += 1;
    else if (t.kind === 'workflow') counts.workflow += 1;
    else counts.task += 1;
  }
  const parts: string[] = [];
  if (counts.agent > 0) parts.push(`${counts.agent} agent${counts.agent === 1 ? '' : 's'}`);
  if (counts.task > 0) parts.push(`${counts.task} task${counts.task === 1 ? '' : 's'}`);
  if (counts.workflow > 0) parts.push(`${counts.workflow} workflow${counts.workflow === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** "<1m", "5m", "1h 12m" — minute-level is enough for a background chip. */
export function formatElapsed(startedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Re-renders every 30s so elapsed times stay fresh while work is live. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
}

export function BackgroundActivityBar() {
  const extras = useChatExtras();
  const backgroundTasks = extras?.state.backgroundTasks;
  const tasks = useMemo(() => Object.values(backgroundTasks ?? {}), [backgroundTasks]);
  const now = useNow(tasks.length > 0);
  if (tasks.length === 0) return null;

  return (
    <div className="px-1 pb-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="composer-background-activity"
            aria-label={`Background activity: ${summarizeByKind(tasks)}`}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-2 pr-2.5 text-caption text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
          >
            <span className="size-[5px] flex-shrink-0 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden />
            <span>{summarizeByKind(tasks)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-80 p-1">
          <ul className="flex max-h-56 flex-col gap-px overflow-y-auto">
            {tasks.map((task) => {
              const Icon = KIND_ICONS[task.kind] ?? SquareTerminal;
              return (
                <li
                  key={task.id}
                  data-testid={`composer-background-activity-item-${task.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <Icon size={13} className="flex-shrink-0 text-mf-text-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-caption text-foreground">
                    {task.description || 'Background task'}
                  </span>
                  <span className="flex-shrink-0 font-mono text-micro tabular-nums text-mf-text-3">
                    {formatElapsed(task.startedAt, now)}
                  </span>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
