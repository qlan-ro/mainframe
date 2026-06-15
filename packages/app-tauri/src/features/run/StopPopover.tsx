/**
 * StopPopover — lists running/starting launch processes and lets the user
 * stop individual ones or all at once via "Stop All".
 *
 * The caller supplies `scopeKey` (= buildLaunchScope(projectId, effectivePath))
 * because the stop action must happen in the context of the active scope, and
 * the caller is also responsible for resolving the effectivePath from the most
 * recent `fetchLaunchStatuses` response.
 *
 * Scoped testids: run-stop-trigger, run-stop-process-<name>, run-stop-all.
 */
import { useState, useMemo, useCallback } from 'react';
import { Square, StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import { stopLaunchConfig } from '@/lib/api/launch';
import { useSandboxStore } from '@/store/sandbox';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

interface StopPopoverProps {
  /** Scope key = buildLaunchScope(projectId, effectivePath). */
  scopeKey: string;
}

export function StopPopover({ scopeKey }: StopPopoverProps) {
  const [open, setOpen] = useState(false);
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const processStatuses = useSandboxStore((s) => s.processStatuses);

  const scopeMap: Record<string, string> = processStatuses[scopeKey] ?? {};

  const runningProcesses = useMemo(
    () =>
      Object.entries(scopeMap)
        .filter(([, status]) => status === 'running' || status === 'starting')
        .map(([name]) => name),
    [scopeMap],
  );

  const handleStop = useCallback(
    async (name: string) => {
      if (!projectId) return;
      try {
        await stopLaunchConfig(port, projectId, name, chatId ?? undefined);
      } catch (err) {
        toast.error(`Failed to stop "${name}"`);
        console.warn('[launch] stop failed', err);
      }
    },
    [port, projectId, chatId],
  );

  const handleStopAll = useCallback(async () => {
    if (!projectId) return;
    setOpen(false);
    try {
      await Promise.all(runningProcesses.map((name) => stopLaunchConfig(port, projectId, name, chatId ?? undefined)));
    } catch (err) {
      toast.error('Failed to stop all processes');
      console.warn('[launch] stop-all failed', err);
    }
  }, [port, projectId, chatId, runningProcesses]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-testid="run-stop-trigger"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-caption text-muted-foreground hover:text-foreground"
          aria-label="Stop a running process"
          disabled={runningProcesses.length === 0}
        >
          <StopCircle size={12} />
          Stop
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="run-stop-popover"
        className="w-56 p-1"
        align="start"
      >
        {runningProcesses.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-muted-foreground">No running processes.</p>
        ) : (
          <>
            {runningProcesses.map((name) => (
              <button
                key={name}
                data-testid={`run-stop-process-${name}`}
                onClick={() => {
                  void handleStop(name);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-caption text-foreground hover:bg-accent"
              >
                <Square size={10} className="shrink-0 text-destructive" />
                <span className="flex-1 truncate text-left">Stop &apos;{name}&apos;</span>
              </button>
            ))}
            <div className="my-0.5 border-t border-border" />
            <button
              data-testid="run-stop-all"
              onClick={() => void handleStopAll()}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-caption text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Stop All
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
