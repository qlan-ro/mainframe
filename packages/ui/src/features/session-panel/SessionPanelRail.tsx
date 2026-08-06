/**
 * SessionPanelRail — the always-visible floating pill at the chat surface's
 * right edge. Top-down: open the panel · Background Activity · context usage ·
 * the launch quick action.
 *
 * Every button routes through `selectSection`, which expands its target and
 * floats the panel when the surface is too narrow to hold it inline — so a
 * collapsed section is revealed by the same click that scrolls to it. A button
 * reads engaged only while the panel IT opened is floating.
 *
 * The launch button is a quick action, not a menu: one click runs or stops the
 * config `deriveLaunchRunControl` targets. Config *selection* lives in the
 * panel's Launch section, and a right-click opens it — the same gesture the
 * other rail icons use, so rail-only mode keeps a route to the list.
 */
import { useCallback, useMemo } from 'react';
import { Activity, Info, Play, Square } from 'lucide-react';
import { Hint } from '@v2/components/ui/hint';
import { Separator } from '@v2/components/ui/separator';
import { severityOf } from '@/features/quota/quota-format';
import { useChatExtras } from '@/features/chat/runtime/use-chat-thread-runtime';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { deriveLaunchRunControl } from '@/features/run/derive-launch-control';
import type { SessionPanelSectionId } from '@/store/ui-prefs';
import { runningCount, runningLabel } from './activity-view';
import { useContextPercent } from './use-context-percent';
import { RailIconButton, RailMeterButton } from './SessionRailButton';
import type { SessionPanelState } from './use-session-panel-state';

const RAIL_CHROME =
  'mt-2 mr-2 ml-1 flex shrink-0 flex-col items-center gap-1 self-start rounded-full border border-border bg-card px-1 py-2 shadow-md';

interface SessionPanelRailProps {
  state: SessionPanelState;
  port: number;
  /** Lets the panel hand focus back to the button that opened an overlay. */
  registerButton?: (id: SessionPanelSectionId, el: HTMLButtonElement | null) => void;
}

export function SessionPanelRail({ state, port, registerButton }: SessionPanelRailProps) {
  const { mode, focusRequest, selectSection } = state;
  const { projectId, chatId } = useActiveIdentity();
  const extras = useChatExtras();
  const percent = useContextPercent();

  const backgroundTasks = extras?.state.backgroundTasks;
  const running = useMemo(() => runningCount(Object.values(backgroundTasks ?? {})), [backgroundTasks]);

  const { configs, scopeStatuses, selectedConfigName, handleLaunch, handleStop } = useLaunchActions(
    port,
    projectId,
    chatId,
  );
  const control = deriveLaunchRunControl(configs, scopeStatuses, selectedConfigName);
  const live = control.mode === 'running';
  const target = control.target;
  // chatId is mandatory: the daemon derives the effective worktree path from it,
  // so a start/stop issued without one acts on the wrong tree.
  const canLaunch = target != null && chatId != null;

  const onLaunchClick = useCallback(() => {
    if (!target || chatId == null) return;
    if (live) handleStop(target);
    else handleLaunch(target);
  }, [target, chatId, live, handleLaunch, handleStop]);

  const onLaunchContextMenu = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
      selectSection('launch');
    },
    [selectSection],
  );

  const isTargeting = (id: SessionPanelSectionId) => mode === 'overlay' && focusRequest?.id === id;
  const register = (id: SessionPanelSectionId) => (el: HTMLButtonElement | null) => registerButton?.(id, el);

  const activityLabel = running > 0 ? runningLabel(running) : 'Background Activity';
  const launchLabel = !canLaunch ? 'No launch configs' : live ? `Stop ${control.label}` : `Start ${control.label}`;

  return (
    <div data-testid="session-panel-rail" className={RAIL_CHROME}>
      <Hint label="Session panel" side="left">
        <RailIconButton
          ref={register('summary')}
          testId="session-panel-rail-open"
          label="Session panel"
          icon={Info}
          pressed={isTargeting('summary')}
          onClick={() => selectSection('summary')}
        />
      </Hint>

      <Hint label={activityLabel} side="left">
        <RailIconButton
          ref={register('activity')}
          testId="session-panel-rail-activity"
          label={activityLabel}
          icon={Activity}
          pressed={isTargeting('activity')}
          dot={running > 0}
          onClick={() => selectSection('activity')}
        />
      </Hint>

      {percent != null && (
        <Hint label={`Context: ${percent}% used`} side="left">
          <RailMeterButton
            testId="session-panel-rail-context"
            label={`Context: ${percent}% used`}
            percent={percent}
            severity={severityOf(percent)}
            onClick={() => selectSection('summary')}
          />
        </Hint>
      )}

      <Separator className="my-0.5 w-4" />

      {/* The glyph carries run-vs-stop by shape; the rail's ink stays uniform. */}
      <Hint label={launchLabel} side="left">
        <RailIconButton
          ref={register('launch')}
          testId="session-panel-rail-launch"
          label={launchLabel}
          icon={live ? Square : Play}
          disabled={!canLaunch}
          onClick={onLaunchClick}
          onContextMenu={onLaunchContextMenu}
        />
      </Hint>
    </div>
  );
}
