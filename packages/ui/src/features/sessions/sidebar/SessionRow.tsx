/**
 * SessionRow — one session in the sidebar list.
 *
 * Provider keyed by the STABLE item.id (NOT remoteId): a thread's id is fixed for
 * its whole life, so the row never re-keys when a new chat adopts its remoteId.
 * Active highlight is fully native — ThreadListItemPrimitive.Root sets data-active/
 * aria-current when mainThreadId === threadListItem.id; we only style data-[active=true].
 * Actions (rename/archive) come from the item RUNTIME (useThreadListItemRuntime),
 * not the item STATE (useThreadListItem). Status dot via deriveSessionBadge + unread.
 * Responsive: @max-[300px] hides time; @max-[220px] hides meta row.
 */
import type { MouseEvent } from 'react';
import { memo, useRef, useState } from 'react';
import {
  ThreadListItemPrimitive,
  ThreadListItemRuntimeProvider,
  useAssistantRuntime,
  useThreadListItemRuntime,
} from '@assistant-ui/react';
import { PaperclipIcon, PinIcon, TagIcon, XIcon } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { deriveSessionBadge, type SessionBadge } from '../view-model/session-status';
import { formatRelativeTime } from '../view-model/relative-time';
import { useUnreadStore } from '@/store/unread-store';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { pinChat } from '@/lib/api/chats';
import { SessionRowMeta } from './SessionRowMeta';
import { SessionRowRename } from './SessionRowRename';
import { SessionContextMenu } from './SessionContextMenu';
import { useTagPopoverTarget } from '../tags/use-tag-popover-target';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { Hint } from '@/components/ui/hint';

/**
 * The dot is the row's ONLY status indicator (no text pill). Four states:
 *   - working  → a spinning progress circle
 *   - waiting  → a PULSING coloured beacon ("your turn" — rendered in StatusDot)
 *   - idle+unread → a solid (non-pulsing) coloured dot (an unread response)
 *   - idle       → a muted, uncoloured dot
 * (worktree-missing keeps its own destructive dot, outside the four-state set.)
 */
function dotClass(badge: SessionBadge): string {
  switch (badge.base) {
    case 'worktree-missing':
      return 'size-1.5 bg-destructive';
    case 'working':
      return 'size-[8px] border-[1.5px] border-primary border-t-transparent animate-spin';
    case 'waiting':
      // Unreachable — the pulsing beacon is rendered separately in StatusDot.
      return 'size-[9px] bg-mf-warning';
    case 'idle':
      return badge.unread ? 'size-1.5 bg-primary' : 'size-1.5 bg-mf-text-4 opacity-50';
  }
}

/** The dot is the row's ONLY status indicator (no text pill) — the tooltip carries the label. */
function dotLabel(badge: SessionBadge): string {
  switch (badge.base) {
    case 'worktree-missing':
      return 'Worktree missing';
    case 'working':
      return 'Working';
    case 'waiting':
      return 'Your turn';
    case 'idle':
      return badge.unread ? 'Unread response' : 'Idle';
  }
}

export function StatusDot({ badge }: { badge: SessionBadge }) {
  if (badge.base === 'waiting') {
    // "Your turn" → a pulsing coloured beacon: an expanding ping ring behind a
    // solid inner dot (artboard StatusDot lines 379-390). All waiting sessions
    // pulse, read or unread — being waiting IS the call to respond.
    return (
      <Hint label={dotLabel(badge)}>
        <span
          data-testid="sessions-row-status-dot"
          aria-label={badge.base}
          className="relative inline-flex size-2.5 flex-shrink-0 items-center justify-center"
        >
          <span className="absolute size-full animate-ping rounded-full bg-mf-warning opacity-75" />
          <span className="relative size-[9px] rounded-full bg-mf-warning shadow-[0_0_0_2px_color-mix(in_srgb,var(--mf-warning)_18%,transparent)]" />
        </span>
      </Hint>
    );
  }

  return (
    <Hint label={dotLabel(badge)}>
      <span
        data-testid="sessions-row-status-dot"
        aria-label={badge.base}
        className={`inline-block flex-shrink-0 rounded-full ${dotClass(badge)}`}
      />
    </Hint>
  );
}

