'use client';

/**
 * PlanCard — display card for the 'ExitPlanMode' tool.
 *
 * Shows an "Updated plan" card revealing the plan text.
 * - Expanded by default when a plan result is present (the plan is important
 *   context worth showing, not a chip to click open); still collapsible.
 *   No result = disabled/non-expandable.
 * - Body: <pre> of the plan text result
 * - This is the DISPLAY-only card; the interactive plan-approval card
 *   (permission gate) is a separate leaf built elsewhere.
 */

import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { FileText } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { StatusDot, stripErrorXml } from '../shared';

// ── PlanCard ──────────────────────────────────────────────────────────────────

export const PlanCard: ToolCallMessagePartComponent = (part) => {
  const { result, isError } = part;

  const rawResultText = typeof result === 'string' ? result : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;
  const hasResult = Boolean(resultText);

  return (
    <Collapsible data-testid="chat-plan-card" defaultOpen={hasResult} disabled={!hasResult}>
      <div
        className={cn(
          'rounded-lg border border-border bg-card overflow-hidden',
          isError && result !== undefined && 'border-destructive',
        )}
      >
        {/* Header trigger */}
        <CollapsibleTrigger
          data-testid="chat-plan-trigger"
          disabled={!hasResult}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left',
            hasResult ? 'hover:bg-accent transition-colors cursor-pointer' : 'cursor-default',
          )}
        >
          <FileText size={15} className={cn('shrink-0', hasResult ? 'text-muted-foreground' : 'text-mf-text-4')} />
          <span
            data-testid="chat-plan-label"
            className={cn('text-body flex-1', hasResult ? 'text-muted-foreground' : 'text-mf-text-4')}
          >
            Updated plan
          </span>
          <StatusDot result={result} isError={isError} />
        </CollapsibleTrigger>

        {/* Collapsible plan body */}
        {hasResult && resultText && (
          <CollapsibleContent>
            <div className="ml-5 border-l border-border py-1">
              <pre
                data-testid="chat-plan-body"
                className="text-caption font-mono text-muted-foreground whitespace-pre-wrap px-3 max-h-[200px] overflow-y-auto"
              >
                {resultText}
              </pre>
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
};

PlanCard.displayName = 'PlanCard';
