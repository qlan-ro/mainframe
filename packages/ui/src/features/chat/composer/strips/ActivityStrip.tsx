'use client';

/**
 * The session's ongoing work, above the card (K4, K5). Every item is a row;
 * a chevron folds them to one, and the choice is remembered. While a request
 * shows above the composer the strip steps back to one line and leaves out
 * the item being answered (K10).
 */
import { useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import { errorMessage } from '@/lib/error-message';
import { ACTIVITY_ICON } from '@/features/session-panel/ActivityRow';
import { ActivitySpinner } from '@/features/session-panel/ActivitySpinner';
import { cancelActivityJump, jumpToActivitySource } from '@/features/session-panel/activity-source';
import { formatElapsed } from '@/features/session-panel/background-activity-view';
import type { ActivityEntry } from '@/features/session-panel/activity-model';
import { stopKeyOf, stopRequest } from '@/features/session-panel/use-activity-actions';
import { useActivityEntries } from '@/features/session-panel/use-activity-entries';
import { useStop } from '@/features/session-panel/use-stop';
import { openSubagentTab } from '@/features/workspace-chat/conversation-tabs';
import { openTaskTab } from '@/features/workspace-chat/open-session';
import { useUiPrefs } from '@/store/ui-prefs';
import { useGateQueue } from '../../gates/use-gate-queue';
import { ComposerHint } from '../composer-card-context';
import { stripItems, stripSummary, type StripItem } from './activity-strip-model';
import { TOP_STRIP } from './strip-chrome';

const ROW = 'flex min-h-7 min-w-0 items-center gap-2 rounded-md pr-0.5 pl-2 text-small text-ink-secondary';
const TOGGLE =
  'size-6 shrink-0 rounded-sm text-muted-foreground hover:bg-sidebar-accent aria-expanded:bg-transparent aria-expanded:text-muted-foreground dark:hover:bg-sidebar-accent';
const ACTION = 'h-6 shrink-0 rounded-sm px-[7px] text-meta/[1.45] hover:bg-sidebar-accent';

/** Open what an item is doing: a task or sub-agent in the workspace (W8), else its place in the transcript. */
function useOpen(chatId: string) {
  const aui = useAui();
  return (entry: ActivityEntry) => {
    const childId = entry.delegated?.itemId;
    // A jump still on its way would move the transcript under what this opens.
    cancelActivityJump();
    if (childId) {
      openTaskTab(aui.threads, childId, { focus: true });
      return;
    }
    if (!entry.source) return;
    if (entry.kind === 'subagent' && entry.source.toolCallId) {
      const { toolCallId, messageId } = entry.source;
      openSubagentTab({ chatId, toolCallId, messageId, title: entry.title }, { focus: true });
      return;
    }
    jumpToActivitySource(chatId, entry.source).then(
      (outcome) => {
        if (outcome === 'missing') mfToast.info(`“${entry.title}” started before the history shown here`);
      },
      (error: unknown) => mfToast.error('Could not load the message', { description: errorMessage(error) }),
    );
  };
}

/** Stop is immediate (K4), as the composer's own is. Absent when this item can't be stopped on its own. */
function StopAction({ title, request, work }: { title: string; request: () => Promise<void>; work: string }) {
  const { onStop, stopping } = useStop(title, request, work);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      data-testid="composer-activity-stop"
      aria-label={stopping ? `Stopping ${title}` : `Stop ${title}`}
      // Not `disabled`, which would drop the focus it has.
      aria-disabled={stopping}
      onClick={onStop}
      className={cn(ACTION, 'text-ink-secondary aria-disabled:text-muted-foreground')}
    >
      {stopping ? 'Stopping' : 'Stop'}
    </Button>
  );
}

interface ItemRowProps {
  item: StripItem;
  chatId: string;
  adapterId?: string;
  now: number;
  /** The first row's trailing slot: the fold control, and how many rows it hides. */
  trailing?: React.ReactNode;
}

