/**
 * SyncReportDialog — what the last sync run overwrote, after the fact.
 *
 * Driven by the store's `dialog` (D5): mounted once by the board, open only
 * while `dialog.kind === 'report'`. The report is fetched by `openDialog`, so
 * `report` is null until it arrives.
 *
 * Flat rows, any number expanded at once. A run that resolved nothing shows
 * the same dialog with the "nothing was overwritten" state — the report is the
 * only place a replaced value survives, so it always answers the question.
 */
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Report } from '@/lib/api/todos-github';
import { useGitHubSyncStore } from './use-github-sync-store';
import { SyncReportRow } from './SyncReportRow';

/** The run's clock only — the report never shows a date. */
const timeOfDay = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

function headline(report: Report): string {
  const count = report.pairsReconciled;
  const pairs = `${count} ${count === 1 ? 'pair' : 'pairs'} reconciled at ${timeOfDay(report.finishedAt)}.`;
  const overwrites = report.rows.length;
  if (overwrites === 0) return pairs;
  return `${pairs} ${overwrites} ${overwrites === 1 ? 'field was' : 'fields were'} overwritten — the replaced values are below.`;
}

function ReportBody({ report }: { report: Report }) {
  return (
    <>
      {report.failure ? (
        <div className="flex items-start gap-2 rounded-md bg-mf-warning/10 px-[11px] py-[8px] text-caption leading-relaxed text-foreground">
          <AlertTriangle size={14} className="mt-px shrink-0 text-mf-warning" aria-hidden />
          <span>{report.failure.message}</span>
        </div>
      ) : null}

      {report.rows.length === 0 ? (
        <p className="py-10 text-center text-body text-muted-foreground">Nothing was overwritten in this run.</p>
      ) : (
        <div className="-mx-4 border-t border-border">
          {report.rows.map((row) => (
            <SyncReportRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}

export function SyncReportDialog() {
  const { dialog, report, closeDialog } = useGitHubSyncStore();
  const open = dialog?.kind === 'report';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent
        data-testid="tasks-github-report-dialog"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 p-0"
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-10">
          <DialogTitle className="text-heading font-bold">Last sync report</DialogTitle>
          <DialogDescription className="text-caption">
            {report ? headline(report) : 'Loading the report…'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
          {report ? <ReportBody report={report} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
