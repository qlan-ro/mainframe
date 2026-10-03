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
  type Mode,
} from '../../parts/__tests__/reasoning-smooth-fixtures';

const body = (mode: Mode) =>
  document.querySelector(
    mode === 'verbose' ? '[data-slot="reasoning-text"]' : '[data-testid^="chat-compact-details-"] .whitespace-pre-wrap',
  )!;
function open(mode: Mode) {
  const button = screen.getByRole('button', { name: mode === 'verbose' ? /Thinking/ : 'Thinking' });
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
  return button;
}
beforeEach(startClock);
afterEach(stopClock);
for (const mode of ['verbose', 'compact'] as const) {
  it(`${mode} reveals live reasoning without changing disclosure and reopens settled content immediately`, async () => {
    const view = render(<Harness mode={mode} rootId={`reopen-${mode}`} items={[thought(LONG)]} />);
    const button = open(mode);
    expect(body(mode).textContent).toBe('');
    tick(100);
    expect(body(mode).textContent!.length).toBeGreaterThan(0);
    expect(body(mode).textContent!.length).toBeLessThan(LONG.length);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    tick(1000);
    const target = LONG + MORE + '\n\t  ';
    view.rerender(<Harness mode={mode} rootId={`reopen-${mode}`} running={false} items={[thought(target, false)]} />);
    await flush();
    expect(body(mode).textContent).toBe(LONG);
    tick(1000);
    expect(body(mode).textContent).toBe(target);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName(mode === 'verbose' ? 'Thought for 1s' : 'Thought');
    const whitespace = mode === 'verbose' ? body(mode).firstElementChild : body(mode);
    expect(whitespace).toHaveClass('whitespace-pre-wrap');
    if (mode === 'compact') expect(body(mode)).toHaveClass('text-sm', 'text-muted-foreground');
    fireEvent.click(button);
    tick(300);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(body(mode).textContent).toBe(target);
    tick(50);
    expect(body(mode).textContent).toBe(target);
  });
  it(`${mode} keeps a completed earlier part settled while a later part streams`, () => {
    const first = 'First\n  ';
    render(
      <Harness
        mode={mode}
        rootId={`earlier-${mode}`}
        items={[thought(first, false, 'first', 'replay'), thought(LONG, true, 'later')]}
      />,
    );
    const button = open(mode);
    expect(body(mode).textContent).toBe(first);
    tick(100);
    const partial = body(mode).textContent!;
    expect(partial.startsWith(first)).toBe(true);
    expect(partial.length).toBeGreaterThan(first.length);
    expect(partial.length).toBeLessThan(first.length + LONG.length);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    tick(500);
    expect(body(mode).textContent).toBe(first + LONG);
  });
}
