/**
 * SessionPanel — the session panel's shell: the rail, plus the card the panel
 * lives in.
 *
 * The card is never flush. Inline it is a detached `rounded-xl` card inset from
 * the surface edges with its own shadow and its own scroll; when the surface is
 * too narrow it collapses to the rail alone, and a rail click floats the same
 * card over the thread. There is no title bar — content starts at Summary — and
 * no scrim: the panel is a light-dismiss companion to the chat, not a modal.
 *
 * The floating card is a `dialog` with an `aria-label`, because it has no
 * visible title to name it, and focus returns to the rail button that opened it
 * when it is dismissed with focus still inside — otherwise a keyboard user is
 * dropped at the document root.
 *
 * The panel's state machine lives with the chat surface (it measures the row the
 * panel shares with the thread column), so `state` arrives as a prop; the daemon
 * port comes from context, since `ChatSurface` has no port to give.
 */
import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@v2/lib/utils';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import type { SessionPanelSectionId } from '@/store/ui-prefs';
import { ActivitySection } from './ActivitySection';
import { ContextSection } from './ContextSection';
import { LaunchSection } from './LaunchSection';
import { PlanSection } from './PlanSection';
import { SessionPanelRail } from './SessionPanelRail';
import { SummarySection } from './SummarySection';
import type { SessionPanelState } from './use-session-panel-state';

const PANEL_CHROME = 'flex w-80 flex-col overflow-hidden rounded-xl border border-border bg-card';

/**
 * Where the sections scroll — the panel's only scroll region. Section order is
 * Summary · Plan · Background Activity · Launch · Context: the three
 * process-shaped sections cluster in the middle (what the agent is doing, what
 * is running, what you can run) and Context stays at the bottom as reference.
 */
function PanelBody({ state, port }: { state: SessionPanelState; port: number }) {
  const { isSectionOpen, toggleSection, registerSection } = state;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SummarySection port={port} sectionRef={registerSection('summary')} />
      <PlanSection
        open={isSectionOpen('plan')}
        onToggle={() => toggleSection('plan')}
        sectionRef={registerSection('plan')}
      />
      <ActivitySection
        open={isSectionOpen('activity')}
        onToggle={() => toggleSection('activity')}
        sectionRef={registerSection('activity')}
      />
      <LaunchSection
        port={port}
        open={isSectionOpen('launch')}
        onToggle={() => toggleSection('launch')}
        sectionRef={registerSection('launch')}
      />
      <ContextSection
        port={port}
        open={isSectionOpen('context')}
        onToggle={() => toggleSection('context')}
        sectionRef={registerSection('context')}
      />
    </div>
  );
}

export function SessionPanel({ state }: { state: SessionPanelState }) {
  const port = useDaemonPort();
  const { mode, focusRequest } = state;

  const railButtons = useRef(new Map<SessionPanelSectionId, HTMLButtonElement>());
  const registerButton = useCallback((id: SessionPanelSectionId, el: HTMLButtonElement | null) => {
    if (el) railButtons.current.set(id, el);
    else railButtons.current.delete(id);
  }, []);

  const targetId = focusRequest?.id;
  const wasFloating = useRef(mode === 'overlay');
  useEffect(() => {
    const dismissed = wasFloating.current && mode === 'rail';
    wasFloating.current = mode === 'overlay';
    if (!dismissed) return;
    // Only when the dismissal left focus nowhere. An outside click has already
    // put focus somewhere the user chose; pulling it back would fight them.
    const active = document.activeElement;
    if (active != null && active !== document.body) return;
    railButtons.current.get(targetId ?? 'summary')?.focus();
  }, [mode, targetId]);

  return (
    <div ref={state.rootRef} data-testid="session-panel-root" className="relative flex h-full">
      {mode === 'inline' && (
        <div data-testid="session-panel" className={cn(PANEL_CHROME, 'my-2 ml-2 shadow-lg')}>
          <PanelBody state={state} port={port} />
        </div>
      )}
      {mode === 'overlay' && (
        <div
          data-testid="session-panel-overlay"
          role="dialog"
          aria-label="Session panel"
          className={cn(PANEL_CHROME, 'absolute top-2 right-full bottom-2 z-30 shadow-xl')}
        >
          <PanelBody state={state} port={port} />
        </div>
      )}
      <SessionPanelRail state={state} port={port} registerButton={registerButton} />
    </div>
  );
}
