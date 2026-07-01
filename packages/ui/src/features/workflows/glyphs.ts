/**
 * Workflow glyph helpers — icon + color class lookups for step kinds and statuses.
 *
 * All colors use real Tailwind theme tokens (no inline styles, no hex).
 * Consumers combine `colorClass` with `text-*`/`bg-*` as appropriate.
 */
import {
  Sparkles,
  Plug,
  MessageSquare,
  CircleDot,
  GitBranch,
  RotateCw,
  Columns3,
  Layers,
  type LucideIcon,
} from 'lucide-react';

// ── Kind metadata ──────────────────────────────────────────────────────────────

export interface KindMeta {
  Icon: LucideIcon;
  label: string;
  colorClass: string;
}

/**
 * Maps a workflow step kind to its icon, label, and a Tailwind text color class.
 * Prototype `WF_KIND` entries map to the icon table in the plan's Token Map.
 *
 * The prototype uses ad-hoc hex colors; we map to the nearest semantic token
 * or an approximate Tailwind named color. All tokens confirmed present in the
 * theme CSS or standard Tailwind palette.
 */
export const KIND_META: Record<string, KindMeta> = {
  agent: {
    Icon: Sparkles,
    label: 'Agent',
    colorClass: 'text-primary',
  },
  // prototype "service" key mapped from the connector kind name
  connector: {
    Icon: Plug,
    label: 'Service',
    colorClass: 'text-purple-600',
  },
  question: {
    Icon: MessageSquare,
    label: 'Question',
    colorClass: 'text-orange-700',
  },
  set: {
    Icon: CircleDot,
    label: 'Value',
    colorClass: 'text-mf-text-3',
  },
  choose: {
    Icon: GitBranch,
    label: 'Branch',
    colorClass: 'text-violet-700',
  },
  foreach: {
    Icon: RotateCw,
    label: 'Loop',
    colorClass: 'text-emerald-700',
  },
  parallel: {
    Icon: Columns3,
    label: 'Parallel',
    colorClass: 'text-orange-600',
  },
  call: {
    Icon: Layers,
    label: 'Sub-workflow',
    colorClass: 'text-blue-600',
  },
};

// Fallback for unknown kinds
export const DEFAULT_KIND_META: KindMeta = {
  Icon: CircleDot,
  label: 'Value',
  colorClass: 'text-mf-text-3',
};

export function getKindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? DEFAULT_KIND_META;
}

// ── Status metadata ────────────────────────────────────────────────────────────

export interface StatusMeta {
  label: string;
  colorClass: string;
  /** Semantic tone for tint/ring use by consumers. */
  tone: 'primary' | 'warning' | 'success' | 'destructive' | 'muted';
}

/**
 * Step statuses — "succeeded" maps to "Done" per the prototype `WF_STEP_STATUS`.
 * "ambiguous" maps to "Uncertain" (distinct from failed — the run crashed mid-step).
 */
export const stepStatusMeta: Record<string, StatusMeta> = {
  running: {
    label: 'Running',
    colorClass: 'text-primary',
    tone: 'primary',
  },
  waiting: {
    label: 'Waiting',
    colorClass: 'text-mf-warning',
    tone: 'warning',
  },
  succeeded: {
    label: 'Done',
    colorClass: 'text-mf-success',
    tone: 'success',
  },
  failed: {
    label: 'Failed',
    colorClass: 'text-destructive',
    tone: 'destructive',
  },
  skipped: {
    label: 'Skipped',
    colorClass: 'text-mf-text-4',
    tone: 'muted',
  },
  ambiguous: {
    label: 'Uncertain',
    colorClass: 'text-mf-warning',
    tone: 'warning',
  },
};

/**
 * Run-level statuses — "succeeded" keeps its full label here (not "Done").
 * "cancelled" is a run-only status (steps use "skipped" as the closest match).
 */
export const runStatusMeta: Record<string, StatusMeta> = {
  running: {
    label: 'Running',
    colorClass: 'text-primary',
    tone: 'primary',
  },
  waiting: {
    label: 'Waiting',
    colorClass: 'text-mf-warning',
    tone: 'warning',
  },
  succeeded: {
    label: 'Succeeded',
    colorClass: 'text-mf-success',
    tone: 'success',
  },
  failed: {
    label: 'Failed',
    colorClass: 'text-destructive',
    tone: 'destructive',
  },
  cancelled: {
    label: 'Cancelled',
    colorClass: 'text-mf-text-3',
    tone: 'muted',
  },
};

const DEFAULT_STEP_META: StatusMeta = {
  label: 'Skipped',
  colorClass: 'text-mf-text-4',
  tone: 'muted',
};

const DEFAULT_RUN_META: StatusMeta = {
  label: 'Cancelled',
  colorClass: 'text-mf-text-3',
  tone: 'muted',
};

export function getStepStatusMeta(status: string): StatusMeta {
  return stepStatusMeta[status] ?? DEFAULT_STEP_META;
}

export function getRunStatusMeta(status: string): StatusMeta {
  return runStatusMeta[status] ?? DEFAULT_RUN_META;
}

// ── Time helper ────────────────────────────────────────────────────────────────

/**
 * Formats a Unix timestamp (ms) as a human-readable relative time string.
 * Used by run list rows and the run detail header.
 */
export function formatAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.floor(diffMo / 12)}y ago`;
}
