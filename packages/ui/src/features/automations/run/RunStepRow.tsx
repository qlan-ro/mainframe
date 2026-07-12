/**
 * RunStepRow — one timeline row: spine node, verb icon, resolved label,
 * duration, Kept-going badge, output/error/chat disclosures, and (for a
 * `repeat` entry) its nested fan-out via RunRepeatGroup (ts153
 * wf2-runtime.jsx `WfRunStep`).
 *
 * Every field the prototype read straight off its mock step (`title`,
 * `continued`, `chat: true`) is derived here instead — the real
 * `AutomationTimelineEntry` carries none of them (`run-timeline.ts`'s
 * `entryLabel`/`isKeptGoing`, and `chatId` presence for the chat button).
 * Self-computes its own `data-testid` from `entry.stepRef` (the unique
 * per-iteration domain id) rather than taking one as a prop, matching
 * `LastRunPill`.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  ActionCatalogEntry,
  AutomationInteractionSummary,
  AutomationStep,
  AutomationTimelineEntry,
} from '../contract';
import { findStepById } from '../domain/tokens';
import { VERB_META } from '../editor/verb-meta';
import { entryLabel, formatDuration, isKeptGoing } from './run-timeline';
import { RunInlineForm } from './RunInlineForm';
import { RunRepeatGroup } from './RunRepeatGroup';
import { STEP_STATUS_META } from './status-meta';

function Spinner({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2.5 animate-spin rounded-full border-[1.5px] border-t-transparent', className)}
    />
  );
}

export interface RunStepRowProps {
  entry: AutomationTimelineEntry;
  timeline: AutomationTimelineEntry[];
  steps: AutomationStep[];
  catalog: ActionCatalogEntry[];
  interactions: AutomationInteractionSummary[];
  onOpenChat: (chatId: string) => void;
  onInteractionSubmitted: () => void;
  isLast?: boolean;
  spine?: boolean;
}

export function RunStepRow({
  entry,
  timeline,
  steps,
  catalog,
  interactions,
  onOpenChat,
  onInteractionSubmitted,
  isLast = true,
  spine = true,
}: RunStepRowProps) {
  const testId = `automations-run-step-${entry.stepRef}`;
  const verbMeta = VERB_META[entry.kind];
  const VerbIcon = verbMeta.icon;
  const statusMeta = STEP_STATUS_META[entry.status];
  const StatusIcon = statusMeta.Icon;
  const [open, setOpen] = useState(entry.status === 'waiting' || entry.status === 'failed');

  const label = entryLabel(entry, steps, catalog);
  const duration = formatDuration(entry.startedAt, entry.finishedAt);
  const keptGoing = isKeptGoing(entry, steps);
  const hasDisclosure = Boolean(entry.outputPreview || entry.error || entry.chatId);

  const interaction =
    entry.status === 'waiting' && entry.interactionId
      ? interactions.find((i) => i.id === entry.interactionId && i.status === 'pending')
      : undefined;

  const repeatStep = entry.kind === 'repeat' ? findStepById(steps, entry.stepId) : null;

  return (
    <div data-testid={testId} className="flex gap-2.5">
      {spine && (
        <div className="flex shrink-0 flex-col items-center">
          <span className={cn('mt-0.5 flex size-[22px] items-center justify-center rounded-full', statusMeta.dotClass)}>
            {entry.status === 'running' ? (
              <Spinner className={statusMeta.iconClass} />
            ) : (
              StatusIcon && <StatusIcon size={11} className={statusMeta.iconClass} aria-hidden />
            )}
          </span>
          {!isLast && <span aria-hidden className="mt-1 min-h-[14px] w-[2px] flex-1 bg-border" />}
        </div>
      )}
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-3.5')}>
        <div className="flex items-center gap-2">
          <VerbIcon size={13} className={verbMeta.iconClass} aria-hidden />
          <span
            className={cn(
              'flex-1 text-body font-semibold',
              entry.status === 'skipped' ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {label}
          </span>
          {keptGoing && (
            <span
              data-testid={`${testId}-kept-going`}
              title="This step failed but the automation kept going"
              className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-mf-warning/15 px-2 text-caption font-bold text-mf-warning"
            >
              Kept going
            </span>
          )}
          {duration && <span className="font-mono text-caption text-muted-foreground">{duration}</span>}
          {hasDisclosure && (
            <button
              type="button"
              data-testid={`${testId}-toggle`}
              aria-expanded={open}
              aria-label={open ? 'Hide details' : 'Show details'}
              onClick={() => setOpen((o) => !o)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            >
              {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
            </button>
          )}
        </div>

        {interaction && (
          <div className="mt-2">
            <RunInlineForm interaction={interaction} onSubmitted={onInteractionSubmitted} testId={`${testId}-form`} />
          </div>
        )}

        {open && entry.outputPreview && (
          <div
            data-testid={`${testId}-output`}
            className="mt-1.5 whitespace-pre-wrap rounded-md border-[0.5px] border-border bg-muted/50 px-2.5 py-2 font-mono text-caption leading-relaxed text-muted-foreground"
          >
            {entry.outputPreview}
          </div>
        )}
        {open && entry.error && (
          <div
            data-testid={`${testId}-error`}
            className="mt-1.5 rounded-md border-[0.5px] border-destructive/30 bg-destructive/[0.07] px-2.5 py-2 text-caption leading-relaxed text-destructive"
          >
            {entry.error}
          </div>
        )}
        {open && entry.chatId && (
          <button
            type="button"
            data-testid={`${testId}-chat`}
            onClick={() => onOpenChat(entry.chatId!)}
            className="mt-1.5 inline-flex h-[26px] items-center gap-1.5 rounded-md border-[0.5px] border-border px-2.5 text-caption font-semibold text-primary hover:bg-accent"
          >
            <MessageSquare size={11} aria-hidden />
            Open agent chat
          </button>
        )}

        {repeatStep?.kind === 'repeat' && (
          <div className="mt-2.5">
            <RunRepeatGroup
              repeatStep={repeatStep}
              timeline={timeline}
              steps={steps}
              catalog={catalog}
              interactions={interactions}
              onOpenChat={onOpenChat}
              onInteractionSubmitted={onInteractionSubmitted}
            />
          </div>
        )}
      </div>
    </div>
  );
}
