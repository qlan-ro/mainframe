import { describe, expect, it } from 'vitest';
import type { TodoItem } from '@qlan-ro/mainframe-types';
import { todosToPlan } from '../plan-view';

const todo = (content: string, status: TodoItem['status'], activeForm = ''): TodoItem => ({
  content,
  status,
  activeForm,
});

describe('todosToPlan', () => {
  it('returns an empty plan for no todos', () => {
    expect(todosToPlan([])).toEqual({ steps: [], done: 0 });
  });

  it('labels the step in progress with its activeForm', () => {
    expect(
      todosToPlan([
        todo('Read the plan', 'completed', 'Reading the plan'),
        todo('Write the tests', 'in_progress', 'Writing the tests'),
        todo('Ship it', 'pending', 'Shipping it'),
      ]),
    ).toEqual({
      steps: [
        { text: 'Read the plan', state: 'done' },
        { text: 'Writing the tests', state: 'running' },
        { text: 'Ship it', state: 'todo' },
      ],
      done: 1,
    });
  });

  it('marks the first unfinished step as next when nothing is in progress', () => {
    const { steps } = todosToPlan([todo('One', 'completed'), todo('Two', 'pending'), todo('Three', 'pending')]);
    expect(steps.map((step) => step.state)).toEqual(['done', 'next', 'todo']);
  });

  it('keeps each step its own state when they finish out of order', () => {
    const plan = todosToPlan([todo('One', 'in_progress'), todo('Two', 'completed'), todo('Three', 'pending')]);
    expect(plan.steps.map((step) => step.state)).toEqual(['running', 'done', 'todo']);
    expect(plan.done).toBe(1);
  });

  it('has no current step once every step is done', () => {
    const plan = todosToPlan([todo('One', 'completed'), todo('Two', 'completed')]);
    expect(plan.steps.map((step) => step.state)).toEqual(['done', 'done']);
    expect(plan.done).toBe(2);
  });

  it('falls back to the content when a step in progress has no activeForm', () => {
    expect(todosToPlan([todo('Write the tests', 'in_progress')]).steps[0]?.text).toBe('Write the tests');
  });
});
