/**
 * A background command's output, read while its row is open (the session panel
 * no longer shows it). The daemon names a task by its own id, so the task is
 * found by the call that started it; its output is re-read while it runs.
 */
import { useEffect, useState } from 'react';
import { listBackgroundTasks, readBackgroundTaskOutput } from '@/lib/api/background-tasks';
import { useChatId } from '../chat-tool-context';
import { TerminalBody } from './TerminalBody';
import { BodyNote } from './Surface';

const REFRESH_MS = 2000;

interface Reading {
  output: string | null;
  error: string | null;
}

function useBackgroundOutput(chatId: string | undefined, toolCallId: string): Reading {
  const [reading, setReading] = useState<Reading>({ output: null, error: null });
  useEffect(() => {
    if (!chatId || chatId.startsWith('__LOCALID_')) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const read = async () => {
      try {
        const task = (await listBackgroundTasks(chatId)).find((entry) => entry.toolUseId === toolCallId);
        const output = task ? await readBackgroundTaskOutput(chatId, task.id) : null;
        if (!active) return;
        setReading({ output, error: null });
        if (task?.status === 'running') timer = setTimeout(() => void read(), REFRESH_MS);
      } catch (error) {
        if (active) setReading((last) => ({ ...last, error: error instanceof Error ? error.message : String(error) }));
      }
    };
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [chatId, toolCallId]);
  return reading;
}

export function BackgroundOutput({
  toolCallId,
  command,
  launch,
}: {
  toolCallId: string;
  command: string;
  launch: string;
}) {
  const { output, error } = useBackgroundOutput(useChatId(), toolCallId);
  return (
    <div data-testid={`chat-background-output-${toolCallId}`}>
      {/* A task the daemon no longer holds leaves what the CLI said when it started it. */}
      <TerminalBody command={command} output={output ?? launch} />
      {error && <BodyNote testId="chat-background-output-error">Couldn’t read the output: {error}</BodyNote>}
    </div>
  );
}