function RelativeTime({ updatedAt }: { updatedAt: number }) {
  const text = formatRelativeTime(updatedAt, Date.now());
  return (
    <span
      data-testid="sessions-row-relative-time"
      className="flex-shrink-0 text-micro tabular-nums text-mf-text-3 group-hover:hidden"
    >
      {text}
    </span>
  );
}

/**
 * RowHoverActions — tag / rename / archive icon buttons revealed on row hover
 * (artboard SessionRowDense `.tw-row-actions` shown on `:hover`, swapping out
 * the time). Each click stops propagation so it doesn't also select the row,
 * and wires to the same handlers the right-click context menu uses.
 */
function RowHoverActions({
  onTags,
  onRename,
  onArchive,
}: {
  onTags: (rect: DOMRect) => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const btn =
    'inline-flex size-[22px] items-center justify-center rounded-xs text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground';
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };
  return (
    <div className="hidden flex-shrink-0 items-center group-hover:flex">
      <Hint label="Tags">
        <button
          data-testid="sessions-row-action-tags"
          type="button"
          className={btn}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTags(e.currentTarget.getBoundingClientRect());
          }}
        >
          <TagIcon className="size-[11px]" />
        </button>
      </Hint>
      <Hint label="Rename">
        <button data-testid="sessions-row-action-rename" type="button" className={btn} onClick={stop(onRename)}>
          <PaperclipIcon className="size-[11px]" />
        </button>
      </Hint>
      <Hint label="Archive">
        <button data-testid="sessions-row-action-archive" type="button" className={btn} onClick={stop(onArchive)}>
          <XIcon className="size-[11px]" />
        </button>
      </Hint>
    </div>
  );
}

/**
 * `colorOf` is threaded down from the sidebar's single `useTagRegistry` so the
 * whole list shares ONE `listTags()` fetch — rows never fetch the registry
 * themselves. Defaults to the registry's own fallback color when omitted (e.g.
 * a row rendered in isolation), so tag dots still paint.
 */
const DEFAULT_COLOR_OF = (): TagColor => 'blue';

