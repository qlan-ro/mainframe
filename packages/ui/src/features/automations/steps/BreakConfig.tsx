/**
 * BreakConfig — `break` carries no fields, so this pane exists to say what the
 * step does rather than to edit it. An empty config body reads as a component
 * that failed to load; one line of copy reads as a step that needs no setup.
 */
import type { BreakStep } from '../contract';

export interface BreakConfigProps {
  step: BreakStep;
  testId: string;
}

export function BreakConfig({ testId }: BreakConfigProps) {
  return (
    <p data-testid={`${testId}-note`} className="text-xs text-muted-foreground">
      Leaves the loop around this step and carries on with whatever follows it. Nothing to configure.
    </p>
  );
}
