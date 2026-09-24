/**
 * On-demand output tail for a task's detail view (todo #328). Agent rows never
 * request a tail — the CLI writes an agent's output as a link to its own
 * transcript, outside the spool directory the daemon may read (AC22, spec
 * "Agent rows have no output tail"). A task with no output location also
 * skips the request rather than asking for a 404.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { getBackgroundTaskOutput } from '@/lib/api/background-tasks';

export type OutputTailState =
  | { kind: 'transcript' }
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'lines'; text: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

function initialState(isAgent: boolean, hasOutputPath: boolean): OutputTailState {
  if (isAgent) return { kind: 'transcript' };
  if (!hasOutputPath) return { kind: 'none' };
  return { kind: 'loading' };
}

export function useOutputTail(
  chatId: string | undefined,
  task: BackgroundActivityTask,
): { state: OutputTailState; refresh: () => void } {
  const isAgent = task.kind === 'agent';
  const hasOutputPath = task.outputPath !== undefined;
  const [state, setState] = useState<OutputTailState>(() => initialState(isAgent, hasOutputPath));

  const fetchTail = useCallback(() => {
    if (isAgent) {
      setState({ kind: 'transcript' });
      return;
    }
    if (!hasOutputPath || chatId === undefined) {
      setState({ kind: 'none' });
      return;
    }
    setState({ kind: 'loading' });
    void getBackgroundTaskOutput(chatId, task.id).then((result) => {
      if (result.kind === 'text') {
        setState(result.text.length === 0 ? { kind: 'empty' } : { kind: 'lines', text: result.text });
      } else if (result.kind === 'none') {
        setState({ kind: 'none' });
      } else {
        setState({ kind: 'error', message: result.message });
      }
    });
  }, [chatId, hasOutputPath, isAgent, task.id]);

  useEffect(() => {
    fetchTail();
  }, [fetchTail]);

  return { state, refresh: fetchTail };
}
