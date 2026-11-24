/**
 * LaunchSection — every launch configuration in the project, with its live
 * state and a one-click run/stop.
 *
 * This is where config SELECTION lives: starting a config here stamps it as
 * the selection (bold). There is deliberately no select-without-starting —
 * selection follows the run.
 *
 * `chatId` is mandatory on both calls: the daemon derives the effective
 * worktree path from it, and the scope key is itself chatId-dependent, so a
 * stop issued without one looks up a different manager and finds no process.
 */
import { Eye, LoaderCircle, Play, Square, Terminal } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { deriveLaunchRows, launchEmptyStateLabel, type LaunchRow } from './launch-view';
import { PanelEmpty, PanelRow, PanelSection } from './PanelSection';

function LaunchValue({ row }: { row: LaunchRow }) {
  const { name, status, live } = row;
  return (
    <>
      {status === 'failed' && <span className="text-fail">failed</span>}
      {status === 'starting' && (
        <LoaderCircle
          data-testid={`session-panel-launch-spinner-${name}`}
          className="size-3 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden
        />
      )}
      {/* The glyph is what the row does; the whole row acts. */}
      <span data-testid={`session-panel-launch-${live ? 'stop' : 'start'}-${name}`}>
        {live ? (
          <Square className="size-3 text-destructive" fill="currentColor" aria-hidden />
        ) : (
          <Play
            className="size-3 transition-colors group-hover/launch:text-primary group-focus-visible/launch:text-primary"
            fill="currentColor"
            aria-hidden
          />
        )}
      </span>
    </>
  );
}

const STATUS_LABEL: Record<LaunchRow['status'], string> = {
  starting: ', starting',
  running: ', running',
  failed: ', failed',
  stopped: '',
};

export function LaunchSection({ port }: { port: number }) {
  const { projectId, chatId, noProject } = useActiveIdentity();
  const { configs, scopeStatuses, selectedConfigName, handleLaunch, handleStop } = useLaunchActions(
    port,
    projectId,
    chatId,
  );
  const rows = deriveLaunchRows(configs, scopeStatuses, selectedConfigName);

  const activate = (row: LaunchRow) => {
    if (chatId == null) return;
    if (row.live) handleStop(row.config);
    else handleLaunch(row.config);
  };

  return (
    <PanelSection section="launch" data-testid="session-panel-card-launch">
      {rows.length === 0 ? (
        <PanelEmpty data-testid="session-panel-launch-empty">{launchEmptyStateLabel(noProject)}</PanelEmpty>
      ) : (
        rows.map((row) => {
          const action = `${row.live ? 'Stop' : 'Start'} ${row.name}`;
          return (
            <Hint key={row.name} label={action}>
              <PanelRow
                data-testid={`session-panel-launch-row-${row.name}`}
                data-live={row.live}
                aria-label={`${action}${STATUS_LABEL[row.status]}`}
                disabled={chatId == null}
                onClick={() => activate(row)}
                className="group/launch"
                icon={row.config.preview ? <Eye /> : <Terminal />}
                label={row.name}
                labelClassName={row.selected ? 'font-semibold' : undefined}
                value={<LaunchValue row={row} />}
              />
            </Hint>
          );
        })
      )}
    </PanelSection>
  );
}
