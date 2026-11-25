import { useRef } from 'react';
import { mfToast } from '@/lib/toast';
import { DelegatedGateProbes } from './DelegatedGateProbes';
import { GateCard } from './GateCard';
import { GateGuard } from './GateGuard';
import type { ReplyFn } from './gate-types';
import { useGateQueue, type PendingGate } from './use-gate-queue';

/**
 * Renders the single pending gate (permission / question / plan) in the thread's
 * sticky footer above the composer, dispatched by `ControlRequest.toolName`. The
 * oldest request shows, whoever asks: the session, a sub-agent, or a delegated
 * task (G5, `useGateQueue`).
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
 * Scrollbars are overlay thumbs (S3), so that parity holds while the slot
 * scrolls.
 *
 * An answered gate just unmounts: the daemon shifts the pending permission, so
 * the delivery re-read finds nothing to restore. An approved plan's durable
 * record is the transcript's PlanBubble, not this card.
 *
 * A newly shown gate takes no input for half a second, and only input that began
 * on it (`GateGuard`): the press that answered the last one can't answer it too.
 *
 * The asking chat's adapter is handed to `GateCard`, which keeps the gate cards
 * prop-driven: the plan gate offers the CLI's `auto` execution mode only when
 * that adapter advertises `capabilities.autoMode`.
 */
function FrontGate({ gate, more }: { gate: PendingGate; more: number }) {
  const answered = useRef(false);
  // One gate, one answer: a second press on the same card must not send again.
  // A failed answer gives the gate back, and says so.
  const reply: ReplyFn = async (...args) => {
    if (answered.current) return;
    answered.current = true;
    try {
      await gate.reply(...args);
    } catch (error) {
      answered.current = false;
      console.warn('[chat/gates] answer not sent', { error });
      mfToast.error('Could not send your answer', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <GateGuard>
      <GateCard
        entry={gate.entry}
        reply={reply}
        adapterId={gate.adapterId}
        chatId={gate.chatId}
        composerMode={gate.mode}
        context={{ asker: gate.from?.name, title: gate.from?.title, more }}
      />
    </GateGuard>
  );
}

export function ChatGateMount() {
  const { front, more } = useGateQueue();
  return (
    <>
      <DelegatedGateProbes />
      {front && (
        <div
          // Keyed by request: the next one starts at its top, with nothing chosen, and arms itself.
          key={front.key}
          data-testid="chat-thread-gate-slot"
          // Where an Activity row that needs you moves focus (`session-panel/activity-source`).
          data-chat-gate
          className="-mx-1 mb-2 min-h-24 max-h-[45cqh] shrink-[100] overflow-y-auto px-1 py-1"
        >
          <FrontGate gate={front} more={more} />
        </div>
      )}
    </>
  );
}
