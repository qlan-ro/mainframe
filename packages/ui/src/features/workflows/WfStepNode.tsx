/**
 * WfStepNode — leaf step row with expandable I/O detail.
 *
 * Ported from the design prototype's WfStepNode + WfIO components,
 * translating inline styles to real Tailwind tokens per the Token Map.
 *
 * A leaf step node shows: kind chip, title (stepId or kind label),
 * retry badge when attempt > 1, optional duration, status tag.
 * Clicking the row toggles an expandable detail area containing:
 * - error box (amber for ambiguous, red for failed)
 * - input / output JSON blocks
 * - "Open agent chat" button for agent steps with a chatId
 */
import React, { useState } from 'react';
import { RotateCw, TriangleAlert, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WfKindChip, WfStatusTag } from './WfStatus';
import { getKindMeta } from './glyphs';
import type { RunTreeNode } from '@/lib/api/workflows';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasDetail(node: RunTreeNode): boolean {
  return (
    node.status === 'ambiguous' ||
    node.status === 'failed' ||
    node.input != null ||
    node.output != null ||
    node.chatId != null
  );
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ── WfIO ─────────────────────────────────────────────────────────────────────

interface WfIOProps {
  label: string;
  value: unknown;
  truncated?: boolean;
}

function WfIO({ label, value, truncated }: WfIOProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro font-bold uppercase tracking-wider text-mf-text-3">{label}</span>
      <pre className="overflow-x-auto rounded-md bg-mf-code-bg px-3 py-2 font-mono text-caption text-mf-code-fg">
        {formatJson(value)}
      </pre>
      {truncated && <span className="text-micro text-mf-text-4 italic">… truncated for display</span>}
    </div>
  );
}

// ── WfErrorBox ────────────────────────────────────────────────────────────────

interface WfErrorBoxProps {
  status: string;
  error: string | null;
}

function WfErrorBox({ status, error }: WfErrorBoxProps): React.ReactElement | null {
  if (status === 'ambiguous') {
    return (
      <div className={cn('flex items-start gap-2 rounded-md px-3 py-2', 'bg-mf-warning-tint text-mf-warning')}>
        <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
        <span className="text-caption">Outcome uncertain — the app crashed mid-step.</span>
      </div>
    );
  }

  if (status === 'failed' && error) {
    return (
      <div className={cn('flex items-start gap-2 rounded-md px-3 py-2', 'bg-mf-destructive-tint text-destructive')}>
        <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
        <span className="text-caption">{error}</span>
      </div>
    );
  }

  return null;
}

// ── WfStepNode ────────────────────────────────────────────────────────────────

export interface WfStepNodeProps {
  node: RunTreeNode;
  /** Called with chatId when the user clicks "Open agent chat". */
  onOpenChat: (chatId: string) => void;
}

export function WfStepNode({ node, onOpenChat }: WfStepNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const kindMeta = getKindMeta(node.kind);
  const title = node.stepId ?? kindMeta.label;
  const canExpand = hasDetail(node);
  const isAmbiguous = node.status === 'ambiguous';

  function handleRowClick(): void {
    if (canExpand) setExpanded((prev) => !prev);
  }

  return (
    <div className="flex flex-col">
      {/* ── Collapsed row ── */}
      <div
        data-testid={`workflows-step-${node.stepPath}`}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) handleRowClick();
        }}
        className={cn(
          'flex min-h-[38px] items-center gap-2 px-4 py-2 transition-colors',
          canExpand ? 'cursor-pointer hover:bg-accent' : 'cursor-default',
          isAmbiguous && 'ring-1 ring-inset ring-mf-warning',
        )}
      >
        {/* Kind chip */}
        <WfKindChip kind={node.kind} />

        {/* Title */}
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body text-foreground">
          {title}
        </span>

        {/* Retry badge */}
        {node.attempt > 1 && (
          <span
            data-testid={`workflows-step-${node.stepPath}-retry`}
            className="inline-flex shrink-0 items-center gap-[3px] rounded-full bg-muted px-[7px] py-px text-micro font-semibold text-mf-text-3"
          >
            <RotateCw size={9} aria-hidden />
            {node.attempt}
          </span>
        )}

        {/* Status tag */}
        <WfStatusTag status={node.status} kind="step" />
      </div>

      {/* ── Expanded detail ── */}
      {expanded && canExpand && (
        <div className="flex flex-col gap-3 border-t border-border bg-mf-content2 px-4 py-3">
          {/* Error / ambiguous box */}
          <WfErrorBox status={node.status} error={node.error} />

          {/* Input block */}
          {node.input != null && <WfIO label="Input" value={node.input} truncated={node.truncated} />}

          {/* Output block */}
          {node.output != null && <WfIO label="Output" value={node.output} truncated={node.truncated} />}

          {/* Agent chat button */}
          {node.chatId != null && (
            <button
              data-testid={`workflows-step-chat-${node.stepPath}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChat(node.chatId!);
              }}
              className={cn(
                'inline-flex w-fit items-center gap-1.5 rounded-md px-3 py-1.5',
                'text-label font-medium text-primary hover:bg-primary/10 transition-colors',
              )}
            >
              <ExternalLink size={12} aria-hidden />
              Open agent chat
            </button>
          )}
        </div>
      )}
    </div>
  );
}
