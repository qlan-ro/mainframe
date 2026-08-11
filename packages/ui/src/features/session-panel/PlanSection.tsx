/**
 * PlanSection — the agent's todo list as assistant-ui's `agent-plan` element.
 *
 * No section header of our own: the element ships one, and the fork in
 * `AgentPlan.tsx` makes it the collapse trigger. Hidden entirely when there are
 * no todos — unlike Background Activity, the rail has no Plan button, so an
 * empty section would be an affordance for absent data rather than a scroll
 * target that must survive.
 */
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useSessionTodos } from '@/store/session-todos';
import { AgentPlan } from './AgentPlan';
import { todosToPlan } from './plan-view';

interface PlanSectionProps {
  open: boolean;
  onToggle: () => void;
}

export function PlanSection({ open, onToggle }: PlanSectionProps) {
  const { chatId } = useActiveIdentity();
  const todos = useSessionTodos(chatId);

  if (todos.length === 0) return null;

  const { steps, activeIndex } = todosToPlan(todos);

  return (
    <section data-testid="session-panel-plan" className="shrink-0 border-b border-border px-3 py-3 last:border-b-0">
      <AgentPlan steps={steps} activeIndex={activeIndex} open={open} onToggle={onToggle} />
    </section>
  );
}
