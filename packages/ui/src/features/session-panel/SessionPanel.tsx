/**
 * SessionPanel — the session's inspector: ONE scrolling column of sections
 * (Session · Pull requests · Context · Activity · Tasks · Launch · Plan).
 *
 * It DOCKS: `inline` is a 300px flex sibling of the transcript column, taking
 * width from it; `overlay` (the column is too narrow to share) sits over the
 * transcript's right edge, stops above the composer footer (the footer
 * publishes its height as `--chat-footer-h` on the column), and carries a
 * scrim that joins the existing light-dismiss (Escape / pointer outside).
 * `hidden` renders nothing. The title bar's details toggle is the only switch.
 *
 * The state machine lives with the chat column (it measures the column the
 * panel shares); `state` arrives as a prop. The daemon port comes from
 * context, since `ChatSurface` has no port to give.
 */
import { cn } from '@/lib/utils';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { ActivitySection } from './ActivitySection';
import { ContextSection } from './ContextSection';
import { LaunchSection } from './LaunchSection';
import { PanelEyebrow } from './PanelEyebrow';
import { PlanSection } from './PlanSection';
import { PullRequestsSection } from './PullRequestsSection';
import { SummarySection } from './SummarySection';
import { TasksSection } from './TasksSection';
import { PANEL_WIDTH } from './panel-mode';
import type { SessionPanelState } from './use-session-panel-state';

function PanelSections({ state, port }: { state: SessionPanelState; port: number }) {
  const { isSectionOpen, toggleSection } = state;
  return (
    <div data-testid="session-panel-sections" className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y">
      <section data-testid="session-panel-card-session" className="shrink-0 border-b border-border">
        <PanelEyebrow label="Session" />
        <SummarySection port={port} />
      </section>
      <PullRequestsSection />
      <ContextSection port={port} open={isSectionOpen('context')} onToggle={() => toggleSection('context')} />
      <ActivitySection />
      <TasksSection />
      <LaunchSection port={port} />
      <PlanSection open={isSectionOpen('plan')} onToggle={() => toggleSection('plan')} />
    </div>
  );
}

export function SessionPanel({ state }: { state: SessionPanelState }) {
  const port = useDaemonPort();
  const { mode } = state;

  if (mode === 'hidden') return null;

  if (mode === 'inline') {
    return (
      <aside
        ref={state.rootRef}
        data-testid="session-panel-root"
        data-mode="inline"
        className="flex min-h-0 shrink-0 flex-col border-l border-border bg-background"
        style={{ width: PANEL_WIDTH }}
      >
        <div data-testid="session-panel" className="flex min-h-0 flex-1 flex-col">
          <PanelSections state={state} port={port} />
        </div>
      </aside>
    );
  }

  return (
    <div
      data-testid="session-panel-root"
      data-mode="overlay"
      // Stops above the composer footer so the panel never covers the input.
      className="absolute inset-x-0 top-0 z-20 flex justify-end"
      style={{ bottom: 'var(--chat-footer-h, 0px)' }}
    >
      {/* The scrim sits OUTSIDE the dismiss root (`rootRef` is the dialog), so a
          pointerdown on it is "outside" to the light-dismiss listener and closes
          the overlay the same way a click on the transcript would. */}
      <div data-testid="session-panel-scrim" aria-hidden className="absolute inset-0 bg-background/40" />
      <div
        ref={state.rootRef}
        data-testid="session-panel-overlay"
        role="dialog"
        aria-label="Session panel"
        className={cn(
          'relative flex h-full flex-col rounded-bl-[12px] border-b border-l border-border bg-background shadow-mf-pop',
        )}
        style={{ width: PANEL_WIDTH }}
      >
        <PanelSections state={state} port={port} />
      </div>
    </div>
  );
}
