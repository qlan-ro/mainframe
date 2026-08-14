import { useChatExtras, useChatPermissionFront } from '../runtime/use-chat-thread-runtime';
import { useAdapters } from '@/store/adapters';
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
  if (toolName === 'AskUserQuestion') return <AskUserQuestionGate entry={front} reply={reply} />;
  if (toolName === 'ExitPlanMode')
    return <PlanGate entry={front} reply={reply} autoAllowed={adapter?.capabilities.autoMode === true} />;
  return <PermissionGate entry={front} reply={reply} />;
}
