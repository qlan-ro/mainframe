'use client';

/**
 * PlanCard — display card for the 'ExitPlanMode' tool.
 *
 * Two renders:
 * - **Approved (no-clear-context)** → the CLI result announces "User has
 *   approved your plan …" and echoes the plan. Render the PlanBubble
 *   ("Implementing plan" / Approved), matching the clear-context user turn
 *   (see plan-message.ts). This is the shared approved-plan treatment.
 * - **Otherwise** → an "Updated plan" collapsible revealing the raw plan text
 *   (expanded by default when a result is present; disabled when empty). Also
 *   covers non-approval results (e.g. the "not in plan mode" error).
 *
 * The interactive plan-approval card (permission gate) is a separate leaf.
 */

import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { FileText } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { StatusDot, stripErrorXml } from '../shared';
import { PlanBubble } from '../../messages/PlanBubble';
import { parseApprovedPlanResult } from '../../messages/plan-message';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { useAutoOpenOnTransition } from './use-auto-open-on-transition';

// ── PlanCard ──────────────────────────────────────────────────────────────────

export const PlanCard: ToolCallMessagePartComponent = (part) => {
  const { result, isError } = part;

  // Read above the approved-plan early return so hook order stays stable.
  const chatExtras = useChatExtras();

  const rawResultText = typeof result === 'string' ? result : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;
  const hasResult = Boolean(resultText);
  // Hook must run unconditionally (before the approved-plan early return below)
  // to satisfy the rules of hooks across renders.
  const [open, setOpen] = useAutoOpenOnTransition(hasResult);

  // Approved plan → the shared "Implementing plan" bubble (parity with the
  // clear-context user turn). Non-approval results fall through to the card.
  const approvedPlan = parseApprovedPlanResult(resultText);
  if (approvedPlan) {
    return <PlanBubble plan={approvedPlan} executionMode={chatExtras?.state.chatConfig?.permissionMode} />;
  }

  return (
    <Collapsible data-testid="chat-plan-card" open={open} onOpenChange={setOpen} disabled={!hasResult}>
      <div
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-card',
          isError && result !== undefined && 'border-destructive',
        )}
      >
        {/* Header trigger */}
        <CollapsibleTrigger
          data-testid="chat-plan-trigger"
          disabled={!hasResult}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left',
            hasResult ? 'cursor-pointer transition-colors hover:bg-muted' : 'cursor-default',
          )}
        >
          <FileText className={cn('size-3.5 shrink-0 text-muted-foreground', !hasResult && 'opacity-60')} />
          <span
            data-testid="chat-plan-label"
            className={cn('flex-1 text-sm text-muted-foreground', !hasResult && 'opacity-60')}
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
                className="px-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
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
