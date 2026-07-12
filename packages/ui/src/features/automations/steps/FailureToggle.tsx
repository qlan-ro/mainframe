/**
 * FailureToggle — the only per-step failure control (spec §8), writing
 * `step.keepGoing` (ts153 wf2-stepconfig.jsx `WfFailureToggle` — ts153's
 * `continueOnError` is the wire-renamed `keepGoing`, contract §1). Shared by
 * every verb's "More options" body — surfaced in the run view as "Kept
 * going" when it actually fires (Phase 5).
 */
import { Switch } from '@/components/ui/switch';
import { FieldRow } from './FieldRow';

export interface FailureToggleProps {
  keepGoing: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}

export function FailureToggle({ keepGoing, onChange, testId }: FailureToggleProps) {
  return (
    <FieldRow label="On failure" top>
      <label className="inline-flex items-center gap-2.5">
        <Switch data-testid={testId} checked={keepGoing} onCheckedChange={onChange} />
        <span className="text-caption text-muted-foreground">Keep going if this step fails</span>
      </label>
    </FieldRow>
  );
}
