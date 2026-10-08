/**
 * ChatSurface — chooses what the right pane shows for the active thread.
 *
 * - Zero projects, once useProjects has finished its initial load → the
 *   first-run hero (no ChatThread, no composer) — there is nowhere to send a
 *   message yet. Gated on `!loading` so a cold-boot render (projects still
 *   `[]` while the fetch is in flight) falls through to ChatThread instead of
 *   flashing the hero.
 * - A brand-new local thread (__LOCALID_* / status 'new' / no messages) whose
 *   draft already resolved a project (seeded by useNewThreadAutoConfig when a
 *   project pill is active, or by the ChatEmptyState welcome flow itself —
 *   Tasks 11-13) shows the ChatThread with the Welcome empty-state in its
 *   message column; the composer stays live so the first send still flows
 *   through onNew → coordinator → ONE createChat (no chat is created until the
 *   first send, D3).
 * - A new local thread with NO project resolved shows the same Welcome
 *   empty-state in its choose-project form: the welcome screen owns the
 *   project picker (the old anchored "NEW SESSION IN…" popover is gone), and
 *   ChatThread hides the composer until a project is picked — the first send
 *   needs one to create the chat in.
 * - Everything else (a sent local thread or a pre-existing chat) shows the
 *   plain ChatThread.
 *
 * The session panel DOCKS beside the thread column in the last two cases (or
 * overlays it when the column is too narrow to share). Its state machine
 * lives here because the column is the width the panel follows — it needs the
 * column's TOTAL width, before the panel takes its own, which the panel
 * measuring its own box would never see.
 */
import { useEffect } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { SessionPanel } from '@/features/session-panel/SessionPanel';
import { useSessionPanelState } from '@/features/session-panel/use-session-panel-state';
import { ChatZone } from '@/features/chat/zones/ChatZone';
import { SplitDivider } from '@/features/shared/SplitDivider';
import { useMeasuredWidth } from '@/features/shared/use-measured-width';
import { MIN_ZONE_WIDTH, useZonesStore } from '@/features/chat/zones/zones-store';
import { useZonesReconciler } from '@/features/chat/zones/use-zones-reconciler';
import { useZoneShortcutActions } from '@/features/chat/zones/use-zone-shortcut-actions';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { focusVisibleComposer } from '@/features/chat/composer/focus-composer';
import { ZoneDropLayer } from '@/features/chat/zones/ZoneDropLayer';
import { useFindInChatStore } from '@/features/chat/find/find-in-chat-store';
import { ChatThread } from '../../chat/thread/ChatThread';
import { ChatColumnHeader } from '../../chat/thread/ChatColumnHeader';
import { SideChatHost } from '@/features/side-chat/SideChatHost';
import { ChatEmptyState } from './ChatEmptyState';
import { useNewThreadAutoConfig } from './use-new-thread-auto-config';
import { useProjects } from '../use-projects';
import { useDraftConfigStore } from '../runtime/draft-config';
import { IDLE_INITIALIZATION, useNewThreadReady } from '../runtime/new-thread-ready-store';
import { usePendingDraftProject } from './pending-draft-project';

