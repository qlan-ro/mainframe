/**
 * plan-view — session todos → the `AgentPlan` element's props.
 *
 * The element is positional: a step is done when its index is below
 * `activeIndex`, active at it, pending above. That maps 1:1 onto the CLI's
 * todo list, so this is a projection rather than a translation.
 */
import type { TodoItem } from '@qlan-ro/mainframe-types';

export interface PlanView {
  steps: string[];
  activeIndex: number;
}

export function todosToPlan(todos: readonly TodoItem[]): PlanView {
  const steps = todos.map((todo) => (todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content));
  const inProgress = todos.findIndex((todo) => todo.status === 'in_progress');
  // Nothing in progress: the front of the plan is however much is already done,
  // which lands on `steps.length` for a finished plan (the element's "all done").
  const activeIndex = inProgress === -1 ? todos.filter((todo) => todo.status === 'completed').length : inProgress;
  return { steps, activeIndex };
}
