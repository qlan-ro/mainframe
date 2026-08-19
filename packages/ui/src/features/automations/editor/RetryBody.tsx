/**
 * RetryBody — how many times to try, and the steps to try.
 *
 * The side-effect warning is not decoration. Retrying re-walks the body from
 * the top, so a body that opened a PR and then failed opens a second one on
 * the next attempt — the engine has no retry-time idempotence guard of its
 * own. It names the actual offenders (`nonIdempotentActionTitles`) rather
 * than blanket-warning every retry, and says nothing when every step in the
 * body is a known-idempotent action — that is what makes the warning worth
 * reading when it does appear.
 */
import { TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ActionCatalogEntry, RetryBlock } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import type { ValidationIssue } from '../domain/validate';
import { Recipe } from './Recipe';
import { nonIdempotentActionTitles } from './retry-idempotency';

export interface RetryBodyProps {
  step: RetryBlock;
  onChange: (patch: Partial<RetryBlock>) => void;
  tokens: TokenDescriptor[];
  catalog: ActionCatalogEntry[];
  issues: ValidationIssue[];
  depth: number;
}

export function RetryBody({ step, onChange, tokens, catalog, issues, depth }: RetryBodyProps) {
  const offenders = nonIdempotentActionTitles(step.steps, catalog);

  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Try up to</span>
        <Input
          data-testid={`automations-retry-attempts-${step.id}`}
          type="number"
          min={1}
          max={500}
          inputMode="numeric"
          value={step.maxAttempts === 0 ? '' : String(step.maxAttempts)}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10);
            onChange({ maxAttempts: Number.isNaN(parsed) || parsed < 0 ? 0 : parsed });
          }}
          className="h-[26px] w-[72px] px-2 py-0 text-xs"
        />
        <span className="text-xs text-muted-foreground">{step.maxAttempts === 1 ? 'time (no retry)' : 'times'}</span>
      </div>

      {offenders.length > 0 && (
        <p
          data-testid={`automations-retry-warning-${step.id}`}
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          Retrying will run these again: {offenders.join(', ')}.
        </p>
      )}

      <Recipe
        steps={step.steps}
        onChange={(steps) => onChange({ steps })}
        tokens={tokens}
        catalog={catalog}
        issues={issues}
        depth={depth + 1}
        testId={`automations-retry-recipe-${step.id}`}
      />
    </div>
  );
}
