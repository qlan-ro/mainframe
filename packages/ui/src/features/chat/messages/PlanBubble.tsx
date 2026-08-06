/**
 * PlanBubble — the durable "Implementing plan" record for an approved plan.
 *
 * It is the transcript's only surviving copy of an approved plan: `PlanGate`
 * unmounts as soon as the approval is answered, so this record inherits the
 * gate's material (resolved `GateCardShell`) and carries the approved
 * execution mode as a caption — the confirmation the retired running footer
 * used to give.
 *
 * Shared by both approval paths (see plan-message.ts):
 *   - clear-context   → replaces the plain UserMessage bubble
 *   - no-clear-context → replaces the raw ExitPlanMode "Updated plan" PlanCard
 */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { SquareCheck, Check } from 'lucide-react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import { Badge } from '@v2/components/ui/badge';
import { GateCardShell, GateHead } from '../gates/shared/GateShell';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

const EXEC_MODE_LABELS: Record<ExecutionMode, string> = {
  default: 'Interactive',
  acceptEdits: 'Auto-edits',
  yolo: 'Unattended',
};

/** The semantic hue rides the glyph, not the label — so the pill is one stock
 *  `Badge` variant rather than a hand-mixed success tint. */
function ApprovedPill() {
  return (
    <Badge variant="secondary" className="shrink-0">
      <Check data-icon="inline-start" className="text-success" strokeWidth={2.4} />
      Approved
    </Badge>
  );
}

export function PlanBubble({
  plan,
  executionMode,
  clearedContext,
}: {
  plan: string;
  executionMode?: ExecutionMode;
  clearedContext?: boolean;
}) {
  const caption = executionMode
    ? `${EXEC_MODE_LABELS[executionMode]}${clearedContext ? ' · context cleared' : ''}`
    : null;

  return (
    <GateCardShell
      resolved
      data-testid="chat-plan-bubble"
      // overflow-visible over the shell's clip: clipping would hide a long-token
      // containment bug (#298) instead of surfacing it.
      className="overflow-visible break-words"
    >
      <GateHead
        icon={<SquareCheck className="size-3.5 text-success" />}
        tileClassName="bg-success/10"
        eyebrow="Plan"
        title="Implementing plan"
        subtitle={caption == null ? undefined : <span data-testid="chat-plan-exec-mode">{caption}</span>}
        right={<ApprovedPill />}
      />
      <div className="aui-md border-t border-border px-4 pt-2.5 pb-3 text-sm">
        <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
          {plan}
        </Markdown>
      </div>
    </GateCardShell>
  );
}

PlanBubble.displayName = 'PlanBubble';
