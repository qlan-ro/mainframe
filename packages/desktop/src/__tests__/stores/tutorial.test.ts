import { describe, it, expect, beforeEach } from 'vitest';
import { useTutorialStore } from '../../renderer/store/tutorial';

describe('useTutorialStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTutorialStore.setState({ completed: false, step: 1 });
  });

  it('starts with step 1 and not completed', () => {
    const state = useTutorialStore.getState();
    expect(state.step).toBe(1);
    expect(state.completed).toBe(false);
  });

  it('nextStep increments step', () => {
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().step).toBe(2);
  });

  it('nextStep on last step calls complete', () => {
    useTutorialStore.setState({ step: 4 });
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().completed).toBe(true);
  });

  it('skip sets completed to true', () => {
    useTutorialStore.getState().skip();
    expect(useTutorialStore.getState().completed).toBe(true);
  });

  it('complete sets completed to true', () => {
    useTutorialStore.getState().complete();
    expect(useTutorialStore.getState().completed).toBe(true);
  });
});
