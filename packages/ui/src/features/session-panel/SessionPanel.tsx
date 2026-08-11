/**
 * SessionPanel — the rail plus the stack of panels it toggles.
 *
 * The whole shell floats: the root is absolutely positioned over the chat
 * surface's right edge and takes NO width from the transcript, which keeps its
 * own centred full-surface column. Each open panel is its own glass card;
 * open cards stack top-down in the gutter beside the column, and when the
 * gutter is too short a rail click floats the same stack over the transcript
 * instead. The rail renders in every measured state — it is the switchboard,
 * so it never hides behind the thing it switches. There is no scrim: the
 * stack is a light-dismiss companion, not a modal.
 *
 * The root is `pointer-events-none` and each surface inside it opts back in, so
 * the strip below a content-height stack still scrolls the transcript
 * underneath rather than swallowing the wheel.
 *
 * The floating stack is a `dialog` with an `aria-label`, because it has no
 * visible title to name it.
 *
 * The panel's state machine lives with the chat surface (it measures the row the
 * panel shares with the thread column), so `state` arrives as a prop; the daemon
 * port comes from context, since `ChatSurface` has no port to give.
 */
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import type { SessionPanelId } from '@/store/ui-prefs';
import { ActivityCard } from './ActivityCard';
import { ContextSection } from './ContextSection';
import { LaunchCard } from './LaunchCard';
import { PanelCard } from './PanelCard';
import { PlanSection } from './PlanSection';
import { SessionPanelRail } from './SessionPanelRail';
import { SummarySection } from './SummarySection';
import { TasksCard } from './TasksCard';
import type { SessionPanelState } from './use-session-panel-state';

const PANEL_IDS: SessionPanelId[] = ['session', 'activity', 'launch', 'tasks'];

/** The session card: Summary is the identity, Plan and Context fold under it. */
function SessionCard({ state, port, onClose }: { state: SessionPanelState; port: number; onClose: () => void }) {
  const { isSectionOpen, toggleSection } = state;
  return (
    <PanelCard id="session" label="Session" icon={Info} onClose={onClose} className="max-h-[36rem]">
      <SummarySection port={port} />
      <PlanSection open={isSectionOpen('plan')} onToggle={() => toggleSection('plan')} />
      <ContextSection port={port} open={isSectionOpen('context')} onToggle={() => toggleSection('context')} />
    </PanelCard>
  );
}

function PanelStack({ state, port }: { state: SessionPanelState; port: number }) {
  const close = (id: SessionPanelId) => () => state.togglePanel(id);
  return (
    <>
      {state.isPanelOpen('session') && <SessionCard state={state} port={port} onClose={close('session')} />}
      {state.isPanelOpen('activity') && <ActivityCard onClose={close('activity')} />}
      {state.isPanelOpen('launch') && <LaunchCard port={port} onClose={close('launch')} />}
      {state.isPanelOpen('tasks') && <TasksCard onClose={close('tasks')} />}
    </>
  );
}

export function SessionPanel({ state }: { state: SessionPanelState }) {
  const port = useDaemonPort();
  const { mode } = state;

  // Hidden now only means "not yet measured" — the rail has no minimum width.
  if (mode === 'hidden') return null;

  const anyOpen = PANEL_IDS.some((id) => state.isPanelOpen(id));
  const showStack = anyOpen && (mode === 'inline' || mode === 'overlay');

  // The stack owns its pointer events (it scrolls); the 8px gaps between cards
  // are part of it. The area below the stack stays pass-through.
  const stackChrome = 'pointer-events-auto flex w-72 flex-col gap-2 overflow-y-auto';

  return (
    <div
      ref={state.rootRef}
      data-testid="session-panel-root"
      // z-20 clears the transcript's own positioned chrome (the scroll-to-bottom
      // button sits at z-10); dialogs portal to the body and are unaffected.
      className="pointer-events-none absolute inset-y-0 right-0 z-20 flex"
    >
      {showStack && mode === 'inline' && (
        <div
          data-testid="session-panel"
          className={cn(stackChrome, '*:shadow-sm', 'mt-4 mr-1 mb-2 ml-2 max-h-[calc(100%-24px)] self-start')}
        >
          <PanelStack state={state} port={port} />
        </div>
      )}
      {showStack && mode === 'overlay' && (
        <div
          data-testid="session-panel-overlay"
          role="dialog"
          aria-label="Session panel"
          className={cn(stackChrome, '*:shadow-xl', 'absolute top-2 right-full z-30 max-h-[calc(100%-16px)]')}
        >
          <PanelStack state={state} port={port} />
        </div>
      )}
      <SessionPanelRail state={state} port={port} />
    </div>
  );
}
