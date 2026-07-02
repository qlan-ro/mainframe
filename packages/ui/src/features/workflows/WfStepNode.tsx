/**
 * WfStepNode — leaf step row on the rail timeline.
 *
 * Rebuilt to the design prototype's rail model (18-workflows.jsx WfStepNode):
 * an absolute status pip centered on the spine (left:6/top:11), a row indented
 * marginLeft:30 carrying the kind chip, title, retry badge, optional duration
 * and a secondary waitFor line (shown only while waiting), plus the status
 * tag. Clicking the row
 * toggles an inline, indented (ml:31) detail block (NOT a full-bleed card):
 * - error box (amber headline + error text for ambiguous; red for failed)
 * - input / output JSON blocks
 * - "Open agent chat" button for agent steps with a chatId
 *
 * Explicit prototype pixels (gap:9, padding:'8px 10px', marginLeft:30/31) use
 * arbitrary `[Npx]` classes — integer Tailwind steps render compressed here.
 */
import React, { useState } from 'react';
import { RotateCw, TriangleAlert, MessageSquare, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WfKindChip, WfStatusTag, WfStatusPip } from './WfStatus';
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
    <div className="flex flex-col gap-[4px]">
      <span className="text-micro font-bold uppercase tracking-wider text-mf-text-3">{label}</span>
      <pre className="overflow-x-auto rounded-md border border-border bg-mf-code-bg px-[10px] py-[8px] font-mono text-caption text-mf-code-fg leading-normal whitespace-pre-wrap break-words">
        {formatJson(value)}
      </pre>
      {truncated && <span className="text-micro text-mf-text-3 italic">… truncated for display</span>}
    </div>
  );
}

// ── WfErrorBox ────────────────────────────────────────────────────────────────

interface WfErrorBoxProps {
  status: string;
  error: string | null;
}

/**
 * Ambiguous → amber tint, an "Outcome uncertain" headline AND the error text.
 * Failed → red tint with the error text. Both use an inset-ring box.
 */
function WfErrorBox({ status, error }: WfErrorBoxProps): React.ReactElement | null {
  const isAmbiguous = status === 'ambiguous';
  if (!isAmbiguous && !(status === 'failed' && error)) return null;

  return (
    <div
      className={cn(
        'flex items-start gap-[8px] rounded-md px-[10px] py-[8px] ring-1 ring-inset',
        isAmbiguous
          ? 'bg-mf-warning-tint text-mf-warning ring-mf-warning/[0.22]'
          : 'bg-mf-destructive-tint text-destructive ring-destructive/[0.22]',
      )}
    >
      <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0">
        {isAmbiguous && (
          <div className="mb-0.5 text-caption font-bold text-mf-warning">
            Outcome uncertain — the app crashed mid-step.
          </div>
        )}
        {error && (
          <div
            className={cn(
              'font-mono text-caption leading-normal break-words',
              isAmbiguous ? 'text-muted-foreground' : 'text-destructive',
            )}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
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
  const isMuted = node.status === 'skipped';
  const duration = node.duration ?? null;
  const waiting = node.status === 'waiting';
  const waitFor = node.waitFor ?? null;
  const secondary = waiting ? waitFor : null;

  function handleRowClick(): void {
    if (canExpand) setExpanded((prev) => !prev);
  }

  return (
    <div className="relative">
      {/* Status pip — centered on the spine (left:6/top:11 per prototype) */}
      <div data-testid={`workflows-step-${node.stepPath}-pip`} className="absolute left-[6px] top-[11px] z-[1]">
        <WfStatusPip status={node.status} />
      </div>

      {/* ── Collapsed row (indented past the spine) ── */}
      <div
        data-testid={`workflows-step-${node.stepPath}`}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) handleRowClick();
        }}
        className={cn(
          'ml-[30px] mb-0.5 rounded-md px-[10px] py-[8px] transition-colors',
          canExpand ? 'cursor-pointer' : 'cursor-default',
          isMuted && 'opacity-55',
          isAmbiguous ? 'bg-mf-warning-tint ring-1 ring-inset ring-mf-warning/[0.28]' : canExpand && 'hover:bg-accent',
        )}
      >
        <div className="flex min-w-0 items-center gap-[9px]">
          {/* Kind chip */}
          <WfKindChip kind={node.kind} />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-[8px]">
              {/* Title */}
              <span
                className={cn(
                  'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body font-semibold tracking-[-0.1px]',
                  isMuted ? 'text-mf-text-3' : 'text-foreground',
                )}
              >
                {title}
              </span>

              {/* Retry badge */}
              {node.attempt > 1 && (
                <span
                  data-testid={`workflows-step-${node.stepPath}-retry`}
                  title={`${node.attempt} attempts`}
                  className="inline-flex shrink-0 items-center gap-[3px] text-micro font-semibold text-mf-text-3"
                >
                  <RotateCw size={10} aria-hidden />
                  {node.attempt}×
                </span>
              )}

              {/* Duration */}
              {duration && <span className="shrink-0 font-mono text-micro text-mf-text-3">{duration}</span>}

              {/* Status tag */}
              <WfStatusTag status={node.status} kind="step" />
            </div>

            {/* Secondary line — waitFor (amber), shown only while waiting */}
            {secondary && (
              <div
                className={cn(
                  'mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-caption',
                  waiting ? 'text-mf-warning' : 'text-mf-text-3',
                )}
              >
                {secondary}
              </div>
            )}
          </div>

          {/* Expand chevron — sits to the right of the content column */}
          {canExpand && (
            <ChevronDown
              size={11}
              aria-hidden
              className={cn('shrink-0 text-mf-text-3 transition-transform', !expanded && '-rotate-90')}
            />
          )}
        </div>

        {/* ── Expanded detail — inline, indented block (not a full-bleed card) ── */}
        {expanded && canExpand && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-[9px] ml-[31px] flex cursor-default flex-col gap-[8px]"
          >
            <WfErrorBox status={node.status} error={node.error} />
            {node.input != null && <WfIO label="Input" value={node.input} truncated={node.truncated} />}
            {node.output != null && <WfIO label="Output" value={node.output} truncated={node.truncated} />}
            {node.chatId != null && (
              <button
                data-testid={`workflows-step-chat-${node.stepPath}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenChat(node.chatId!);
                }}
                className={cn(
                  'inline-flex w-fit items-center gap-1.5 rounded-md border-[0.5px] border-border bg-card pl-[9px] pr-[11px] py-1.5',
                  'text-caption font-semibold text-primary transition-colors hover:bg-accent',
                )}
              >
                <MessageSquare size={12} aria-hidden />
                Open agent chat
                <ChevronRight size={9} aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
