import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTurnDisclosureState } from '../use-turn-disclosure-state';
import { buildTurnDisclosures } from '../../../view-model/compact/build-turn-disclosures';
import { finalMessage, turnMessage } from './turn-fixtures';

it('keeps historical work folded when an unrelated background agent starts', () => {
  const model = buildTurnDisclosures([turnMessage('work', 'Historical work'), finalMessage()], {
    rootThreadId: 'background-history',
    ancestors: [],
    pendingToolIds: new Set(),
  });
  const root = { current: null };
  const key = [...model.turns.keys()][0]!;
  const view = renderHook(({ active }) => useTurnDisclosureState(model, root, active), {
    initialProps: { active: false },
  });
  expect(view.result.current.open(key)).toBe(false);
  view.rerender({ active: true });
  expect(view.result.current.open(key)).toBe(false);
});

it('keeps current running work open while a background agent is active', () => {
  const model = buildTurnDisclosures(
    [turnMessage('work', 'Current work', { state: 'running' }), finalMessage({ state: 'running' })],
    { rootThreadId: 'background-live', ancestors: [], pendingToolIds: new Set() },
  );
  const key = [...model.turns.keys()][0]!;
  const view = renderHook(() => useTurnDisclosureState(model, { current: null }, true));
  expect(view.result.current.open(key)).toBe(true);
});

function parentTurn(rootThreadId: string, state: 'running' | 'completed') {
  return buildTurnDisclosures([turnMessage('work', 'Parent work', { state }), finalMessage({ state })], {
    rootThreadId,
    ancestors: [],
    pendingToolIds: new Set(),
  });
}

it('waits for the background agent after its parent completes before automatically folding', () => {
  const running = parentTurn('background-parent-completes', 'running');
  const key = [...running.turns.keys()][0]!;
  const root = { current: null };
  const view = renderHook(({ model, active }) => useTurnDisclosureState(model, root, active), {
    initialProps: { model: running, active: true },
  });
  expect(view.result.current.open(key)).toBe(true);
  const completed = parentTurn('background-parent-completes', 'completed');
  view.rerender({ model: completed, active: true });
  expect(view.result.current.open(key)).toBe(true);
  view.rerender({ model: completed, active: false });
  expect(view.result.current.open(key)).toBe(false);
});

it('allows manually folding and reopening completed parent work while its background agent runs', () => {
  const model = parentTurn('background-manual', 'completed');
  const key = [...model.turns.keys()][0]!;
  const root = { current: null };
  const view = renderHook(() => useTurnDisclosureState(model, root, true));
  expect(view.result.current.open(key)).toBe(true);
  act(() => view.result.current.toggle(key));
  expect(view.result.current.open(key)).toBe(false);
  act(() => view.result.current.toggle(key));
  expect(view.result.current.open(key)).toBe(true);
});
