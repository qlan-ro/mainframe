/**
 * AdvancedSection — the Agent card's rarely-touched fields (todo #234 T15):
 * attachments, timeout, on-failure and expected results.
 *
 * The toggle lives in the card's toolbar row and the panel below it, so the
 * two ship as separate exports; the card owns the open state.
 *
 * One deliberate contract-driven deviation from the ts153 prototype:
 * **Timeout, not a free-text budget cap.** ts153's "$4.00 or 20m" text field
 * is replaced by the real `timeoutMinutes: number` field.
 */
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AskAgentStep } from '../../contract';
import { AttachmentsField } from '../AttachmentsField';
import { ExpectResultsBuilder } from '../ExpectResultsBuilder';
import { FailureToggle } from '../FailureToggle';
import { FieldRow } from '../FieldRow';

export interface AdvancedToggleProps {
  open: boolean;
  onToggle: () => void;
  testId: string;
}

export function AdvancedToggle({ open, onToggle, testId }: AdvancedToggleProps) {
  return (
    <button
      type="button"
      data-testid={`${testId}-advanced-toggle`}
      onClick={onToggle}
      aria-expanded={open}
      aria-label="More options"
      className={cn(
        'flex size-[26px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        open && 'bg-mf-selection text-foreground',
      )}
    >
      <SlidersHorizontal className="size-3.5" aria-hidden />
    </button>
  );
}

export interface AdvancedSectionProps {
  step: AskAgentStep;
  onChange: (patch: Partial<AskAgentStep>) => void;
  testId: string;
}

export function AdvancedSection({ step, onChange, testId }: AdvancedSectionProps) {
  return (
    <div className="flex flex-col gap-2.5 border-t-[0.5px] border-border px-3 py-2.5">
      <FieldRow label="Attachments" top>
        <AttachmentsField
          value={step.attachments ?? []}
          onChange={(attachments) => onChange({ attachments })}
          testId={`${testId}-attachments`}
        />
      </FieldRow>

      <FieldRow label="Timeout">
        <input
          data-testid={`${testId}-timeout`}
          type="number"
          min={0}
          value={step.timeoutMinutes ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({ timeoutMinutes: raw === '' ? undefined : Number(raw) });
          }}
          placeholder="minutes"
          className="h-[28px] w-[110px] rounded-md border-[0.5px] border-input bg-card px-2.5 text-caption text-foreground outline-none placeholder:text-muted-foreground"
        />
      </FieldRow>

      <FailureToggle
        keepGoing={!!step.keepGoing}
        onChange={(keepGoing) => onChange({ keepGoing })}
        testId={`${testId}-keepgoing`}
      />

      <FieldRow label="Expect" top>
        <ExpectResultsBuilder
          expects={step.expects ?? []}
          onChange={(expects) => onChange({ expects })}
          testId={`${testId}-expects`}
        />
      </FieldRow>
    </div>
  );
}
