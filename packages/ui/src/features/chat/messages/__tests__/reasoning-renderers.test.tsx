import { useUiPrefs } from '@/store/ui-prefs';
import { TurnFixture, finalMessage, turnMessage, turnSource } from '../compact/__tests__/turn-fixtures';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  Harness,
  LONG,
  MORE,
  thought,
  tick,
  flush,
  startClock,
  stopClock,
} from '../../parts/__tests__/reasoning-smooth-fixtures';

const body = () => document.querySelector('[data-slot="reasoning-text"]')!;
function openReasoning() {
  const button = screen.getByRole('button', { name: /Thinking/ });
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
  return button;
}
function expectHiddenReasoning() {
  expect(screen.queryByText(/A{10}|B{10}|First/)).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Thinking|Thought)$/ })).toBeNull();
  expect(document.querySelector('[data-slot="reasoning-text"]')).toBeNull();
}
beforeEach(startClock);
afterEach(stopClock);
it('verbose reveals live reasoning and reopens settled content immediately', async () => {
  const view = render(<Harness mode="verbose" rootId="reopen-verbose" items={[thought(LONG)]} />);
  const button = openReasoning();
  expect(body().textContent).toBe('');
  tick(100);
  expect(body().textContent!.length).toBeGreaterThan(0);
  expect(body().textContent!.length).toBeLessThan(LONG.length);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  tick(1000);
  const target = LONG + MORE + '\n\t  ';
  view.rerender(<Harness mode="verbose" rootId="reopen-verbose" running={false} items={[thought(target, false)]} />);
  await flush();
  expect(body().textContent).toBe(LONG);
  tick(1000);
  expect(body().textContent).toBe(target);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(button).toHaveAccessibleName('Thought for 1s');
  expect(body().firstElementChild).toHaveClass('whitespace-pre-wrap');
  fireEvent.click(button);
  tick(300);
  expect(button).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(button);
  expect(body().textContent).toBe(target);
  tick(50);
  expect(body().textContent).toBe(target);
});
it('verbose keeps a completed earlier part settled while a later part streams', () => {
  const first = 'First\n  ';
  render(
    <Harness
      mode="verbose"
      rootId="earlier-verbose"
      items={[thought(first, false, 'first', 'replay'), thought(LONG, true, 'later')]}
    />,
  );
  const button = openReasoning();
  expect(body().textContent).toBe(first);
  tick(100);
  const partial = body().textContent!;
  expect(partial.startsWith(first)).toBe(true);
  expect(partial.length).toBeGreaterThan(first.length);
  expect(partial.length).toBeLessThan(first.length + LONG.length);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  tick(500);
  expect(body().textContent).toBe(first + LONG);
});
it('compact retains a noninteractive status as hidden reasoning streams and completes', async () => {
  const view = render(<Harness mode="compact" rootId="compact-hidden" items={[thought(LONG)]} />);
  expect(screen.getByText('Thinking')).toBeVisible();
  expectHiddenReasoning();
  tick(100);
  view.rerender(<Harness mode="compact" rootId="compact-hidden" items={[thought(LONG + MORE)]} />);
  await flush();
  tick(1000);
  expect(screen.getByText('Thinking')).toBeVisible();
  expectHiddenReasoning();
  view.rerender(
    <Harness mode="compact" rootId="compact-hidden" running={false} items={[thought(LONG + MORE, false)]} />,
  );
  await flush();
  tick(1000);
  expect(screen.getByText('Thought')).toBeVisible();
  expectHiddenReasoning();
});
it('compact hides settled earlier reasoning while a later part streams', () => {
  render(
    <Harness
      mode="compact"
      rootId="compact-earlier"
      items={[thought('First\n  ', false, 'first', 'replay'), thought(LONG, true, 'later')]}
    />,
  );
  expect(screen.getByText('Thinking')).toBeVisible();
  expectHiddenReasoning();
  tick(100);
  expect(screen.getByText('Thinking')).toBeVisible();
  expectHiddenReasoning();
  tick(1000);
  expect(screen.getByText('Thinking')).toBeVisible();
  expectHiddenReasoning();
});

function mappedReasoning(tail: string, running: boolean) {
  const text = LONG + tail;
  return {
    ...turnMessage('mapped-thought', text, { state: running ? 'running' : 'completed' }, [
      turnSource('settled', 0, LONG.length),
      turnSource('live', LONG.length, text.length, { state: running ? 'running' : 'completed' }),
    ]),
    content: [{ type: 'reasoning' as const, text }],
  };
}
it('compact hides mapped reasoning ranges and folds completed work without hiding the final answer', async () => {
  useUiPrefs.getState().setTranscriptMode('compact');
  const view = render(<TurnFixture rootId="mapped-hidden" messages={[mappedReasoning(MORE, true)]} />);
  expect(screen.getByText('Thinking')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Work details' })).toBeNull();
  expectHiddenReasoning();
  tick(1000);
  expect(screen.getByText('Thinking')).toBeVisible();
  expectHiddenReasoning();
  view.rerender(
    <TurnFixture rootId="mapped-hidden" messages={[mappedReasoning(MORE + '\n  ', false), finalMessage()]} />,
  );
  await flush();
  tick(1000);
  const toggle = screen.getByRole('button', { name: 'Work details' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Final answer')).toBeVisible();
  expectHiddenReasoning();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Thought')).toBeVisible();
  expectHiddenReasoning();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Thought')).toBeNull();
  expect(screen.getByText('Final answer')).toBeVisible();
});
