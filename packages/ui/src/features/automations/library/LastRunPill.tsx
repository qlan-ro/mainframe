/**
 * Run-status vocabulary — label + dot color per `AutomationRunStatus`, one
 * source of truth shared by `details/RunsColumn`, `details/AutomationDetails`'s
 * header suffix, and `run/RunTrace`. Originally lived on a `LastRunPill`
 * component here (the old `LibraryRow`'s last-run indicator); that component
 * is retired with the library in the 2026-10 redesign — only the vocabulary
 * survives, since every remaining caller draws its own status glyph.
 */
import type { AutomationRunStatus } from '../contract';

export const RUN_STATUS_LABEL: Record<AutomationRunStatus, string> = {
  running: 'Running',
  waiting: 'Waiting',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const RUN_STATUS_DOT_CLASS: Record<AutomationRunStatus, string> = {
  running: 'bg-primary',
  waiting: 'bg-warning',
  succeeded: 'bg-success',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground',
};
