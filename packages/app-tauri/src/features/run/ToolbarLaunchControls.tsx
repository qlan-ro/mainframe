/**
 * ToolbarLaunchControls — the shell MainToolbar launch picker: a "Preview"
 * dropdown showing the selected config name + a run/stop button, wired to the
 * same launch subsystem as the Run surface's `LaunchPopover` (via
 * `useLaunchActions`). The dropdown lists configs (click to start/stop + select);
 * the run button starts the selected config (or the first available), and stops
 * it while running.
 *
 * Scoped testids: main-toolbar-launch, main-toolbar-play,
 * main-toolbar-launch-config-<name>.
 */
import { useCallback, useState } from 'react';
import { ChevronDown, Play, Square } from 'lucide-react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuEmpty } from '@/components/ui/menu';
import { useLaunchActions } from './use-launch-actions';
import { LaunchConfigRow } from './LaunchPopover';

interface ToolbarLaunchControlsProps {
  port: number;
  projectId?: string;
  chatId?: string;
}

export function ToolbarLaunchControls({ port, projectId, chatId }: ToolbarLaunchControlsProps) {
  const [open, setOpen] = useState(false);
  const { configs, scopeStatuses, selectedConfigName, handleLaunch, handleStop, refetch } =
    useLaunchActions(port, projectId, chatId);

  // The run button targets the selected config, falling back to the first one.
  const runTarget: LaunchConfiguration | undefined =
    (selectedConfigName ? configs.find((c) => c.name === selectedConfigName) : undefined) ?? configs[0];
  const runStatus = runTarget ? (scopeStatuses[runTarget.name] ?? 'stopped') : 'stopped';
  const running = runStatus === 'running' || runStatus === 'starting';
  const label = selectedConfigName ?? 'Preview';

  const handleOpen = useCallback(
    (next: boolean) => {
      if (next) refetch();
      setOpen(next);
    },
    [refetch],
  );

  const onLaunch = useCallback(
    (config: LaunchConfiguration) => {
      setOpen(false);
      handleLaunch(config);
    },
    [handleLaunch],
  );

  const onStop = useCallback(
    (config: LaunchConfiguration) => {
      setOpen(false);
      handleStop(config);
    },
    [handleStop],
  );

  const onRunClick = useCallback(() => {
    if (!runTarget) return;
    if (running) handleStop(runTarget);
    else handleLaunch(runTarget);
  }, [runTarget, running, handleLaunch, handleStop]);

  return (
    <>
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <button
            data-testid="main-toolbar-launch"
            type="button"
            title="Launch configurations"
            className="inline-flex h-[24px] max-w-[200px] cursor-pointer items-center gap-[5px] rounded-[6px] bg-mf-chip px-[8px] text-label font-medium text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{label}</span>
            <ChevronDown size={9} className="flex-shrink-0 text-mf-text-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent data-testid="main-toolbar-launch-popover" className="w-56" align="end">
          {configs.length === 0 ? (
            <MenuEmpty>No launch configs found.</MenuEmpty>
          ) : (
            configs.map((cfg) => (
              <LaunchConfigRow
                key={cfg.name}
                testid={`main-toolbar-launch-config-${cfg.name}`}
                config={cfg}
                status={scopeStatuses[cfg.name] ?? 'stopped'}
                onLaunch={onLaunch}
                onStop={onStop}
              />
            ))
          )}
        </PopoverContent>
      </Popover>
      <button
        data-testid="main-toolbar-play"
        type="button"
        title={
          !runTarget ? 'No launch configs' : running ? `Stop ${runTarget.name}` : `Start ${runTarget.name}`
        }
        onClick={onRunClick}
        disabled={!runTarget}
        className="inline-flex h-[24px] w-[28px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? (
          <Square size={13} className="text-destructive" fill="currentColor" />
        ) : (
          <Play size={15} className="text-[var(--mf-success)]" fill="currentColor" />
        )}
      </button>
    </>
  );
}
