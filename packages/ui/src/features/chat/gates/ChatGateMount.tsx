import { useChatExtras, useChatPermissionFront } from '../runtime/chat-extras';
import { useAdapters } from '@/store/adapters';
import { PermissionGate } from './PermissionGate';
import { AskUserQuestionGate } from './AskUserQuestionGate';
import { PlanGate } from './PlanGate';

/**
 * Renders the single pending gate (permission / question / plan) in the thread's
 * sticky footer above the composer, dispatched by `ControlRequest.toolName`.
 *
 * The slot is pinned so a gate never scrolls out of reach: a user reading back
 * through the transcript still sees what is blocking the run (#336). `max-h-[45cqh]`
 * is its *preferred* cap against `ThreadPrimitive.Viewport`'s `[container-type:size]`
 * (the scrollport itself, not `ThreadPrimitive.Root` — the root also contains the
 * in-flow `FindBar`, so a root-relative cap over-counts the pane whenever find is
 * open) — capping the slot itself, not the footer it shares with the composer, so a
 * tall composer draft can never squeeze the gate toward 0 by growing the shared
 * parent unbounded. The footer as a whole is ALSO bounded, to `calc(100cqh-2rem)`
 * (ChatThread.tsx) rather than the full pane, so the transcript keeps a visible
 * strip even with the gate at its cap. Within that footer budget, `min-h-24` (below
 * `overflow-y-auto`'s automatic zero-min) is this slot's hard floor, and
 * `shrink-[100]` gives it first claim on any shrinkage the footer needs — the
 * banner+composer wrapper (ChatThread.tsx, plain default shrink factor) only
 * compresses once the slot is already pinned at that floor. Past whichever cap is
 * currently binding, the slot scrolls internally.
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

  // A synthesized request (no daemon _meta.controlRequest) never carries the
  // `input` the rich Plan/AskUserQuestion cards read — route it to the
  // generic options-only card regardless of toolName (spec decision 27).
  const { toolName } = front.request;
  const card = front.synthesizedRequest ? (
    <PermissionGate entry={front} reply={reply} />
  ) : toolName === 'AskUserQuestion' ? (
    <AskUserQuestionGate entry={front} reply={reply} />
  ) : toolName === 'ExitPlanMode' ? (
    <PlanGate entry={front} reply={reply} autoAllowed={adapter?.capabilities.autoMode === true} />
  ) : (
    <PermissionGate entry={front} reply={reply} />
  );

  return (
    <div
      data-testid="chat-thread-gate-slot"
      className="-mx-1 mb-2 min-h-24 max-h-[45cqh] shrink-[100] overflow-y-auto px-1 py-1 [scrollbar-width:none]"
    >
      {card}
    </div>
  );
}