function ItemRow({ item, chatId, adapterId, now, trailing }: ItemRowProps) {
  const { entry, needsYou, queued } = item;
  const open = useOpen(chatId);
  const stop = stopRequest(entry, chatId, adapterId);
  const Icon = ACTIVITY_ICON[entry.kind];
  return (
    <div
      role="listitem"
      data-testid={`composer-activity-${entry.id}`}
      data-needs-you={needsYou || undefined}
      className={ROW}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-foreground" title={entry.title}>
        {entry.title}
      </span>
      {needsYou ? (
        <span className="shrink-0 font-medium text-warning">needs you</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums">
          {!queued && <ActivitySpinner />}
          {queued ? 'queued' : formatElapsed(entry.startedAt, now)}
        </span>
      )}
      {needsYou ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-testid="composer-activity-open"
          aria-label={`Open ${entry.title}`}
          onClick={() => open(entry)}
          className={cn(ACTION, 'text-accent-ink hover:text-foreground')}
        >
          Open
        </Button>
      ) : (
        stop && <StopAction title={entry.title} request={stop} work={stopKeyOf(entry, chatId)} />
      )}
      {trailing}
    </div>
  );
}

function FoldToggle({
  open,
  label,
  testId,
  onClick,
}: {
  open: boolean;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <ComposerHint label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        data-testid={testId}
        aria-expanded={open}
        aria-label={label}
        onClick={onClick}
        className={TOGGLE}
      >
        <ChevronDown className={cn('size-3', open && 'rotate-180')} />
      </Button>
    </ComposerHint>
  );
}

function SummaryRow({ items, onExpand }: { items: StripItem[]; onExpand: () => void }) {
  const { running, waiting } = stripSummary(items);
  const label = `Show ${items.length} ongoing item${items.length === 1 ? '' : 's'}`;
  return (
    <div role="listitem" data-testid="composer-activity-summary" className={cn(ROW, 'gap-1.5')}>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">Also ongoing</span>
      {running && (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums">
          <ActivitySpinner />
          {running}
        </span>
      )}
      {running && waiting && <span className="text-muted-foreground">·</span>}
      {waiting && <span className="shrink-0 font-medium text-warning">{waiting}</span>}
      <FoldToggle open={false} label={label} testId="composer-activity-gate-toggle" onClick={onExpand} />
    </div>
  );
}

export function ActivityStrip() {
  const { entries, chatId, adapterId, now } = useActivityEntries();
  const gates = useGateQueue();
  const collapsed = useUiPrefs((s) => s.activityStripCollapsed);
  const setCollapsed = useUiPrefs((s) => s.setActivityStripCollapsed);
  // The request whose strip the user unfolded: the next one starts folded again.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  const front = gates.front;
  const all = stripItems(entries, gates.waitingCalls).filter(
    ({ entry }) => front?.from == null || !front.from.matches(entry),
  );
  if (chatId == null || all.length === 0) return null;

  const rowProps = { chatId, adapterId, now };
  if (front != null && expandedFor !== front.entry.requestId) {
    return (
      <div className={TOP_STRIP} data-testid="composer-activity-strip">
        <div role="list" aria-label="Ongoing work" className="min-w-0 flex-1">
          <SummaryRow items={all} onExpand={() => setExpandedFor(front.entry.requestId)} />
        </div>
      </div>
    );
  }

  const folded = front == null && collapsed && all.length > 1;
  const shown = folded ? all.slice(0, 1) : all;
  const hidden = all.length - shown.length;
  const toggle =
    front != null ? (
      <FoldToggle
        open
        label="Collapse to one line"
        testId="composer-activity-gate-toggle"
        onClick={() => setExpandedFor(null)}
      />
    ) : all.length > 1 ? (
      <>
        {folded && <span className="shrink-0 text-meta/[1.45] text-muted-foreground tabular-nums">+{hidden}</span>}
        <FoldToggle
          open={!folded}
          label={folded ? `Show all ${all.length} ongoing items` : 'Collapse to one row'}
          testId="composer-activity-toggle"
          onClick={() => setCollapsed(!collapsed)}
        />
      </>
    ) : null;

  return (
    <div className={TOP_STRIP} data-testid="composer-activity-strip">
      {/* Six rows of height, then it scrolls (K4). */}
      <div role="list" aria-label="Ongoing work" className="max-h-42 min-w-0 flex-1 overflow-y-auto">
        {shown.map((item, index) => (
          <ItemRow
            key={item.entry.id}
            item={item}
            {...rowProps}
            trailing={index === 0 ? toggle : toggle && <span aria-hidden className="size-6 shrink-0" />}
          />
        ))}
      </div>
    </div>
  );
}
