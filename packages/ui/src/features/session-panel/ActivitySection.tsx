/**
 * ActivitySection — everything the session is running or has run: ongoing work
 * first (needs-you, running, queued, scheduled), finished work under Earlier.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { useWorkflowRun } from '@/features/chat/workflow/use-workflow-run';
import { cn } from '@/lib/utils';
import type { BackgroundTaskOutput } from '@/lib/api/background-tasks';
import { isOngoing, type ActivityEntry } from './activity-model';
import { groupActivity } from './activity-status';
import { ActivityRow } from './ActivityRow';
import { CommandOutputDialog } from './CommandOutputDialog';
import { PanelEmpty, PanelRow, PanelSection } from './PanelSection';
import { usePanelControl, type PanelColumnId } from './panel-control-store';
import { useActivityActions } from './use-activity-actions';
import { useActivityEntries } from './use-activity-entries';
import { useActivityJump, type ActivityJumps } from './use-activity-jump';
import { useFocusLoss, useRowFocus } from './use-row-focus';

interface EntryScope {
  chatId: string;
  adapterId?: string;
  columnId: PanelColumnId;
  now: number;
  jumps: ActivityJumps;
  showOutput: (row: ActivityEntry, read: () => Promise<BackgroundTaskOutput>) => void;
  /** A row, or Earlier itself (''), is going away with the focus in it. */
  onFocusLost: (id: string) => void;
}

function Entry({ row, scope }: { row: ActivityEntry; scope: EntryScope }) {
  const run = useWorkflowRun(row.kind === 'workflow' ? row.task?.id : undefined);
  const { readOutput, ...actions } = useActivityActions(row, scope);
  return (
    <ActivityRow
      row={row}
      now={scope.now}
      run={run}
      onOutput={readOutput && (() => scope.showOutput(row, readOutput))}
      loading={scope.jumps.loadingId === row.id}
      onFocusLost={scope.onFocusLost}
      {...actions}
    />
  );
}

/** The rest of the history isn't loaded, so neither is what it started. */
function LoadEarlierRow() {
  const extras = useChatExtras();
  const history = extras?.state.historyWindow;
  if (!history?.hasMore) return null;
  return (
    <>
      <PanelRow
        data-testid="session-panel-load-earlier"
        disabled={history.loading}
        onClick={() => {
          void extras?.loadEarlier?.().catch(() => undefined /* shown from historyWindow.error */);
        }}
        label="Load earlier messages"
        labelClassName="text-muted-foreground"
      />
      {history.error && (
        <p role="alert" className="px-4 text-xs text-fail">
          {history.error}
        </p>
      )}
    </>
  );
}

interface EarlierProps {
  earlier: ActivityEntry[];
  failed: number;
  hasMore: boolean;
  scope: EntryScope;
}

function earlierLabel(count: number, failed: number, hasMore: boolean): string {
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  return ['Earlier', hasMore ? `${items} or more` : items, failed > 0 && `${failed} failed`].filter(Boolean).join(', ');
}

