/**
 * SessionPanel — the session panel's shell: the card the panel lives in, plus
 * the rail it collapses to.
 *
 * The whole shell floats: the root is absolutely positioned over the chat
 * surface's right edge and takes NO width from the transcript, which keeps its
 * own centred full-surface column. Inline, the card sits in the whitespace
 * beside that column — alone, since a rail next to a visible card would be two
 * ways to reach the same thing. Too narrow for the gutter (or collapsed on
 * purpose) leaves the rail, and a rail click either brings the card back inline
 * or floats it over the thread. There is no title bar — content starts at
 * Summary — and no scrim: the panel is a light-dismiss companion, not a modal.
 *
 * The root is `pointer-events-none` and each surface inside it opts back in, so
 * the empty strip below a content-height card still scrolls the transcript
 * underneath rather than swallowing the wheel.
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

/**
 * Glass, not a solid fill: the panel floats OVER the transcript, and a surface
 * that lets the text move underneath reads as companion chrome rather than a
 * second column. The alpha carries the legibility — the blur is the finish, so
 * the panel still reads if a webview declines to composite it.
 */
const PANEL_CHROME =
  'pointer-events-auto flex w-80 flex-col overflow-hidden rounded-xl border border-border bg-background/85 backdrop-blur-xl';

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
      <SummarySection
        port={port}
        sectionRef={registerSection('summary')}
        // Only the inline card can be collapsed: the overlay's exit is its
        // light dismiss, and offering both would be two controls for one job.
        onCollapse={state.mode === 'inline' ? state.collapsePanel : undefined}
      />
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
  const hidden = mode === 'hidden';

  const railButtons = useRef(new Map<SessionPanelSectionId, HTMLButtonElement>());
  const registerButton = useCallback((id: SessionPanelSectionId, el: HTMLButtonElement | null) => {
    if (el) railButtons.current.set(id, el);
    else railButtons.current.delete(id);
  }, []);

  // Whichever way a card goes away — light-dismissed, collapsed, or squeezed out
  // by a narrowing surface — the rail is what replaces it, so focus lands there.
  const targetId = focusRequest?.id;
  const wasShowingCard = useRef(mode !== 'rail');
  useEffect(() => {
    const cardWentAway = wasShowingCard.current && mode === 'rail';
    wasShowingCard.current = mode !== 'rail';
    if (!cardWentAway) return;
    // Only when it left focus nowhere. An outside click has already put focus
    // somewhere the user chose; pulling it back would fight them.
    const active = document.activeElement;
    if (active != null && active !== document.body) return;
    railButtons.current.get(targetId ?? 'summary')?.focus();
  }, [mode, targetId]);

  // After every hook: when the gutter can't even hold the rail, nothing may
  // overlap the transcript — no card, no rail, no root.
  if (hidden) return null;

  return (
    <div
      ref={state.rootRef}
      data-testid="session-panel-root"
      // z-20 clears the transcript's own positioned chrome (the scroll-to-bottom
      // button sits at z-10); dialogs portal to the body and are unaffected.
      className="pointer-events-none absolute inset-y-0 right-0 z-20 flex"
    >
      {mode === 'inline' && (
        <div
          data-testid="session-panel"
          className={cn(PANEL_CHROME, 'mt-4 mr-4 mb-2 ml-2 max-h-[calc(100%-24px)] self-start shadow-lg')}
        >
          <PanelBody state={state} port={port} />
        </div>
      )}
      {mode === 'overlay' && (
        <div
          data-testid="session-panel-overlay"
          role="dialog"
          aria-label="Session panel"
          className={cn(PANEL_CHROME, 'absolute top-2 right-full z-30 max-h-[calc(100%-16px)] shadow-xl')}
        >
          <PanelBody state={state} port={port} />
        </div>
      )}
      {mode !== 'inline' && <SessionPanelRail state={state} port={port} registerButton={registerButton} />}
    </div>
  );
}