export function ChatSurface() {
  // Seeds the draft + marks-ready when a project pill is active (skips the picker).
  useNewThreadAutoConfig();
  // Keeps `mainThreadId ∈ zones` while split (and closes the split on a draft).
  useZonesReconciler();
  const aui = useAui();
  useZoneShortcutActions(aui);
  useShortcutAction('chat.focus-composer', focusVisibleComposer);
  const zones = useZonesStore((s) => s.zones);
  const closeSplit = useZonesStore((s) => s.closeSplit);
  const splitFrac = useZonesStore((s) => s.frac);
  const setSplitFrac = useZonesStore((s) => s.setFrac);

  // Width gate for the split: below 2×MIN_ZONE_WIDTH each zone would be
  // unusable, so the pair stays parked behind the single view until the
  // surface widens again. Measured on the surface root — the panel hook's
  // hostRef only attaches in single mode, so it cannot feed this decision.
  const [surfaceWidth, measureSurface] = useMeasuredWidth();
  const splitFits = surfaceWidth == null || surfaceWidth >= MIN_ZONE_WIDTH * 2 + 1;
  // Publish the gate: the tab strip, the reconciler and the drop layer must
  // agree with what this surface actually renders.
  const setSplitFits = useZonesStore((s) => s.setSplitFits);
  useEffect(() => setSplitFits(splitFits), [splitFits, setSplitFits]);

  const panelState = useSessionPanelState('main');

  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // Find state is one global store, but its query and matches belong to the
  // chat it was opened in: switching chats (or starting a draft) closes it.
  useEffect(() => {
    useFindInChatStore.getState().close();
  }, [mainThreadId]);
  // s.threadListItem is the native active ThreadListItemState; its `status`
  // ('new' | 'regular' | 'archived' | 'deleted') is read directly — the
  // SessionItem projection would collapse 'new' to 'regular' and break the
  // new-thread surface, so it is NOT used here.
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const draftCfg = useDraftConfigStore((s) => (mainThreadId ? s.drafts.get(mainThreadId) : undefined));
  const { projects, loading } = useProjects();
  // Paired with use-new-thread-auto-config's seed condition: both read the SOLE
  // scoped project, so a multi-project scope can never show "Initializing…" for
  // a seed that will not fire.
  const filterProjectId = useSessionFilters((s) => soleProjectId(s.filterProjectIds));
  // Set by useStartNewSession's no-pill path between the switch and
  // initializeDraft's synchronous ready-flip — without it that gap would show
  // the choose-a-project welcome for a target that is already resolved.
  const pendingProjectId = usePendingDraftProject((s) => s.projectId);
  const initialization = useNewThreadReady((s) =>
    mainThreadId ? s.getInitialization(mainThreadId) : IDLE_INITIALIZATION,
  );
  const isReady = useNewThreadReady((s) => (mainThreadId ? s.readyIds.has(mainThreadId) : false));

  const isNewLocal =
    mainThreadId != null && mainThreadId.startsWith('__LOCALID_') && itemStatus === 'new' && messageCount === 0;

  // A draft explicitly set to "No project" (the firstrun hero's secondary CTA)
  // must fall through to the normal welcome + live composer below, even with
  // zero real projects — the hero is only for a draft that hasn't been
  // pointed at "No project" (undecided, or resolved to a real project id).
  if (isNewLocal && !loading && projects.length === 0 && draftCfg?.projectId !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
          <ChatEmptyState variant="firstrun" />
        </div>
      </div>
    );
  }

  const isInitializing =
    initialization.status === 'initializing' ||
    (initialization.status === 'idle' && (filterProjectId ?? pendingProjectId) != null && draftCfg == null && !isReady);

  if (isNewLocal && (isInitializing || initialization.status === 'error')) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6">
          <p>{isInitializing ? 'Initializing session…' : 'Couldn’t initialize session'}</p>
          {initialization.status === 'error' && (
            <button
              type="button"
              data-testid="new-session-initialization-retry"
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => void initialization.retry?.().catch(() => undefined)}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const welcome = isNewLocal ? <ChatEmptyState variant="welcome" projectId={draftCfg?.projectId} /> : undefined;

  // Split mode renders only while the focused chat is a MEMBER of the pair
  // AND both zones clear MIN_ZONE_WIDTH — any other active session, or a
  // too-narrow surface, parks the split behind the normal single view (the
  // pair survives; a member tab click / widening brings it back). Focus is a
  // click (switchToThread), so `mainThreadId` keeps meaning "the focused zone".
  if (zones != null && mainThreadId != null && zones.includes(mainThreadId) && splitFits) {
    const closeZone = (closedId: string) => {
      const other = zones[0] === closedId ? zones[1] : zones[0];
      closeSplit();
      if (mainThreadId !== other) aui.threads.switchToThread(other);
    };
    return (
      <div ref={measureSurface} data-testid="chat-split-row" className="relative flex min-h-0 flex-1 overflow-hidden">
        <ChatZone
          chatId={zones[0]}
          grow={splitFrac}
          focused={mainThreadId === zones[0]}
          onFocus={() => aui.threads.switchToThread(zones[0])}
          onClose={() => closeZone(zones[0])}
        />
        <SplitDivider
          testId="chat-split-divider"
          minLeft={MIN_ZONE_WIDTH}
          minRight={MIN_ZONE_WIDTH}
          onFrac={setSplitFrac}
        />
        <ChatZone
          chatId={zones[1]}
          grow={1 - splitFrac}
          focused={mainThreadId === zones[1]}
          onFocus={() => aui.threads.switchToThread(zones[1])}
          onClose={() => closeZone(zones[1])}
        />
        <ZoneDropLayer canSplit />
      </div>
    );
  }

  return (
    <div ref={measureSurface} className="flex min-h-0 flex-1 flex-col">
      {/* The chat's title row (ChatColumnHeader) sits INSIDE the transcript
          column, so the docked panel runs the full height beside it. Its old controls
          live in the title bar (D7). `hostRef` is the hook's state-backed
          callback ref: on a cold boot the initializing branch renders first and
          this row arrives on a later commit, so a RefObject would measure null
          once and leave the panel hidden for good. The row is measured BEFORE
          the docked panel takes its width; `data-chat-column` is where the
          footer publishes its height for the overlay. */}
      <div ref={panelState.hostRef} data-chat-column className="relative flex min-h-0 flex-1 overflow-hidden">
        <SideChatHost parentChatId={mainThreadId}>
          <ChatColumnHeader columnId="main" toggleTestId="session-panel-toggle" tourAnchor />
          {/* The thread is h-full: it needs a box that is "the rest", not the column. */}
          <div className="min-h-0 flex-1">
            <ChatThread emptyState={welcome} />
          </div>
        </SideChatHost>
        <SessionPanel state={panelState} />
        <ZoneDropLayer canSplit={splitFits} />
      </div>
    </div>
  );
}
