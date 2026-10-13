import { useEffect, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { ChevronDown } from 'lucide-react';
import type { ActivityEntry } from './activity-model';
import { ActivityRow } from './ActivityRow';
import { jumpToActivitySource } from './activity-source';
import { useActivityEntries } from './use-activity-entries';
import { PanelEyebrow } from './PanelEyebrow';
import { useWorkflowRun } from '@/features/chat/workflow/use-workflow-run';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { openInSplit } from '@/features/chat/zones/open-in-split';

const active = (row: ActivityEntry) => row.state === 'running' || row.state === 'waiting';
type HistoryView = 'closed' | 'preview' | 'all';

function Entry({
  row,
  chatId,
  adapterId,
  now,
}: {
  row: ActivityEntry;
  chatId: string;
  adapterId?: string;
  now: number;
}) {
  const aui = useAui();
  const parentThreadId = useSideAwareThreadId();
  const run = useWorkflowRun(row.kind === 'workflow' ? row.task?.id : undefined);
  const childId = row.delegated?.itemId;
  const openChild =
    childId && parentThreadId
      ? () => {
          openInSplit(parentThreadId, childId);
          aui.threads.switchToThread(childId);
        }
      : undefined;
  return (
    <ActivityRow
      row={row}
      chatId={chatId}
      adapterId={adapterId}
      now={now}
      run={run}
      onJump={() => {
        if (row.source) jumpToActivitySource(chatId, row.source);
      }}
      onOpenChild={openChild}
    />
  );
}

function HistoryRows({
  history,
  chatId,
  adapterId,
  now,
  view,
  onToggle,
  onShowAll,
}: {
  history: ActivityEntry[];
  chatId?: string;
  adapterId?: string;
  now: number;
  view: HistoryView;
  onToggle: () => void;
  onShowAll: () => void;
}) {
  if (!history.length) return null;
  const visible = view === 'all' ? history : history.slice(0, 6);
  return (
    <>
      <button
        type="button"
        aria-label={`Earlier, ${history.length} ${history.length === 1 ? 'item' : 'items'}`}
        aria-expanded={view !== 'closed'}
        onClick={onToggle}
        className="flex items-center gap-1 px-2 pt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Earlier
        <span className="ml-auto tabular-nums">{history.length}</span>
        <ChevronDown className={view === 'closed' ? 'size-3 -rotate-90' : 'size-3'} aria-hidden />
      </button>
      {view !== 'closed' &&
        visible.map((row) => <Entry key={row.id} row={row} chatId={chatId ?? ''} adapterId={adapterId} now={now} />)}
      {history.length > 6 && view === 'preview' && (
        <button type="button" onClick={onShowAll} className="self-start px-2 py-1 text-xs text-primary hover:underline">
          Show all {history.length}
        </button>
      )}
    </>
  );
}

interface ActivityBodyProps {
  running: ActivityEntry[];
  waiting: ActivityEntry[];
  history: ActivityEntry[];
  chatId?: string;
  adapterId?: string;
  now: number;
  historyView: HistoryView;
  onToggleHistory: () => void;
  onShowAll: () => void;
  loadError: string | null;
}

function ActivityBody({
  running,
  waiting,
  history,
  chatId,
  adapterId,
  now,
  historyView,
  onToggleHistory,
  onShowAll,
  loadError,
}: ActivityBodyProps) {
  return (
    <div className="flex flex-col gap-0.5 px-2 pb-2">
      {running.length === 0 && waiting.length === 0 && history.length === 0 && (
        <p data-testid="session-panel-activity-empty" className="px-2 py-1 text-sm text-muted-foreground">
          Nothing running
        </p>
      )}
      {running.map((row) => (
        <Entry key={row.id} row={row} chatId={chatId ?? ''} adapterId={adapterId} now={now} />
      ))}
      {waiting.length > 0 && <p className="px-2 pt-1 text-xs text-muted-foreground">Waiting</p>}
      {waiting.map((row) => (
        <Entry key={row.id} row={row} chatId={chatId ?? ''} adapterId={adapterId} now={now} />
      ))}
      <HistoryRows
        history={history}
        chatId={chatId}
        adapterId={adapterId}
        now={now}
        view={historyView}
        onToggle={onToggleHistory}
        onShowAll={onShowAll}
      />
      {loadError && (
        <p role="alert" className="px-2 text-xs text-destructive">
          Could not load earlier tasks: {loadError}
        </p>
      )}
    </div>
  );
}

export function ActivitySection() {
  const { entries, chatId, adapterId, loadError, now } = useActivityEntries();
  const [historyView, setHistoryView] = useState<HistoryView>('closed');
  useEffect(() => setHistoryView('closed'), [chatId]);
  const running = entries.filter((row) => row.state === 'running');
  const waiting = entries.filter((row) => row.state === 'waiting');
  const history = entries
    .filter((row) => !active(row))
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  const summary =
    running.length || waiting.length
      ? `${running.length} running${waiting.length ? ` · ${waiting.length} waiting` : ''}`
      : 'Nothing running';
  return (
    <section data-testid="session-panel-card-activity" className="shrink-0">
      <PanelEyebrow
        label="Activity"
        live={running.length > 0}
        liveTestId="session-panel-activity-live"
        action={
          <span data-testid="session-panel-activity-counts" className="text-xs text-muted-foreground">
            {summary}
          </span>
        }
      />
      <ActivityBody
        running={running}
        waiting={waiting}
        history={history}
        chatId={chatId}
        adapterId={adapterId}
        now={now}
        historyView={historyView}
        onToggleHistory={() => setHistoryView(historyView === 'closed' ? 'preview' : 'closed')}
        onShowAll={() => setHistoryView('all')}
        loadError={loadError}
      />
    </section>
  );
}
