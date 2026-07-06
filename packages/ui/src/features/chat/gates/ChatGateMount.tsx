import { useEffect, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useChatPermissionFront } from '../runtime/use-chat-thread-runtime';
import { PermissionGate } from './PermissionGate';
import { AskUserQuestionGate } from './AskUserQuestionGate';
import { PlanGate } from './PlanGate';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';

/**
 * Renders the single pending gate (permission / question / plan) inline at the
 * thread tail.
 *
 * Approving a plan optimistically drops it from the permission queue right
 * away (`ChatThreadController.replyToPermission`), well before the daemon
 * confirms the resumed run — `front` goes undefined almost immediately after
 * the click, while `isRunning` can still read `false` for one or more renders
 * after that (the resumed run hasn't been confirmed yet). Retaining the render
 * on `approvedPlan != null && isRunning` unmounts this component entirely
 * during that window (neither condition holds), and remounting `PlanGate`
 * afterwards loses its local `approved` state — the card resets to the
 * pre-approval controls instead of keeping the running footer.
 *
 * Render is retained on `approvedPlan` ALONE (no `isRunning` gate), so the
 * SAME `PlanGate` element (same type + position → React preserves its
 * internal `approved` state) stays mounted continuously from the moment of
 * approval through run start to run end. Clearing waits until we've actually
 * OBSERVED the run start (`isRunning` true at least once) and then stop —
 * never on the very first not-yet-started `false` reading. Rejecting or
 * revising a plan never sets `approvedPlan` — only Approve does — so those
 * flows still unmount normally.
 */
export function ChatGateMount() {
  const { front, reply } = useChatPermissionFront();
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);

  const [approvedPlan, setApprovedPlan] = useState<ChatPermissionEntry | null>(null);
  const hasSeenRunningRef = useRef(false);

  useEffect(() => {
    if (approvedPlan == null) {
      hasSeenRunningRef.current = false;
      return;
    }
    if (isRunning) {
      hasSeenRunningRef.current = true;
    } else if (hasSeenRunningRef.current) {
      setApprovedPlan(null);
    }
  }, [approvedPlan, isRunning]);

  if (front) {
    const { toolName } = front.request;
    if (toolName === 'AskUserQuestion') return <AskUserQuestionGate entry={front} reply={reply} />;
    if (toolName === 'ExitPlanMode') {
      return <PlanGate entry={front} reply={reply} onApprove={() => setApprovedPlan(front)} />;
    }
    return <PermissionGate entry={front} reply={reply} />;
  }

  if (approvedPlan != null) {
    return <PlanGate entry={approvedPlan} reply={reply} />;
  }

  return null;
}
