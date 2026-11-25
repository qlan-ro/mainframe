/**
 * SessionPanel — the session's index: one column of sections under a "Session"
 * title whose Sections menu turns each one on or off.
 *
 * It is an inset card that fits its content, capped at the chat area's height
 * and scrolling inside under a sticky header. `inline` docks it beside the
 * transcript; `overlay` (the column is too narrow to share) floats the same
 * card over the transcript, from under the column header to 8px above the
 * composer, so the toggle and the composer both stay usable. `hidden` renders
 * nothing.
 *
 * The state machine lives with the chat column (it measures the column the
 * panel shares); `state` arrives as a prop. The daemon port comes from
 * context, since `ChatSurface` has no port to give.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useUiPrefs, type SessionPanelSectionKey } from '@/store/ui-prefs';
import { ActivitySection } from './ActivitySection';
import {
  AttachmentsSection,
  MemorySection,
  MentionsSection,
  SessionContextProvider,
  SkillsSection,
} from './ContextSections';
import { LaunchSection } from './LaunchSection';
import { PanelEmpty } from './PanelSection';
import { PlanSection } from './PlanSection';
import { PullRequestsSection } from './PullRequestsSection';
import { SectionsMenu } from './SectionsMenu';
import { TasksSection } from './TasksSection';
import { PANEL_WIDTH } from './panel-mode';
import { visibleSections } from './panel-sections';
import { useComposerInset } from './use-composer-inset';
import type { SessionPanelState } from './use-session-panel-state';

const CARD =
  'flex flex-col overflow-y-auto rounded-xl border border-border bg-background dark:bg-[color-mix(in_srgb,var(--card)_55%,var(--background))]';

function renderSection(key: SessionPanelSectionKey, state: SessionPanelState, port: number): ReactNode {
  switch (key) {
    case 'prs':
      return <PullRequestsSection key={key} />;
    case 'plan':
      return <PlanSection key={key} open={state.isSectionOpen('plan')} onToggle={() => state.toggleSection('plan')} />;
    case 'activity':
      return <ActivitySection key={key} columnId={state.columnId} />;
    case 'launch':
      return <LaunchSection key={key} port={port} />;
    case 'memory':
      return <MemorySection key={key} />;
    case 'mentions':
      return <MentionsSection key={key} />;
    case 'skills':
      return <SkillsSection key={key} />;
    case 'attachments':
      return <AttachmentsSection key={key} port={port} />;
    case 'tasks':
      return <TasksSection key={key} />;
  }
}

function PanelBody({ state }: { state: SessionPanelState }) {
  const port = useDaemonPort();
  // No daemon chat until the first message creates it: a draft has no session to index yet.
  const started = useActiveIdentity().chatId != null;
  const hidden = useUiPrefs((s) => s.sessionPanelHiddenSections);
  const sections = visibleSections(hidden, started);
  return (
    <>
      <div className="sticky top-0 z-10 flex h-11 shrink-0 items-center justify-between bg-inherit pr-1.5 pl-3.5">
        <h2 className="text-sm font-semibold">Session</h2>
        <SectionsMenu />
      </div>
      <SessionContextProvider>
        <div data-testid="session-panel-sections" className="flex flex-col">
          {sections.length === 0 ? (
            <PanelEmpty data-testid="session-panel-none" className="pb-2.5">
              Every section is turned off
            </PanelEmpty>
          ) : (
            sections.map((key) => renderSection(key, state, port))
          )}
        </div>
      </SessionContextProvider>
    </>
  );
}

function FloatingPanel({ state }: { state: SessionPanelState }) {
  const { rootRef } = state;
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const inset = useComposerInset(root);

  // The toggle opened it: a keyboard user's next Tab belongs inside the panel.
  useEffect(() => {
    if (document.activeElement?.closest('[data-session-panel-toggle]')) rootRef.current?.focus();
  }, [rootRef]);

  return (
    <div
      ref={setRoot}
      data-testid="session-panel-root"
      data-mode="overlay"
      className="pointer-events-none absolute inset-x-0 top-11 z-20 flex justify-end"
      style={{ bottom: inset } as CSSProperties}
    >
      {/* Outside the dismiss root (`rootRef` is the dialog), so a press on it is
          "outside" to the light-dismiss listener, like one on the transcript. */}
      <div
        data-testid="session-panel-scrim"
        aria-hidden
        className="pointer-events-auto absolute inset-0 bg-background/40"
      />
      <div
        ref={rootRef}
        data-testid="session-panel-overlay"
        role="dialog"
        aria-label="Session panel"
        tabIndex={-1}
        className={cn(
          CARD,
          'pointer-events-auto relative mt-2 mr-2 max-h-[calc(100%-0.5rem)] self-start shadow-mf-pop outline-none focus-visible:focus-line',
        )}
        style={{ width: PANEL_WIDTH }}
      >
        <PanelBody state={state} />
      </div>
    </div>
  );
}

export function SessionPanel({ state }: { state: SessionPanelState }) {
  if (state.mode === 'hidden') return null;
  if (state.mode === 'overlay') return <FloatingPanel state={state} />;
  return (
    <aside
      ref={state.rootRef}
      data-testid="session-panel-root"
      data-mode="inline"
      aria-label="Session panel"
      className="flex min-h-0 shrink-0 flex-col py-2 pr-2"
    >
      <div data-testid="session-panel" className={cn(CARD, 'max-h-full min-h-0')} style={{ width: PANEL_WIDTH }}>
        <PanelBody state={state} />
      </div>
    </aside>
  );
}
