/**
 * SessionPanelRail — the floating pill at the chat surface's right edge, the
 * switchboard for the stacked panels. Top-down: Session · context usage ·
 * Background Activity · Tasks · Launch.
 *
 * Every button TOGGLES its panel — open panels stack beside the transcript, or
 * float over it when the gutter is short. The launch button's old one-click
 * run/stop moved into the Launch panel's rows; the rail glyph keeps the run
 * state (dot when something is live) so the signal survives the move.
 *
 * Vertically centred (`self-center`), not top-anchored: the top-right corner
 * belongs to the find-in-chat band, which the rail used to sit on top of.
 */
import { useMemo } from 'react';
import { Activity, Info, ListTodo, Rocket } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { Separator } from '@/components/ui/separator';
import { severityOf } from '@/features/quota/quota-format';
import { useChatExtras } from '@/features/chat/runtime/use-chat-thread-runtime';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { deriveLaunchRunControl } from '@/features/run/derive-launch-control';
import { runningCount, runningLabel } from './activity-view';
import { useContextPercent } from './use-context-percent';
import { RailIconButton, RailMeter } from './SessionRailButton';
import type { SessionPanelState } from './use-session-panel-state';

const RAIL_CHROME =
  'pointer-events-auto mr-2 ml-1 flex shrink-0 flex-col items-center gap-1 self-center rounded-full border border-border bg-background/85 px-1 py-2 shadow-md backdrop-blur-xl';

interface SessionPanelRailProps {
  state: SessionPanelState;
  port: number;
}

export function SessionPanelRail({ state, port }: SessionPanelRailProps) {
  const { isPanelVisible, togglePanel } = state;
  const { projectId, chatId } = useActiveIdentity();
  const extras = useChatExtras();
  const percent = useContextPercent();

  const backgroundTasks = extras?.state.backgroundTasks;
  const running = useMemo(() => runningCount(Object.values(backgroundTasks ?? {})), [backgroundTasks]);

  const { configs, scopeStatuses, selectedConfigName } = useLaunchActions(port, projectId, chatId);
  const control = deriveLaunchRunControl(configs, scopeStatuses, selectedConfigName);
  const live = control.mode === 'running';

  const activityLabel = running > 0 ? runningLabel(running) : 'Background Activity';

  return (
    <div data-testid="session-panel-rail" className={RAIL_CHROME}>
      <Hint label="Session" side="left">
        <RailIconButton
          testId="session-panel-rail-open"
          label="Session"
          icon={Info}
          pressed={isPanelVisible('session')}
          onClick={() => togglePanel('session')}
        />
      </Hint>

      {percent != null && (
        <Hint label={`Context: ${percent}% used`} side="left">
          {/* An indicator, not a control — the Context details live in the
              Session card, one click up on the i. */}
          <RailMeter
            testId="session-panel-rail-context"
            label={`Context: ${percent}% used`}
            percent={percent}
            severity={severityOf(percent)}
          />
        </Hint>
      )}

      <Hint label={activityLabel} side="left">
        <RailIconButton
          testId="session-panel-rail-activity"
          label={activityLabel}
          icon={Activity}
          pressed={isPanelVisible('activity')}
          dot={running > 0}
          onClick={() => togglePanel('activity')}
        />
      </Hint>

      <Hint label="Tasks" side="left">
        <RailIconButton
          testId="session-panel-rail-tasks"
          label="Tasks"
          icon={ListTodo}
          pressed={isPanelVisible('tasks')}
          onClick={() => togglePanel('tasks')}
        />
      </Hint>

      <Separator className="my-0.5 w-4" />

      <Hint label={live ? `Launch — ${control.label} running` : 'Launch'} side="left">
        <RailIconButton
          testId="session-panel-rail-launch"
          label="Launch"
          icon={Rocket}
          pressed={isPanelVisible('launch')}
          dot={live}
          onClick={() => togglePanel('launch')}
        />
      </Hint>
    </div>
  );
}