function SessionRowInner({
  item,
  colorOf,
  inPinnedGroup,
  projectName,
}: {
  item: SessionItem;
  colorOf: (name: string) => TagColor;
  inPinnedGroup: boolean;
  projectName?: string;
}) {
  const { custom } = item;
  const port = useDaemonPort();
  const itemRuntime = useThreadListItemRuntime();
  const assistantRuntime = useAssistantRuntime();
  const isUnread = useUnreadStore((s) => s.isUnread(item.id));
  const badge = deriveSessionBadge(custom, isUnread);
  const [isRenaming, setIsRenaming] = useState(false);
  // Captured on right-click so the context-menu "Tags" action can anchor the
  // popover at the cursor (same coordinates the context menu opened at) rather
  // than the host's default (0,0).
  const contextMenuPoint = useRef<{ x: number; y: number } | null>(null);

  const title = item.title ?? 'Untitled session';

  function handleCommitRename(newTitle: string) {
    void itemRuntime.rename(newTitle);
    setIsRenaming(false);
  }

  function handlePin() {
    void pinChat(port, item.id, true)
      .then(() => assistantRuntime.threads.reload())
      .catch((e: unknown) => {
        console.warn('[SessionRow] pinChat failed', e);
      });
  }

  function handleUnpin() {
    void pinChat(port, item.id, false)
      .then(() => assistantRuntime.threads.reload())
      .catch((e: unknown) => {
        console.warn('[SessionRow] unpinChat failed', e);
      });
  }

  function handleTags(anchorRect: DOMRect | null = null) {
    const chatId = item.remoteId ?? item.id;
    const currentTags = custom.tags ?? [];
    useTagPopoverTarget.getState().open(chatId, currentTags, anchorRect);
  }

  return (
    <SessionContextMenu
      pinned={custom.pinned}
      onPin={handlePin}
      onUnpin={handleUnpin}
      onRename={() => {
        queueMicrotask(() => setIsRenaming(true));
      }}
      onTags={() => {
        const p = contextMenuPoint.current;
        handleTags(p ? new DOMRect(p.x, p.y, 0, 0) : null);
      }}
      onArchive={() => void itemRuntime.archive()}
      claudeSessionId={custom.claudeSessionId}
    >
      <ThreadListItemPrimitive.Root
        data-testid="sessions-row"
        data-chat-id={item.id}
        className="group relative border-l-2 border-l-transparent transition-colors hover:bg-accent data-[active=true]:border-l-primary data-[active=true]:bg-accent"
      >
        {/* Whole-row select target: the entire row body is the trigger, so a click
            anywhere (title, status dot, meta row, empty space) changes the active
            session. Interactive children (PR links, hover actions, the rename
            input) stopPropagation, so they keep their own behavior. */}
        <ThreadListItemPrimitive.Trigger asChild>
          <div
            onContextMenu={(e) => {
              contextMenuPoint.current = { x: e.clientX, y: e.clientY };
            }}
            className="flex w-full cursor-pointer items-center gap-[9px] pb-[9px] pl-2.5 pr-[12px] pt-[8px] text-left"
          >
            <div className="flex flex-shrink-0 items-center gap-[5px]">
              {custom.pinned && !inPinnedGroup && (
                <PinIcon data-testid="sessions-row-pin-glyph" className="size-[11px] flex-shrink-0 text-primary" />
              )}
              <StatusDot badge={badge} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex h-[22px] min-w-0 items-center gap-[9px]">
                {isRenaming ? (
                  <SessionRowRename
                    initialTitle={title}
                    onCommit={handleCommitRename}
                    onCancel={() => setIsRenaming(false)}
                  />
                ) : (
                  <TruncatedWithTooltip
                    data-testid="sessions-row-title"
                    text={title}
                    side="top"
                    className={[
                      'flex-1 text-body tracking-normal',
                      // Selected (native data-active) reads as semibold/foreground too, matching
                      // the artboard `sel || unread` rule — applied via CSS so it tracks the
                      // native selection without a JS hook.
                      'group-data-[active=true]:font-semibold group-data-[active=true]:text-foreground',
                      isUnread || custom.pinned ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                    ].join(' ')}
                  />
                )}
                <RelativeTime updatedAt={custom.updatedAt} />
                <RowHoverActions
                  onTags={(rect) => handleTags(rect)}
                  onRename={() => queueMicrotask(() => setIsRenaming(true))}
                  onArchive={() => void itemRuntime.archive()}
                />
              </div>
              <div className="mt-[4px] @max-[220px]:hidden">
                <SessionRowMeta
                  worktreePath={custom.worktreePath}
                  worktreeMissing={custom.worktreeMissing}
                  detectedPrs={custom.detectedPrs}
                  tags={custom.tags}
                  colorOf={colorOf}
                  projectId={projectName != null ? custom.projectId : undefined}
                  projectName={projectName}
                />
              </div>
            </div>
          </div>
        </ThreadListItemPrimitive.Trigger>
      </ThreadListItemPrimitive.Root>
    </SessionContextMenu>
  );
}

/**
 * Guard: check whether the thread item exists in the store BEFORE calling
 * getItemById. getItemById constructs a ShallowMemoizeSubject that throws
 * synchronously ("Entry not available in the store") when the item is absent —
 * reachable during optimistic archive/delete removal or a cross-window reload
 * race. We read getState().threadItems (a plain Record) first; only if the id
 * is present do we call getItemById to get the live runtime binding.
 */
function SessionRowResolver({
  item,
  colorOf = DEFAULT_COLOR_OF,
  inPinnedGroup = false,
  projectName,
}: {
  item: SessionItem;
  colorOf?: (name: string) => TagColor;
  /** True when this row sits inside the 'Pinned' group — suppresses the pin glyph. */
  inPinnedGroup?: boolean;
  /** Project chip label — passed only in "All" view (no active project filter). */
  projectName?: string;
}) {
  const threadListRuntime = useAssistantRuntime().threads;
  const threadItems = threadListRuntime?.getState().threadItems;
  if (threadItems == null || !(item.id in threadItems)) return null;

  const itemRuntime = threadListRuntime.getItemById(item.id);
  return (
    <ThreadListItemRuntimeProvider runtime={itemRuntime}>
      <SessionRowInner item={item} colorOf={colorOf} inPinnedGroup={inPinnedGroup} projectName={projectName} />
    </ThreadListItemRuntimeProvider>
  );
}

// Memoized: on a filter-pill switch the surviving rows receive referentially
// stable props (item objects come from the threadItems-memoized allItems, colorOf
// is a useCallback, projectName is a string), so memo short-circuits their
// re-render — only the rows entering/leaving the filtered set mount/unmount.
export const SessionRow = memo(SessionRowResolver);
