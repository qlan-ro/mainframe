import { useChatExtras, useChatPermissionFront } from '../runtime/use-chat-thread-runtime';
import { useAdapters } from '@/store/adapters';
import { PermissionGate } from './PermissionGate';
import { AskUserQuestionGate } from './AskUserQuestionGate';
import { PlanGate } from './PlanGate';

/**
 * Renders the single pending gate (permission / question / plan) in the thread's
 * sticky footer above the composer, dispatched by `ControlRequest.toolName`.
 *
 * The slot is pinned so a gate never scrolls out of reach: a user reading back
 * through the transcript still sees what is blocking the run (#336). It carries
 * `data-slot` so the footer can cap its height only while a gate is mounted, and
 * scrolls internally past that cap.
 *
 * `px-1` with a matching `-mx-1` gives the card's accent ring room inside a
 * scroll container (`overflow-y-auto` computes the other axis to `auto` too)
 * while keeping the card's edges on the composer's.
 * `[scrollbar-width:none]` keeps that parity while the slot scrolls: app.css
 * styles `::-webkit-scrollbar` globally, which makes the 8px bar layout-consuming
 * and would take those 8px out of the card's width.
 *
 * An answered gate just unmounts: the daemon shifts the pending permission, so
 * the delivery re-read finds nothing to restore. An approved plan's durable
 * record is the transcript's PlanBubble, not this card.
 *
 * The chat's adapter is resolved here rather than in `PlanGate`, which stays
 * prop-driven: the plan gate offers the CLI's `auto` execution mode only when
 * that adapter advertises `capabilities.autoMode`.
 */
export function ChatGateMount() {
  const { front, reply } = useChatPermissionFront();
  const extras = useChatExtras();
  const adapters = useAdapters();

  if (!front) return null;

  const adapterId = extras?.state.chatConfig?.adapterId;
  const adapter = adapters.find((a) => a.id === adapterId);

  const { toolName } = front.request;
  const card =
    toolName === 'AskUserQuestion' ? (
      <AskUserQuestionGate entry={front} reply={reply} />
    ) : toolName === 'ExitPlanMode' ? (
      <PlanGate entry={front} reply={reply} autoAllowed={adapter?.capabilities.autoMode === true} />
    ) : (
      <PermissionGate entry={front} reply={reply} />
    );

  return (
    <div
      data-testid="chat-thread-gate-slot"
      data-slot="chat-gate-slot"
      className="-mx-1 mb-2 min-h-0 flex-1 overflow-y-auto px-1 py-1 [scrollbar-width:none]"
    >
      {card}
    </div>
  );
}
