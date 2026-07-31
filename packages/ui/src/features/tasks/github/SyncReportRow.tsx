/**
 * SyncReportRow — one overwrite in the sync report.
 *
 * Collapsed: issue number, field family, task title, winner chip. Expanded: the
 * rule line, the "Now" line, and the replaced value verbatim in an amber block
 * with a copy button — the replaced value exists nowhere else, so handing it
 * back copyable is the reason the report exists.
 *
 * Every string comes from `sync-format.ts` (AC21), and a state value renders
 * through `statusLabel` so the raw `in_progress` key never reaches the DOM
 * (AC33). The row itself is the click target (`role="button"`), so the copy
 * button stops the event rather than collapsing the row under the user.
 */
import { useCallback, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import type { ReportRow } from '@/lib/api/todos-github';
import type { TodoStatus } from '@/lib/api/todos';
import { fieldLabel, nowLine, ruleLine, statusLabel, winnerLabel } from './sync-format';

const isTodoStatus = (value: string): value is TodoStatus =>
  value === 'open' || value === 'in_progress' || value === 'done';

/** A state row carries a raw status key on the wire; every other field is already prose. */
const fieldValue = (row: ReportRow, value: string): string =>
  row.field === 'state' && isTodoStatus(value) ? statusLabel(value) : value;

export function SyncReportRow({ row }: { row: ReportRow }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const replaced = fieldValue(row, row.replacedValue);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(replaced);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        /* expected — the clipboard is unavailable in some webview contexts */
        console.warn('[SyncReportRow] clipboard write failed', err);
      }
    },
    [replaced],
  );

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div
      data-testid={`tasks-github-report-row-${row.id}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded((open) => !open)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((open) => !open);
        }
      }}
      className="cursor-pointer border-b border-border px-3 py-2 transition-colors last:border-b-0 hover:bg-accent"
    >
      <div className="flex items-center gap-2">
        <Chevron size={12} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-mono text-label text-muted-foreground">#{row.issueNumber}</span>
        <span className="shrink-0 text-label font-semibold text-foreground">{fieldLabel(row.field)}</span>
        <TruncatedWithTooltip text={row.todoTitle} className="min-w-0 flex-1 text-body text-muted-foreground" />
        <span className="shrink-0 rounded-full bg-muted px-[8px] py-0.5 text-caption font-semibold text-muted-foreground">
          {winnerLabel(row.winner)}
        </span>
      </div>

      {expanded ? (
        <div className="mt-2 flex flex-col items-start gap-1.5 pl-[22px]">
          <p className="text-caption text-muted-foreground">{ruleLine(row)}</p>
          <p className="max-w-full text-caption text-foreground">
            <span className="font-semibold text-muted-foreground">Now</span>{' '}
            {fieldValue(row, nowLine(row, row.todoNumber))}
          </p>
          <div
            className={cn(
              'max-h-[132px] w-fit max-w-full overflow-y-auto whitespace-pre-wrap break-words',
              'rounded-md border-[0.5px] border-mf-warning/30 bg-mf-warning/10 px-[11px] py-[8px]',
              'font-mono text-caption leading-relaxed text-foreground',
            )}
          >
            {replaced}
          </div>
          <button
            type="button"
            data-testid={`tasks-github-report-copy-${row.id}`}
            onClick={(e) => void handleCopy(e)}
            className="inline-flex h-[24px] shrink-0 items-center gap-1.5 rounded-[6px] px-[8px] text-caption font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
            Copy replaced {fieldLabel(row.field).toLowerCase()}
          </button>
        </div>
      ) : null}
    </div>
  );
}
