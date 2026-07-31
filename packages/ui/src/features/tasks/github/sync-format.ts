/**
 * Pure formatting helpers for the GitHub sync surface.
 *
 * Every user-visible string in the report and the header control is assembled
 * here so the components hold no prose of their own (AC21) and no raw
 * snake_case status key ever reaches the DOM (AC33).
 *
 * `syncedAgo` is minute-granular on purpose — `TaskCard`'s `relativeTime` is
 * day-granular and answers a different question.
 */
import type { TodoStatus } from '@/lib/api/todos';
import type { ReportRow } from '@/lib/api/todos-github';

const STATUS_LABELS: Record<TodoStatus, 'Open' | 'In progress' | 'Done'> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
};

export function statusLabel(status: TodoStatus): 'Open' | 'In progress' | 'Done' {
  return STATUS_LABELS[status];
}

export function syncedAgo(iso: string | null): string {
  if (iso === null) return 'never synced';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'synced moments ago';
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `synced ${hours}h ago`;
  return `synced ${Math.floor(hours / 24)}d ago`;
}

/** Time of day for a report stamp — the report never shows a date, only the clock. */
function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

const RULE_PHRASES: Record<ReportRow['rule'], string> = {
  recency: 'more recent change won',
  tie: 'tie — remote wins',
  'in-progress-close': 'remote close applied to an in-progress todo',
};

/**
 * A row shows the timestamps its decision compared and no others: recency both,
 * a tie both (or the local stamp alone when the remote one was unresolvable),
 * an in-progress close none at all.
 */
function stampsClause(row: ReportRow): string {
  if (row.localAt === null) return '';
  const local = `Mainframe ${timeOfDay(row.localAt)}`;
  const remote = row.remoteAt === null ? 'GitHub timestamp unavailable' : `GitHub ${timeOfDay(row.remoteAt)}`;
  return ` — ${local}, ${remote}`;
}

export function ruleLine(row: ReportRow): string {
  const stamps = stampsClause(row);
  if (stamps === '') return RULE_PHRASES[row.rule];
  const coarse = row.remoteCoarse && row.remoteAt !== null ? ' (issue timestamp, to the minute)' : '';
  return `${RULE_PHRASES[row.rule]}${stamps}${coarse}`;
}

const FIELD_LABELS: Record<ReportRow['field'], 'Title' | 'Body' | 'State'> = {
  title: 'Title',
  body: 'Body',
  state: 'State',
};

export function fieldLabel(field: ReportRow['field']): 'Title' | 'Body' | 'State' {
  return FIELD_LABELS[field];
}

export function winnerLabel(winner: ReportRow['winner']): 'GitHub won' | 'Mainframe won' {
  return winner === 'github' ? 'GitHub won' : 'Mainframe won';
}

/** What the field holds today — the literal value, except a body, which is already on screen. */
export function nowLine(row: ReportRow, todoNumber: number): string {
  return row.field === 'body' ? `the body shown on task #${todoNumber}` : row.winningValue;
}
