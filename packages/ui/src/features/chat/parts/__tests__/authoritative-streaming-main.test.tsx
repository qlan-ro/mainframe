// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MainHarness as Harness,
  OLD,
  NEW,
  TAIL,
  textItem,
  stateFromItems,
  nextTurn,
  withAcknowledgment,
  shown,
  textNode,
  tick,
  flush,
  startClock,
  stopClock,
} from './authoritative-streaming-support';

beforeEach(startClock);
afterEach(stopClock);
it.each(['pending', 'echo', 'cancelling'] as const)(
  'keeps the completed live answer whole immediately after remount during %s',
  async (mode) => {
    const settled = stateFromItems([textItem('old', OLD)]);
    const view = render(<Harness state={settled} />);
    expect(shown('old')).toBe(OLD);
    const active = nextTurn(settled, mode);
    view.rerender(<Harness state={active} />);
    await flush();
    const before = textNode('old');
    view.rerender(<Harness state={active} epoch={1} />);
    expect(textNode('old')).not.toBe(before);
    expect(shown('old')).toBe(OLD);
    expect(screen.getByTestId('thread-running')).toHaveTextContent('true');
    for (const elapsed of [16, 100, 500]) {
      tick(elapsed);
      expect(shown('old')).toBe(OLD);
    }
  },
);
it('progressively reveals a new explicit stream behind an acknowledgment and settles without truncation', async () => {
  const old = textItem('old', OLD);
  const view = render(<Harness state={stateFromItems([old])} />);
  const streaming = withAcknowledgment(stateFromItems([old, textItem('new', NEW, true)], 'running'));
  view.rerender(<Harness state={streaming} />);
  await flush();
  expect(shown('old')).toBe(OLD);
  expect(shown('new').length).toBeLessThan(NEW.length);
  tick(100);
  expect(shown('new').length).toBeGreaterThan(0);
  expect(shown('new').length).toBeLessThan(NEW.length);
  expect(shown('old')).toBe(OLD);
  const prefix = shown('new');
  const committed = withAcknowledgment(stateFromItems([old, textItem('new', NEW + TAIL)], 'running'));
  view.rerender(<Harness state={committed} />);
  await flush();
  expect(shown('new').startsWith(prefix)).toBe(true);
  tick(1000);
  expect(shown('new')).toBe(NEW + TAIL);
  expect(shown('old')).toBe(OLD);
});

it.each(['pending', 'echo', 'cancelling'] as const)(
  'keeps a live answer settled after its stream finishes and a %s turn remounts it',
  async (mode) => {
    const view = render(<Harness state={stateFromItems([textItem('old', OLD, true)], 'running')} />);
    tick(100);
    expect(shown('old').length).toBeGreaterThan(0);
    expect(shown('old').length).toBeLessThan(OLD.length);
    const settled = stateFromItems([textItem('old', OLD)]);
    view.rerender(<Harness state={settled} />);
    await flush();
    tick(1000);
    expect(shown('old')).toBe(OLD);
    const active = nextTurn(settled, mode);
    view.rerender(<Harness state={active} />);
    await flush();
    view.rerender(<Harness state={active} epoch={1} />);
    expect(shown('old')).toBe(OLD);
    tick(100);
    expect(shown('old')).toBe(OLD);
  },
);
