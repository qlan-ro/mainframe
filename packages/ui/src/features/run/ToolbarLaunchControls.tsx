/**
 * ToolbarLaunchControls — the shell MainToolbar launch picker: a "Preview"
 * dropdown showing the selected config name + a run/stop button, wired to the
 * same launch subsystem as the Run surface's `LaunchPopover` (via
 * `useLaunchActions`).
 *
 * Per the artboard `LaunchPicker`, a dropdown row click only SELECTS the config
 * (no tab, no start) while a separate per-row button starts/stops it. The
 * toolbar run button (`deriveLaunchRunControl`) starts the selected config (or
 * the first available), but switches to a Stop whenever ANY config in the scope
 * is live — so a process started outside the toolbar is always stoppable here.
 * Starting (either button) is what opens the preview tab. "Generate with Agent"
 * is a gated placeholder until a config-generation flow exists.
 *
 * Scoped testids: main-toolbar-launch, main-toolbar-play,
 * main-toolbar-launch-config-<name>, main-toolbar-launch-{start,stop}-<name>,
 * main-toolbar-launch-generate.
 */
import { useCallback, useState } from 'react';
import { ChevronDown, Eye, Loader2, Play, Sparkles, Square, Terminal } from 'lucide-react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { Popover, PopoverContent, PopoverTrigger } from '@v2/components/ui/popover';
import { Separator } from '@v2/components/ui/separator';
import { MenuRow, menuRowClass } from '@v2/components/ui/menu-row';
import { useLaunchActions } from './use-launch-actions';
import { deriveLaunchRunControl, isLaunchStatusLive } from './derive-launch-control';

interface ToolbarLaunchControlsProps {
  port: number;
  projectId?: string;
  chatId?: string;
}

export function ToolbarLaunchControls({ port, projectId, chatId }: ToolbarLaunchControlsProps) {
  const [open, setOpen] = useState(false);
  const { configs, scopeStatuses, selectedConfigName, handleSelect, handleLaunch, handleStop, refetch } =
    useLaunchActions(port, projectId, chatId);

  // Derive the run/stop button from the ACTUAL scope status, not the selection
  // alone: a config running outside the toolbar (boot reconcile, add-menu, or a
  // later re-selection) must still surface its Stop here. See #206 and
  // derive-launch-control.ts. `runTarget` is undefined only when there are no
  // configs — the button then sits inert (disabled below).
  const control = deriveLaunchRunControl(configs, scopeStatuses, selectedConfigName);
  const running = control.mode === 'running';
  const runTarget = control.target;
  const label = control.label;

  const handleOpen = useCallback(
    (next: boolean) => {
      if (next) refetch();
      setOpen(next);
    },
    [refetch],
  );

  // Row click selects (and closes); the per-row start/stop button keeps the
  // popover open so the status change is visible.
  const onSelectRow = useCallback(
    (config: LaunchConfiguration) => {
      setOpen(false);
      handleSelect(config);
    },
    [handleSelect],
  );

  const onRunClick = useCallback(() => {
    if (!runTarget) return;
    if (running) handleStop(runTarget);
    else handleLaunch(runTarget);
  }, [runTarget, running, handleLaunch, handleStop]);

  return (
    <>
      <Popover open={open} onOpenChange={handleOpen}>
        <Hint label="Launch configurations">
          <PopoverTrigger asChild>
            <Button
              data-testid="main-toolbar-launch"
              variant="secondary"
              size="xs"
              className="max-w-[200px] font-medium text-muted-foreground aria-expanded:text-foreground"
            >
              <span className="truncate">{label}</span>
              <ChevronDown className="size-2.5 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent data-testid="main-toolbar-launch-popover" className="w-56 gap-0 p-1" align="end">
          {configs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 px-2 py-4 text-xs text-muted-foreground">
              No launch configs found.
            </div>
          ) : (
            configs.map((cfg) => (
              <LaunchPickerRow
                key={cfg.name}
                config={cfg}
                status={scopeStatuses[cfg.name] ?? 'stopped'}
                selected={cfg.name === selectedConfigName}
                onSelect={onSelectRow}
                onStart={handleLaunch}
                onStop={handleStop}
              />
            ))
          )}
          <Separator className="-mx-1 my-1 w-auto" />
          <Hint label="Generate with Agent — coming soon">
            <MenuRow data-testid="main-toolbar-launch-generate" disabled>
              <Sparkles className="size-3 text-primary" />
              <span className="min-w-0 flex-1 truncate">Generate with Agent</span>
            </MenuRow>
          </Hint>
        </PopoverContent>
      </Popover>
      <Hint label={!runTarget ? 'No launch configs' : running ? `Stop ${runTarget.name}` : `Start ${runTarget.name}`}>
        <Button
          data-testid="main-toolbar-play"
          variant="ghost"
          size="icon-xs"
          onClick={onRunClick}
          disabled={!runTarget}
        >
          {running ? (
            <Square className="size-3.5 text-destructive" fill="currentColor" />
          ) : (
            <Play className="size-3.5 text-success" fill="currentColor" />
          )}
        </Button>
      </Hint>
    </>
  );
}

interface LaunchPickerRowProps {
  config: LaunchConfiguration;
  status: LaunchProcessStatus;
  selected: boolean;
  onSelect: (cfg: LaunchConfiguration) => void;
  onStart: (cfg: LaunchConfiguration) => void;
  onStop: (cfg: LaunchConfiguration) => void;
}

/**
 * A launch-config row: leading eye/terminal type icon, name, a spinner while
 * starting, and a trailing start/stop button. Clicking the row selects the
 * config; the trailing button starts/stops it (and stops propagation so it
 * doesn't also select).
 */
function LaunchPickerRow({ config, status, selected, onSelect, onStart, onStop }: LaunchPickerRowProps) {
  const live = isLaunchStatusLive(status);
  const TypeIcon = config.preview ? Eye : Terminal;

  return (
    <div
      data-testid={`main-toolbar-launch-config-${config.name}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(config)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(config);
        }
      }}
      className={cn(menuRowClass(), 'cursor-pointer', selected && 'bg-accent')}
    >
      <TypeIcon className={cn('size-3', config.preview ? 'text-mf-surface-run' : 'text-muted-foreground')} />
      <span className={cn('min-w-0 flex-1 truncate', selected ? 'font-semibold' : 'font-medium')}>{config.name}</span>
      {status === 'starting' && <Loader2 className="size-2.5 animate-spin text-muted-foreground" aria-hidden />}
      <Hint label={live ? `Stop ${config.name}` : `Start ${config.name}`}>
        <Button
          data-testid={`main-toolbar-launch-${live ? 'stop' : 'start'}-${config.name}`}
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            if (live) onStop(config);
            else onStart(config);
          }}
        >
          {live ? (
            <Square className="size-3.5 text-destructive" fill="currentColor" />
          ) : (
            <Play className="size-3.5 text-success" fill="currentColor" />
          )}
        </Button>
      </Hint>
    </div>
  );
}
