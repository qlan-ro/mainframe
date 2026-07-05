import { useEffect, useState } from 'react';
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
 * away (`ChatThreadController.replyToPermission`), well before the agent
 * finishes executing it — `front` goes undefined almost immediately after the
 * click. Retain the just-approved entry here and keep rendering the SAME
 * `PlanGate` element (same type + position → React preserves its internal
 * `approved` state instead of remounting) until the run actually ends, so its
 * "Executing in <mode> mode…" footer survives the drop. Rejecting or revising
 * a plan never sets this — only Approve does — so those flows still unmount
 * normally.
 */
export function ChatGateMount() {
  const { front, reply } = useChatPermissionFront();
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);

  const [approvedPlan, setApprovedPlan] = useState<ChatPermissionEntry | null>(null);

  useEffect(() => {
    if (approvedPlan != null && !isRunning) setApprovedPlan(null);
  }, [approvedPlan, isRunning]);

  if (front) {
    const { toolName } = front.request;
    if (toolName === 'AskUserQuestion') return <AskUserQuestionGate entry={front} reply={reply} />;
    if (toolName === 'ExitPlanMode') {
      return <PlanGate entry={front} reply={reply} onApprove={() => setApprovedPlan(front)} />;
    }
    return <PermissionGate entry={front} reply={reply} />;
  }

  if (approvedPlan != null && isRunning) {
    return <PlanGate entry={approvedPlan} reply={reply} />;
  }

  return null;
}
