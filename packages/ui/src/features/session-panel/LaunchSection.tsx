/**
 * LaunchSection — every launch configuration in the project, with its live
 * state and a one-click run/stop.
 *
 * This is where config SELECTION lives: the rail's quick action runs whatever
 * `deriveLaunchRunControl` targets, and starting a config here stamps it as the
 * selection, so the rail follows what you last ran. There is deliberately no
 * select-without-starting — selection follows the run.
 *
 * `chatId` is mandatory on both calls: the daemon derives the effective
 * worktree path from it, and the scope key is itself chatId-dependent, so a
 * stop issued without one looks up a different manager and finds no process.
 */
import { Eye, LoaderCircle, Play, Rocket, Square, Terminal } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { NO_CONFIGS_LABEL } from '@/features/run/derive-launch-control';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { deriveLaunchRows, type LaunchRow } from './launch-view';
import { PanelSection } from './PanelSection';

const ROW = 'flex items-center gap-2 rounded-md px-2 py-1';

function LaunchConfigRow({
  row,
  disabled,
  onActivate,
}: {
  row: LaunchRow;
  disabled: boolean;
  onActivate: (row: LaunchRow) => void;
}) {
  const { config, name, status, live } = row;
  const TypeIcon = config.preview ? Eye : Terminal;
  const action = live ? 'stop' : 'start';

  return (
    <Hint label={`${live ? 'Stop' : 'Start'} ${name}`}>
      <button
        type="button"
        data-testid={`session-panel-launch-row-${name}`}
        data-live={live}
        disabled={disabled}
        onClick={() => onActivate(row)}
        className={cn(
          ROW,
          'w-full text-left transition-colors hover:bg-foreground/8 disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate text-sm', row.selected && 'font-semibold')}>{name}</span>
        {status === 'starting' && (
          <LoaderCircle
            data-testid={`session-panel-launch-spinner-${name}`}
            className="size-3 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
        {/* The glyph IS the affordance — the whole row acts. Its testid mirrors
            the retired toolbar picker's so the e2e swap is a selector change. */}
        <span data-testid={`session-panel-launch-${action}-${name}`} className="shrink-0">
          {live ? (
            <Square className="size-3.5 text-destructive" fill="currentColor" aria-hidden />
          ) : (
            <Play className="size-3.5 text-success" fill="currentColor" aria-hidden />
          )}
        </span>
      </button>
    </Hint>
  );
}

interface LaunchSectionProps {
  port: number;
  open: boolean;
  onToggle: () => void;
  sectionRef?: (el: HTMLElement | null) => void;
}

export function LaunchSection({ port, open, onToggle, sectionRef }: LaunchSectionProps) {
  const { projectId, chatId } = useActiveIdentity();
  const { configs, scopeStatuses, selectedConfigName, handleLaunch, handleStop } = useLaunchActions(
    port,
    projectId,
    chatId,
  );

  const rows = deriveLaunchRows(configs, scopeStatuses, selectedConfigName);
  const liveCount = rows.filter((row) => row.live).length;

  const activate = (row: LaunchRow) => {
    if (chatId == null) return;
    if (row.live) handleStop(row.config);
    else handleLaunch(row.config);
  };

  return (
    <PanelSection
      id="launch"
      label="Launch"
      icon={Rocket}
      count={liveCount > 0 ? liveCount : undefined}
      open={open}
      onToggle={onToggle}
      sectionRef={sectionRef}
    >
      {rows.length === 0 ? (
        <div data-testid="session-panel-launch-empty" className={cn(ROW, 'text-sm text-muted-foreground')}>
          {NO_CONFIGS_LABEL}
        </div>
      ) : (
        rows.map((row) => <LaunchConfigRow key={row.name} row={row} disabled={chatId == null} onActivate={activate} />)
      )}
    </PanelSection>
  );
}
