/**
 * Workflow status visual primitives — pips, tags, and kind chips.
 *
 * Ported from the design prototype's WfStatusPip / WfStatusTag / WfKindChip,
 * with all inline styles replaced by Tailwind classes + real theme tokens.
 */
import React from 'react';
import { Check, X, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStepStatusMeta, getRunStatusMeta, getKindMeta } from './glyphs';

// ── WfStatusPip ───────────────────────────────────────────────────────────────

interface WfStatusPipProps {
  status: string;
  /** Size in pixels applied via Tailwind fixed-size classes; defaults to 16. */
  size?: 14 | 16;
}

/**
 * Timeline glyph representing a step or run status.
 *
 * - running   → spinning ring (animate-spin, borderTopColor transparent)
 * - waiting   → pulsing dot (animate-pulse inner + faded outer ring)
 * - succeeded → filled disc with Check icon
 * - failed    → filled disc with X icon
 * - ambiguous → TriangleAlert icon (color: warning)
 * - skipped   → dashed ring (border-dashed)
 */
export function WfStatusPip({ status, size = 16 }: WfStatusPipProps): React.ReactElement {
  // Integer w-4/h-4 render compressed (8px) under the theme's spacing override;
  // use an arbitrary px for the 16px pip. w-3.5 (14px, fractional) is standard.
  const sizeClass = size === 14 ? 'w-3.5 h-3.5' : 'w-[16px] h-[16px]';

  if (status === 'running') {
    return (
      <span
        className={cn(
          sizeClass,
          'shrink-0 rounded-full border-2 border-primary animate-spin',
          '[border-top-color:transparent]',
        )}
        aria-hidden
      />
    );
  }

  if (status === 'succeeded') {
    return (
      <span
        className={cn(sizeClass, 'shrink-0 rounded-full bg-mf-success inline-flex items-center justify-center')}
        aria-hidden
      >
        <Check size={size === 14 ? 9 : 10} className="text-white" strokeWidth={2.4} />
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        className={cn(sizeClass, 'shrink-0 rounded-full bg-destructive inline-flex items-center justify-center')}
        aria-hidden
      >
        <X size={size === 14 ? 8 : 9} className="text-white" strokeWidth={2.4} />
      </span>
    );
  }

  if (status === 'ambiguous') {
    return (
      <span className={cn(sizeClass, 'shrink-0 inline-flex items-center justify-center')} aria-hidden>
        <TriangleAlert size={size} className="text-mf-warning" strokeWidth={1.7} />
      </span>
    );
  }

  if (status === 'waiting') {
    // Prototype: an expanding-ring halo (animate-ping) behind a solid inner dot
    // ringed by a faint warning glow. The halo pings; the inner dot is static.
    return (
      <span className={cn(sizeClass, 'shrink-0 relative inline-flex items-center justify-center')} aria-hidden>
        <span className={cn('absolute rounded-full bg-mf-warning opacity-75 animate-ping', sizeClass)} />
        <span
          className={cn(
            'relative rounded-full bg-mf-warning shadow-[0_0_0_2px] shadow-mf-warning/20',
            size === 14 ? 'w-[9px] h-[9px]' : 'w-[10px] h-[10px]',
          )}
        />
      </span>
    );
  }

  // skipped / default — dashed ring
  return (
    <span
      className={cn(sizeClass, 'shrink-0 rounded-full border-dashed border-[1.6px] border-mf-text-4 box-border')}
      aria-hidden
    />
  );
}

// ── WfStatusTag ───────────────────────────────────────────────────────────────

interface WfStatusTagProps {
  status: string;
  /** 'step' uses step status vocabulary ("Done" for succeeded); 'run' uses run vocabulary ("Succeeded"). */
  kind: 'run' | 'step';
}

/**
 * Compact pill badge showing the status label in the status color.
 * Running → small spinning dot; Waiting → pulsing dot; others → label only.
 */
export function WfStatusTag({ status, kind }: WfStatusTagProps): React.ReactElement {
  const meta = kind === 'run' ? getRunStatusMeta(status) : getStepStatusMeta(status);
  const isMuted = status === 'cancelled' || status === 'skipped';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] h-[19px] px-[8px] rounded-full',
        'text-micro font-bold uppercase tracking-wide whitespace-nowrap',
        // Low-opacity background tint derived from the color token (prototype ~0.13)
        isMuted ? 'bg-muted' : 'bg-current/[0.13]',
        meta.colorClass,
      )}
    >
      {status === 'running' && (
        // Hollow spinning ring (prototype), not a filled Loader2 icon.
        <span
          className="w-1.5 h-1.5 rounded-full border-[1.4px] border-current [border-top-color:transparent] animate-spin shrink-0"
          aria-hidden
        />
      )}
      {status === 'waiting' && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" aria-hidden />
      )}
      {meta.label}
    </span>
  );
}

// ── WfKindChip ────────────────────────────────────────────────────────────────

interface WfKindChipProps {
  kind: string;
}

/**
 * Small icon square representing a workflow step kind.
 * Uses a low-opacity background tint of the kind's color.
 */
export function WfKindChip({ kind }: WfKindChipProps): React.ReactElement {
  const meta = getKindMeta(kind);
  const { Icon, label, colorClass } = meta;

  return (
    <span
      title={label}
      className={cn(
        'inline-flex items-center justify-center w-[22px] h-[22px] rounded-sm shrink-0',
        'bg-current/[0.12]',
        colorClass,
      )}
    >
      <Icon size={13} className={colorClass} aria-hidden />
    </span>
  );
}
