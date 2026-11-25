/**
 * plan-view — session todos → the Plan section's steps. Each step's state is
 * its own: agents finish steps out of order.
 */
import type { TodoItem } from '@qlan-ro/mainframe-types';

/** `next` is the first unfinished step while nothing is in progress. */
export type PlanStepState = 'done' | 'running' | 'next' | 'todo';

export interface PlanStep {
  text: string;
  state: PlanStepState;
}

export interface PlanView {
  steps: PlanStep[];
  done: number;
}

export function todosToPlan(todos: readonly TodoItem[]): PlanView {
  const running = todos.some((todo) => todo.status === 'in_progress');
  const next = running ? -1 : todos.findIndex((todo) => todo.status !== 'completed');
  const steps = todos.map((todo, index): PlanStep => {
    if (todo.status === 'completed') return { text: todo.content, state: 'done' };
    if (todo.status === 'in_progress') return { text: todo.activeForm || todo.content, state: 'running' };
    return { text: todo.content, state: index === next ? 'next' : 'todo' };
  });
  return { steps, done: steps.filter((step) => step.state === 'done').length };
}
