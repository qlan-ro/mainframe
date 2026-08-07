import { describe, expect, it } from 'vitest';
import type { TodoItem } from '@qlan-ro/mainframe-types';
import { todosToPlan } from '../plan-view';

const todo = (content: string, status: TodoItem['status'], activeForm: string): TodoItem => ({
  content,
  status,
  activeForm,
});

describe('todosToPlan', () => {
  it('returns an empty plan for no todos', () => {
    expect(todosToPlan([])).toEqual({ steps: [], activeIndex: 0 });
  });

  it('points at the first in_progress todo and labels it with its activeForm', () => {
    const plan = todosToPlan([
      todo('Read the plan', 'completed', 'Reading the plan'),
      todo('Write the tests', 'in_progress', 'Writing the tests'),
      todo('Ship it', 'pending', 'Shipping it'),
    ]);
    expect(plan).toEqual({
      steps: ['Read the plan', 'Writing the tests', 'Ship it'],
      activeIndex: 1,
    });
  });

  it('falls back to the completed count when nothing is in progress', () => {
    const plan = todosToPlan([
      todo('One', 'completed', 'Doing one'),
      todo('Two', 'completed', 'Doing two'),
      todo('Three', 'pending', 'Doing three'),
    ]);
    expect(plan.activeIndex).toBe(2);
    expect(plan.steps).toEqual(['One', 'Two', 'Three']);
  });

  it('reports a fully completed plan as activeIndex === steps.length', () => {
    const plan = todosToPlan([todo('One', 'completed', 'Doing one'), todo('Two', 'completed', 'Doing two')]);
    expect(plan.activeIndex).toBe(2);
  });

  it('starts at zero when nothing has been picked up yet', () => {
    const plan = todosToPlan([todo('One', 'pending', 'Doing one'), todo('Two', 'pending', 'Doing two')]);
    expect(plan.activeIndex).toBe(0);
  });

  it('prefers the first in_progress todo over the completed count when they disagree', () => {
    // The CLI can leave a completed todo after an in-progress one; the active
    // step is the one being worked, not the arithmetic.
    const plan = todosToPlan([
      todo('One', 'in_progress', 'Doing one'),
      todo('Two', 'completed', 'Doing two'),
      todo('Three', 'pending', 'Doing three'),
    ]);
    expect(plan.activeIndex).toBe(0);
  });

  it('falls back to the content when an in_progress todo has no activeForm', () => {
    const plan = todosToPlan([todo('Write the tests', 'in_progress', '')]);
    expect(plan.steps).toEqual(['Write the tests']);
  });
});
