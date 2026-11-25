/** An approved plan's marker: the pill, and the plan's markdown under it. */
import { MARKER_ICONS, usePlanMode } from '../tools/markers/EventMarker';
import { MarkerPill } from '../tools/markers/MarkerPill';
import { approvedPlan } from '../view-model/turn/marker-facts';
import { Prose } from './turn/Prose';

/** The clear-context path: the plan comes back as the first message of a fresh context. */
export function PlanApprovedMarker({ plan, messageId }: { plan: string; messageId: string }) {
  const facts = approvedPlan(plan, usePlanMode(), true);
  return (
    <MarkerPill
      rowKey={`plan:${messageId}`}
      testId="chat-plan-approved"
      icon={MARKER_ICONS[facts.icon]}
      label={facts.label}
      target={facts.target}
      receipt={facts.receipt}
    >
      <Prose text={plan} />
    </MarkerPill>
  );
}
