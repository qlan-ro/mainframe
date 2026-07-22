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
 * - Zero-session boot fallback: projects>0, "All" view (no project pill), and
 *   still on the unresolved boot draft after BOOT_SETTLE_MS → open the shared
 *   project-picker popover (same one the sidebar "+" button opens) instead of
 *   leaving a projectless dead-end (no project chip, no file tree, first send
 *   fails and rolls back). This state can otherwise only arise at boot: every
 *   other path into a new local thread (the "+" button's pick(), a pill-active
 *   ⌘N) resolves `draftCfg` before/at activation. The settle window lets
 *   useSessionListRouter's boot auto-select win the race when real sessions
 *   exist — see the effect below for how the cancel-on-redirect works.
 * - Everything else (a sent local thread, a pre-existing chat, or a new local
 *   thread with no project resolved yet) shows the plain ChatThread.
 */
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useSessionFilters } from '@/store/session-filters';
import { ChatCardHeader } from '../../chat/thread/ChatCardHeader';
import { ChatThread } from '../../chat/thread/ChatThread';
import { ChatEmptyState } from './ChatEmptyState';
import { useNewThreadAutoConfig } from './use-new-thread-auto-config';
import { useProjects } from '../use-projects';
import { useDraftConfigStore } from '../runtime/draft-config';
import { useNewSessionPickerTarget } from '../sidebar/use-new-session-picker-target';
import { IDLE_INITIALIZATION, useNewThreadReady } from '../runtime/new-thread-ready-store';

/** How long to wait, once we look like the zero-session boot dead-end, before
 *  forcing the project picker open. Long enough for useSessionListRouter's
 *  boot auto-select to win the race and redirect away when real sessions
 *  exist (mirrors useFirstRunTour's SETTLE_MS). */
const BOOT_SETTLE_MS = 1500;

/** Zero-session boot fallback (see the file-header note). Cancelable: any
 *  dependency change (e.g. the boot auto-select redirects to a real session,
 *  or the draft resolves a project) clears the pending timer/opens state
 *  before it fires. */
function useZeroSessionBootPicker(args: { isDeadEnd: boolean }): void {
  const { isDeadEnd } = args;
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (!isDeadEnd) {
      if (autoOpenedRef.current) {
        autoOpenedRef.current = false;
        useNewSessionPickerTarget.getState().setOpen(false);
      }
      return;
    }
    const timer = setTimeout(() => {
      autoOpenedRef.current = true;
      useNewSessionPickerTarget.getState().setOpen(true);
    }, BOOT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isDeadEnd]);
}

export function ChatSurface({ port: _port }: { port: number }) {
  // Seeds the draft + marks-ready when a project pill is active (skips the picker).
  useNewThreadAutoConfig();

  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // s.threadListItem is the native active ThreadListItemState; its `status`
  // ('new' | 'regular' | 'archived' | 'deleted') is read directly — the
  // SessionItem projection would collapse 'new' to 'regular' and break the
  // new-thread surface, so it is NOT used here.
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const draftCfg = useDraftConfigStore((s) => (mainThreadId ? s.drafts.get(mainThreadId) : undefined));
  const { projects, loading } = useProjects();
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);
  const initialization = useNewThreadReady((s) =>
    mainThreadId ? s.getInitialization(mainThreadId) : IDLE_INITIALIZATION,
  );
  const isReady = useNewThreadReady((s) => (mainThreadId ? s.readyIds.has(mainThreadId) : false));

  const isNewLocal =
    mainThreadId != null && mainThreadId.startsWith('__LOCALID_') && itemStatus === 'new' && messageCount === 0;

  useZeroSessionBootPicker({
    isDeadEnd: isNewLocal && !loading && projects.length > 0 && draftCfg == null && filterProjectId == null,
  });

  if (isNewLocal && !loading && projects.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatCardHeader />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
          <ChatEmptyState variant="firstrun" />
        </div>
      </div>
    );
  }

  const isInitializing =
    initialization.status === 'initializing' ||
    (initialization.status === 'idle' && filterProjectId != null && draftCfg == null && !isReady);

  if (isNewLocal && (isInitializing || initialization.status === 'error')) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatCardHeader />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6">
          <p>{isInitializing ? 'Initializing session…' : 'Couldn’t initialize session'}</p>
          {initialization.status === 'error' && (
            <button
              type="button"
              data-testid="new-session-initialization-retry"
              className="rounded-md border px-3 py-1.5 text-body"
              onClick={() => void initialization.retry?.().catch(() => undefined)}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const welcome =
    isNewLocal && draftCfg != null ? <ChatEmptyState variant="welcome" projectId={draftCfg.projectId} /> : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatCardHeader />
      {/* min-h-0 + flex-col so ChatThread's h-full resolves against a definite
          height — otherwise the sticky composer footer collapses/clips. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatThread emptyState={welcome} />
      </div>
    </div>
  );
}
