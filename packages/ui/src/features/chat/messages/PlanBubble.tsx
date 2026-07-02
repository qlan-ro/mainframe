/**
 * PlanBubble — the "Implementing plan" card for an approved plan turn.
 *
 * Design: `User Message States` artboard `UMPlanBubble`
 * (docs/design-reference/prototype/11-usermessages.jsx:83-98) — user-card
 * gradient + hairline, a green checklist chip, an "Implementing plan" heading,
 * a green "Approved" pill, then a hairline-divided Markdown body.
 *
 * Shared by both approval paths (see plan-message.ts):
 *   - clear-context   → replaces the plain UserMessage bubble
 *   - no-clear-context → replaces the raw ExitPlanMode "Updated plan" PlanCard
 */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { SquareCheck, Check } from 'lucide-react';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

const CARD_STYLE = {
  background: 'var(--mf-um-card)',
  boxShadow: 'var(--mf-shadow-user-card)',
} as const;

export function PlanBubble({ plan }: { plan: string }) {
  return (
    <div
      data-testid="chat-plan-bubble"
      style={CARD_STYLE}
      className="max-w-[530px] overflow-hidden rounded-xl border-[0.5px] border-mf-um-edge text-mf-um-ink"
    >
      <div className="flex items-center gap-[8px] px-[16px] pb-[9px] pt-[10px]">
        <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[6px] bg-mf-success-tint">
          <SquareCheck className="size-[12px] text-mf-success" />
        </span>
        <span className="text-body font-bold tracking-tight">Implementing plan</span>
        <span className="inline-flex items-center gap-[4px] rounded-[20px] bg-mf-success-tint px-[8px] py-[2px] text-micro font-semibold text-mf-success">
          <Check className="size-[10px]" strokeWidth={2.4} />
          Approved
        </span>
      </div>
      <div className="border-t-[0.5px] border-mf-um-edge px-[16px] pb-[12px] pt-[4px] text-body">
        <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
          {plan}
        </Markdown>
      </div>
    </div>
  );
}

PlanBubble.displayName = 'PlanBubble';