function EarlierHeader({
  earlier,
  failed,
  hasMore,
  scope,
  open,
  onToggle,
}: EarlierProps & { open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusLoss(ref, () => scope.onFocusLost(''));
  return (
    <PanelRow
      ref={ref}
      data-testid="session-panel-activity-earlier"
      data-activity-earlier
      aria-label={earlierLabel(earlier.length, failed, hasMore)}
      aria-expanded={open}
      onClick={onToggle}
      icon={
        <ChevronRight
          className={cn('size-3.5! transition-transform motion-reduce:transition-none', open && 'rotate-90')}
        />
      }
      label="Earlier"
      value={
        <>
          {failed > 0 && <span className="text-fail">{failed} failed</span>}
          {failed > 0 && <span>·</span>}
          <span>
            {earlier.length}
            {hasMore && '+'}
          </span>
        </>
      }
    />
  );
}

function Earlier({ earlier, failed, hasMore, scope }: EarlierProps) {
  const [openIn, setOpenIn] = useState<string>();
  if (earlier.length === 0 && !hasMore) return null;
  const open = openIn === scope.chatId;
  return (
    <>
      <EarlierHeader
        earlier={earlier}
        failed={failed}
        hasMore={hasMore}
        scope={scope}
        open={open}
        onToggle={() => setOpenIn(open ? undefined : scope.chatId)}
      />
      {open && (
        <>
          {earlier.map((row) => (
            <Entry key={row.id} row={row} scope={scope} />
          ))}
          <LoadEarlierRow />
        </>
      )}
    </>
  );
}

/** Scrolls the section into view each time the column's footer asks to reveal Activity. */
function useActivityReveal(columnId: PanelColumnId) {
  const ref = useRef<HTMLElement>(null);
  const reveals = usePanelControl((s) => s.activityReveals[columnId] ?? 0);
  useEffect(() => {
    if (reveals) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [reveals]);
  return ref;
}

interface ShownOutput {
  chatId: string;
  row: ActivityEntry;
  read: () => Promise<BackgroundTaskOutput>;
}

/** The section holds the open output, not its row: the row moves to Earlier when its command ends. */
function useShownOutput(chatId: string, entries: readonly ActivityEntry[]) {
  const [shown, setShown] = useState<ShownOutput>();
  const [open, setOpen] = useState(false);
  const row = shown && (entries.find((entry) => entry.id === shown.row.id) ?? shown.row);
  return {
    show: (from: ActivityEntry, read: ShownOutput['read']) => {
      setShown({ chatId, row: from, read });
      setOpen(true);
    },
    output: shown && row && { row, read: shown.read, open: open && shown.chatId === chatId },
    setOpen,
  };
}

interface ShownOutputDialogProps {
  output: Pick<ShownOutput, 'row' | 'read'> & { open: boolean };
  onOpenChange: (open: boolean) => void;
  focusRow: (id: string) => void;
}

function ShownOutputDialog({ output, onOpenChange, focusRow }: ShownOutputDialogProps) {
  const { row, read, open } = output;
  return (
    <CommandOutputDialog
      title={row.title}
      command={row.command}
      read={read}
      running={isOngoing(row.state)}
      open={open}
      onOpenChange={onOpenChange}
      returnFocus={() => focusRow(row.id)}
    />
  );
}

export function ActivitySection({ columnId }: { columnId: PanelColumnId }) {
  const sectionRef = useActivityReveal(columnId);
  const hasMore = useChatExtras()?.state.historyWindow?.hasMore ?? false;
  const { entries, chatId = '', adapterId, loadError, now } = useActivityEntries();
  const { ongoing, earlier, failed } = groupActivity(entries);
  const jumps = useActivityJump(chatId, columnId);
  const { show, output, setOpen } = useShownOutput(chatId, entries);
  const { focusRow, onFocusLost } = useRowFocus(sectionRef, chatId, earlier);
  const scope: EntryScope = { chatId, adapterId, columnId, now, jumps, showOutput: show, onFocusLost };
  return (
    <PanelSection
      ref={sectionRef}
      section="activity"
      data-testid="session-panel-card-activity"
      // Clears the panel's sticky title.
      className="scroll-mt-11"
    >
      {ongoing.length === 0 && (
        <PanelEmpty data-testid="session-panel-activity-empty" icon={<Check />}>
          No background activity
        </PanelEmpty>
      )}
      {ongoing.map((row) => (
        <Entry key={row.id} row={row} scope={scope} />
      ))}
      <Earlier earlier={earlier} failed={failed} hasMore={hasMore} scope={scope} />
      {loadError && (
        <p role="alert" className="px-4 text-xs text-fail">
          Could not load earlier tasks: {loadError}
        </p>
      )}
      {output && <ShownOutputDialog output={output} onOpenChange={setOpen} focusRow={focusRow} />}
    </PanelSection>
  );
}
