/**
 * ToolbarLaunchControls — the shell MainToolbar launch picker: a "Preview"
 * dropdown showing the selected config name + a run/stop button, wired to the
 * same launch subsystem as the Run surface's `LaunchPopover` (via
 * `useLaunchActions`).
 *
 * Per the artboard `LaunchPicker`, a dropdown row click only SELECTS the config
 * (no tab, no start) while a separate per-row button starts/stops it; the
 * toolbar run button starts the selected config (or the first available), and
 * stops it while running. Starting (either button) is what opens the preview
 * tab. "Generate with Agent" is a gated placeholder until a config-generation
 * flow exists.
 *
 * Scoped testids: main-toolbar-launch, main-toolbar-play,
 * main-toolbar-launch-config-<name>, main-toolbar-launch-{start,stop}-<name>,
 * main-toolbar-launch-generate.
 */
import { useCallback, useState } from 'react';
import { ChevronDown, Eye, Play, Sparkles, Square, Terminal } from 'lucide-react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuDivider, MenuEmpty, MenuRow, menuItemVariants } from '@/components/ui/menu';
import { useLaunchActions } from './use-launch-actions';

interface ToolbarLaunchControlsProps {
  port: number;
  projectId?: string;
  chatId?: string;
}

export function ToolbarLaunchControls({ port, projectId, chatId }: ToolbarLaunchControlsProps) {
  const [open, setOpen] = useState(false);
  const { configs, scopeStatuses, selectedConfigName, handleSelect, handleLaunch, handleStop, refetch } =
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
        <PopoverTrigger asChild>
          <button
            data-testid="main-toolbar-launch"
            type="button"
            title="Launch configurations"
            className="inline-flex h-[24px] max-w-[200px] cursor-pointer items-center gap-[5px] rounded-[6px] bg-mf-chip px-[8px] text-label font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
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
          <MenuDivider />
          <MenuRow
            data-testid="main-toolbar-launch-generate"
            icon={<Sparkles className="size-[12px] text-primary" />}
            label="Generate with Agent"
            disabled
            title="Generate with Agent — coming soon"
          />
        </PopoverContent>
      </Popover>
      <button
        data-testid="main-toolbar-play"
        type="button"
        title={!runTarget ? 'No launch configs' : running ? `Stop ${runTarget.name}` : `Start ${runTarget.name}`}
        onClick={onRunClick}
        disabled={!runTarget}
        className="inline-flex h-[24px] w-[28px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? (
          <Square size={15} className="text-destructive" fill="currentColor" />
        ) : (
          <Play size={15} className="text-mf-success" fill="currentColor" />
        )}
      </button>
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
 * A launch-config row: leading eye/terminal type icon, name, an amber spinner
 * while starting, and a trailing start/stop button. Clicking the row selects
 * the config; the trailing button starts/stops it (and stops propagation so it
 * doesn't also select).
 */
function LaunchPickerRow({ config, status, selected, onSelect, onStart, onStop }: LaunchPickerRowProps) {
  const live = status === 'running' || status === 'starting';
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
      className={cn(menuItemVariants(), 'w-full cursor-pointer hover:bg-accent', selected && 'bg-accent')}
    >
      <TypeIcon className={cn('size-[12px]', config.preview ? 'text-mf-surface-run' : 'text-mf-text-3')} />
      <span className={cn('min-w-0 flex-1 truncate', selected ? 'font-semibold' : 'font-medium')}>{config.name}</span>
      {status === 'starting' && (
        <span
          className="size-[10px] shrink-0 animate-spin rounded-full border-[1.5px] border-mf-warning border-t-transparent"
          aria-hidden
        />
      )}
      <button
        type="button"
        data-testid={`main-toolbar-launch-${live ? 'stop' : 'start'}-${config.name}`}
        title={live ? `Stop ${config.name}` : `Start ${config.name}`}
        onClick={(e) => {
          e.stopPropagation();
          if (live) onStop(config);
          else onStart(config);
        }}
        className="inline-flex h-[24px] w-[26px] shrink-0 items-center justify-center rounded-[6px] hover:bg-mf-chip"
      >
        {live ? (
          <Square size={15} className="text-destructive" fill="currentColor" />
        ) : (
          <Play size={16} className="text-mf-success" fill="currentColor" />
        )}
      </button>
    </div>
  );
}
