import { useChatPermissionFront } from '../runtime/use-chat-thread-runtime';
import { PermissionGate } from './PermissionGate';
import { AskUserQuestionGate } from './AskUserQuestionGate';
import { PlanGate } from './PlanGate';

/**
 * Renders the single pending gate (permission / question / plan) inline at the
 * thread tail, dispatched by `ControlRequest.toolName`.
 *
 * An answered gate just unmounts: the daemon shifts the pending permission, so
 * the delivery re-read finds nothing to restore. An approved plan's durable
 * record is the transcript's PlanBubble, not this card.
 */
export function ChatGateMount() {
  const { front, reply } = useChatPermissionFront();
  if (!front) return null;

  const { toolName } = front.request;
  if (toolName === 'AskUserQuestion') return <AskUserQuestionGate entry={front} reply={reply} />;
  if (toolName === 'ExitPlanMode') return <PlanGate entry={front} reply={reply} />;
  return <PermissionGate entry={front} reply={reply} />;
}
