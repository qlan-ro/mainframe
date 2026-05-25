import React, { useEffect, useState, useMemo } from 'react';
import { Play } from 'lucide-react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { useBackgroundTasksStore } from '../../store/background-tasks.js';
import { listBackgroundTasks } from '../../lib/api/background-tasks-api.js';
import { daemonClient } from '../../lib/client.js';
import { BackgroundTasksPopover } from './BackgroundTasksPopover.js';

interface Props {
  chatId: string;
}

// Stable reference used when no entry exists for a chat yet,
// preventing selector from returning a new [] on every render.
const EMPTY: BackgroundTask[] = [];

export function BackgroundTasksPill({ chatId }: Props): React.ReactElement | null {
  const tasks = useBackgroundTasksStore((s) => s.byChat.get(chatId) ?? EMPTY);
  const hydrate = useBackgroundTasksStore((s) => s.hydrate);
  const applyEvent = useBackgroundTasksStore((s) => s.applyEvent);
  const [open, setOpen] = useState(false);

  const runningTasks = useMemo(() => tasks.filter((t) => t.status === 'running'), [tasks]);

  useEffect(() => {
    let cancelled = false;
    listBackgroundTasks(chatId)
      .then((r) => {
        if (!cancelled) hydrate(chatId, r.tasks);
      })
      .catch((err) => console.warn('[bg-tasks] hydrate failed', err));
    return () => {
      cancelled = true;
    };
  }, [chatId, hydrate]);

  useEffect(() => {
    return daemonClient.onEvent((event) => {
      if (
        event.type === 'background_task.started' ||
        event.type === 'background_task.updated' ||
        event.type === 'background_task.ended'
      ) {
        if ((event as { chatId: string }).chatId === chatId) {
          applyEvent(event as never);
        }
      }
    });
  }, [chatId, applyEvent]);

  if (runningTasks.length === 0) return null;

  const label = `${runningTasks.length} ${runningTasks.length === 1 ? 'task' : 'tasks'}`;

  return (
    <div className="relative">
      <button
        data-testid="chat-session-bar-bg-tasks-pill"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-mf-hover text-mf-small text-mf-text-primary hover:bg-mf-app-bg"
      >
        <Play size={10} className="text-mf-accent" />
        <span>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50">
          <BackgroundTasksPopover chatId={chatId} tasks={runningTasks} />
        </div>
      )}
    </div>
  );
}
