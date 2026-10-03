import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Harness, LONG, MORE, thought, shown, tick, flush, startClock, stopClock } from './reasoning-smooth-fixtures';

beforeEach(startClock);
afterEach(stopClock);
it('reveals a strict prefix before showing all live reasoning', () => {
  render(<Harness items={[thought(LONG)]} />);
  expect(shown()).toBe('');
  tick(100);
  expect(shown().length).toBeGreaterThan(0);
  expect(shown().length).toBeLessThan(LONG.length);
  expect(LONG.startsWith(shown())).toBe(true);
  tick(500);
  expect(shown()).toBe(LONG);
});
it('shows completed replay immediately even while its thread is running', () => {
  render(<Harness items={[thought(LONG, false, 'replay', 'replay')]} />);
  expect(shown()).toBe(LONG);
});
it('drains a final append after immediate idle without jumping or losing its tail', async () => {
  const view = render(<Harness items={[thought(LONG)]} />);
  tick(80);
  const prefix = shown();
  view.rerender(<Harness running={false} items={[thought(LONG + MORE, false)]} />);
  await flush();
  expect(shown()).toBe(prefix);
  expect(shown().length).toBeLessThan(LONG.length + MORE.length);
  tick(1000);
  expect(shown()).toBe(LONG + MORE);
});
it('leaves earlier completed reasoning settled while a later part reveals', () => {
  render(<Harness items={[thought('earlier\n ', false, 'first', 'replay'), thought(LONG, true, 'second')]} />);
  expect(shown(0)).toBe('earlier\n ');
  expect(shown(1)).toBe('');
  tick(100);
  expect(shown(0)).toBe('earlier\n ');
  expect(shown(1).length).toBeLessThan(LONG.length);
  tick(500);
  expect(shown(1)).toBe(LONG);
});
it('preserves empty text, multiline whitespace and literal markdown', async () => {
  const view = render(<Harness items={[thought('')]} />);
  expect(shown()).toBe('');
  const text = '\n **plain**\n\tline\n  ';
  view.rerender(<Harness running={false} items={[thought(text, false)]} />);
  await flush();
  tick(500);
  expect(shown()).toBe(text);
  expect(view.container.querySelector('strong')).toBeNull();
});
it('drains an interrupted stream and resets non-append replacement content', async () => {
  const view = render(<Harness items={[thought(LONG)]} />);
  tick(80);
  view.rerender(<Harness running={false} items={[thought(LONG, false)]} />);
  await flush();
  tick(500);
  expect(shown()).toBe(LONG);
  view.rerender(<Harness items={[thought(MORE)]} />);
  await flush();
  expect(shown()).toBe('');
  tick(500);
  expect(shown()).toBe(MORE);
});
it('does not reuse a revealed cursor when the native part identity changes', async () => {
  const items = [thought(LONG), thought(LONG + MORE, true, 'replacement')];
  const view = render(<Harness items={items} index={0} />);
  tick(500);
  expect(shown()).toBe(LONG);
  view.rerender(<Harness items={items} index={1} />);
  await flush();
  expect(shown()).toBe('');
  tick(1000);
  expect(shown()).toBe(LONG + MORE);
});
it('shows running content immediately under reduced motion', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  render(<Harness items={[thought(LONG)]} />);
  expect(shown()).toBe(LONG);
});
it('cancels the pending animation frame when the leaf unmounts', () => {
  const cancel = vi.spyOn(window, 'cancelAnimationFrame');
  const view = render(<Harness items={[thought(LONG)]} />);
  tick(50);
  const before = cancel.mock.calls.length;
  view.unmount();
  expect(cancel.mock.calls.length).toBeGreaterThan(before);
  const request = vi.spyOn(window, 'requestAnimationFrame');
  tick(1000);
  expect(request).not.toHaveBeenCalled();
});
