'use client';

/**
 * The session's ongoing work, above the card (K4, K5). Every item is a row;
 * a chevron folds them to one, and the choice is remembered. While a request
 * shows above the composer the strip steps back to one line and leaves out
 * the item being answered (K10).
 */
import { useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { Activity, Binoculars, Bot, ChevronDown, Loader2, Route, SquareTerminal, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import { cancelDelegatedTask, stopBackgroundTask } from '@/lib/api/background-tasks';
import { jumpToActivitySource } from '@/features/session-panel/activity-source';
import { formatElapsed } from '@/features/session-panel/background-activity-view';
import type { ActivityEntry, ActivityKind } from '@/features/session-panel/activity-model';
import { useActivityEntries } from '@/features/session-panel/use-activity-entries';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { useUiPrefs } from '@/store/ui-prefs';
import { useGateQueue } from '../../gates/use-gate-queue';
import { openInSplit } from '../../zones/open-in-split';
import { ComposerHint } from '../composer-card-context';
import { TASK_STOP_ADAPTER, isOpenTask } from '../send/use-stop';
import { stripItems, stripSummary, type StripItem } from './activity-strip-model';
import { TOP_STRIP } from './strip-chrome';

/** The session panel's kind icons; a delegated task is the robot, filled. */
const ICONS: Record<ActivityKind, LucideIcon> = {
  workflow: Route,
  subagent: Bot,
  delegated: Bot,
  monitor: Binoculars,
  scheduled: Activity,
  command: SquareTerminal,
  background: Activity,
};

const ROW = 'flex min-h-7 min-w-0 items-center gap-2 rounded-lg pr-0.5 pl-2 text-[0.78125rem]';
const TOGGLE = 'size-6 shrink-0 text-muted-foreground';

function Spinner() {
  return <Loader2 className="size-3 shrink-0 animate-spin text-focus motion-reduce:animate-none" aria-hidden />;
}

/** Open what an item is doing: a delegated task's chat, else its place in the transcript. */
function useOpen(chatId: string) {
  const aui = useAui();
  const parentThreadId = useSideAwareThreadId();
  return (entry: ActivityEntry) => {
    const childId = entry.delegated?.itemId;
    if (childId && parentThreadId) {
      openInSplit(parentThreadId, childId);
      aui.threads.switchToThread(childId);
      return;
    }
    if (!entry.source) return;
    void jumpToActivitySource(chatId, entry.source).then((found) => {
      if (!found) mfToast.warning(`“${entry.title}” is not in this transcript`);
    });
  };
}

/** Stop is immediate (K4), as the composer's own is. Null when this item can't be stopped on its own. */
function stopAction(chatId: string, adapterId: string | undefined, entry: ActivityEntry): (() => Promise<void>) | null {
  const { task, delegated } = entry;
  if (delegated) return isOpenTask(delegated) ? () => cancelDelegatedTask(chatId, delegated.taskId) : null;
  return task && adapterId === TASK_STOP_ADAPTER ? () => stopBackgroundTask(chatId, task.id) : null;
}

function StopAction({ title, stop }: { title: string; stop: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    stop().then(
      () => mfToast.success(`Stopped “${title}”`),
      (error: unknown) => {
        setBusy(false);
        mfToast.error(`Could not stop “${title}”`, {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      data-testid="composer-activity-stop"
      aria-label={`Stop ${title}`}
      disabled={busy}
      onClick={run}
      className="h-6 shrink-0 text-foreground/80"
    >
      Stop
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
  const stop = stopAction(chatId, adapterId, entry);
  const Icon = ICONS[entry.kind];
  return (
    <div
      role="listitem"
      data-testid={`composer-activity-${entry.id}`}
      data-needs-you={needsYou || undefined}
      className={ROW}
    >
      <Icon
        aria-hidden
        className={cn(
          'size-3.5 shrink-0',
          needsYou ? 'text-warning' : 'text-focus',
          entry.kind === 'delegated' && 'fill-current/25',
        )}
      />
      <span className="min-w-0 flex-1 truncate" title={entry.title}>
        {entry.title}
      </span>
      {needsYou ? (
        <span className="shrink-0 font-medium text-warning">needs you</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums">
          {!queued && <Spinner />}
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
          className="h-6 shrink-0 text-accent-ink hover:text-accent-ink"
        >
          Open
        </Button>
      ) : (
        stop && <StopAction title={entry.title} stop={stop} />
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
        <ChevronDown className={cn('size-3.5', !open && 'rotate-180')} />
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
          <Spinner />
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
        {folded && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">+{hidden}</span>}
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
