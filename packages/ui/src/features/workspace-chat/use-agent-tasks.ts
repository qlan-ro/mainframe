/**
 * The daemon's task list of one agent's call, for as long as its tab is in
 * front. The last list stays while it is asked for again; what was lost with the
 * connection does not count as live until a list has come after it.
 */
import { useEffect, useRef, useState } from 'react';
import type { BackgroundActivityTask, BackgroundTask } from '@qlan-ro/mainframe-types';
import { useIsConnected } from '@/app/ConnectionStatusContext';
import { listBackgroundTasks } from '@/lib/api/background-tasks';
import type { AgentTasks } from './agent-status';

const RETRY_MS = 1_000;
const RETRY_MAX_MS = 10_000;
/** After this long a request counts as refused. */
const ANSWER_MS = 15_000;

/** Lists a chat's tasks now and on `refetch`: one request at a time and one more after it, retried while refused. */
function pollTasks(chatId: string, onTasks: (tasks: BackgroundTask[]) => void) {
  let request: object | null = null;
  let again = false;
  let refusals = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    const mine = {};
    request = mine;
    again = false;
    const settle = (): boolean => {
      if (request !== mine) return false;
      request = null;
      clearTimeout(timer);
      timer = undefined;
      return true;
    };
    const refuse = (error: unknown) => {
      if (!settle()) return;
      console.warn('[workspace-chat] could not list background tasks', error);
      timer = setTimeout(run, Math.min(RETRY_MS * 2 ** refusals, RETRY_MAX_MS));
      refusals += 1;
    };
    timer = setTimeout(() => refuse(new Error('No answer')), ANSWER_MS);
    listBackgroundTasks(chatId).then((tasks) => {
      if (!settle()) return;
      refusals = 0;
      onTasks(tasks);
      if (again) run();
    }, refuse);
  };
  run();
  return {
    refetch: () => {
      if (request !== null) again = true;
      else if (timer === undefined) run();
    },
    stop: () => {
      request = null;
      clearTimeout(timer);
    },
  };
}

/** A settled row stays settled: a later list changes it only with a later run of the same task. */
function keepSettled(before: AgentTasks, now: readonly BackgroundTask[]): AgentTasks {
  const kept = (before ?? []).filter(
    (task) => task.status !== 'running' && !now.some((next) => next.id === task.id && next.startedAt > task.startedAt),
  );
  return [...kept, ...now.filter((task) => !kept.some(({ id }) => id === task.id))];
}

export function useAgentTasks(
  chatId: string,
  toolCallId: string,
  /** A new object per background event. */
  events: Readonly<Record<string, BackgroundActivityTask>> | undefined,
  visible: boolean,
): { tasks: AgentTasks; live: boolean } {
  const connected = useIsConnected();
  const [lost, setLost] = useState(!connected);
  if (!connected && !lost) setLost(true);
  const [listed, setListed] = useState<{ chatId: string; tasks: AgentTasks } | null>(null);
  const refetch = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!visible || !connected) return undefined;
    const poll = pollTasks(chatId, (tasks) => {
      const own = tasks.filter((task) => task.toolUseId === toolCallId);
      setLost(false);
      setListed((last) => ({ chatId, tasks: keepSettled(last?.chatId === chatId ? last.tasks : null, own) }));
    });
    refetch.current = poll.refetch;
    return () => {
      poll.stop();
      refetch.current = null;
    };
  }, [chatId, toolCallId, visible, connected]);

  const seen = useRef(events);
  useEffect(() => {
    if (seen.current === events) return;
    seen.current = events;
    refetch.current?.();
  }, [events]);

  return { tasks: listed?.chatId === chatId ? listed.tasks : null, live: connected && !lost };
}
