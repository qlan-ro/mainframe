/**
 * BackgroundActivityBar — compact chip above the composer surfacing live
 * background work (subagents, background bash tasks, workflows) while the
 * composer stays fully active. Hidden when the live set is empty; clicking
 * opens the two-level activity popover.
 *
 * Data: `extras.state.backgroundTasks`, fed by `background_task.*` events and
 * resynced from `chat.updated`'s `backgroundActivity` (see chat-thread-state).
 */
import { useEffect, useMemo, useState } from 'react';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { summarizeByKind, useNow } from './background-activity-view';
import { WorkflowActivityPopover } from './WorkflowActivityPopover';

export function BackgroundActivityBar() {
  const extras = useChatExtras();
  const chatId = extras?.state.chatId;
  const backgroundTasks = extras?.state.backgroundTasks;
  const tasks = useMemo(() => Object.values(backgroundTasks ?? {}), [backgroundTasks]);
  const [open, setOpen] = useState(false);
  const now = useNow(tasks.length > 0);

  useEffect(() => {
    setOpen(false);
  }, [chatId]);

  // Work finishing under an open popover would otherwise yank the surface out from under the reader.
  if (tasks.length === 0 && !open) return null;

  const summary = summarizeByKind(tasks) || 'Background activity';

  return (
    <div className="px-1 pb-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="composer-background-activity"
            aria-label={`Background activity: ${summary}`}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-2 pr-2.5 text-caption text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
          >
            <span className="size-[5px] flex-shrink-0 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden />
            <span>{summary}</span>
          </button>
        </PopoverTrigger>
        <WorkflowActivityPopover tasks={tasks} now={now} />
      </Popover>
    </div>
  );
}
