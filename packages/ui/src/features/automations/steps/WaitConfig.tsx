/**
 * WaitConfig — how long a `wait` step parks the run.
 *
 * The wire field is canonical `seconds` (contract), but nobody thinks in
 * seconds past a minute, so the control is amount + unit. The unit is SEEDED
 * from the stored value rather than stored alongside it — a second `unit`
 * field on the wire would be a second source of truth that drifts — but it is
 * then held in local state, because deriving it on every render breaks the
 * commonest edit there is: clearing "5 min" to retype it passes through 0,
 * which divides into no unit, so a re-derived unit would silently snap to
 * seconds and turn the next keystroke into "2 seconds".
 *
 * Switching the unit keeps the amount and recomputes seconds — a toggle from
 * "5 minutes" to hours reads as "5 hours", which is what a unit switch means
 * everywhere else.
 *
 * Zero and over-cap durations are left to `domain/validate` rather than
 * clamped here: the card's existing issue row is where every other step
 * reports a bad field, and silently rewriting the user's number is worse.
 */
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WaitStep } from '../contract';
import { FieldRow } from './FieldRow';

const UNITS = [
  { id: 'seconds', label: 'sec', factor: 1 },
  { id: 'minutes', label: 'min', factor: 60 },
  { id: 'hours', label: 'hr', factor: 3600 },
] as const;

type UnitId = (typeof UNITS)[number]['id'];

/** The largest unit the stored seconds divide into evenly. */
function deriveUnit(seconds: number): UnitId {
  if (seconds > 0 && seconds % 3600 === 0) return 'hours';
  if (seconds > 0 && seconds % 60 === 0) return 'minutes';
  return 'seconds';
}

function factorOf(unit: UnitId): number {
  return UNITS.find((u) => u.id === unit)?.factor ?? 1;
}

export interface WaitConfigProps {
  step: WaitStep;
  onChange: (next: WaitStep) => void;
  testId: string;
}

export function WaitConfig({ step, onChange, testId }: WaitConfigProps) {
  // Seeded once: the editor mounts one config per step, so this tracks the
  // step being edited without needing to re-sync.
  const [unit, setUnitState] = useState<UnitId>(() => deriveUnit(step.seconds));
  const amount = step.seconds === 0 ? '' : String(step.seconds / factorOf(unit));

  function setAmount(raw: string) {
    // Empty reads as 0 so the field can be cleared; validation owns the verdict.
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
    onChange({ ...step, seconds: next * factorOf(unit) });
  }

  function setUnit(next: UnitId) {
    const current = step.seconds === 0 ? 0 : step.seconds / factorOf(unit);
    setUnitState(next);
    onChange({ ...step, seconds: current * factorOf(next) });
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <FieldRow label="Wait for">
        <div className="flex items-center gap-2">
          <Input
            data-testid={`${testId}-amount`}
            type="number"
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5"
            className="h-[26px] w-[72px] px-2 py-0 text-xs"
          />
          <div className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
            {UNITS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`${testId}-unit-${option.id}`}
                aria-pressed={unit === option.id}
                onClick={() => setUnit(option.id)}
                className={cn(
                  'rounded-sm px-2.5 py-1 text-xs font-medium',
                  unit === option.id
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </FieldRow>
      <p className="pl-[86px] text-xs text-muted-foreground">
        The run parks and costs nothing while waiting. Resumes on the next 30-second check, so short waits round up.
      </p>
    </div>
  );
}
