// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useShownToEnd } from '../use-shown-to-end';

it('confirms only the current text and accepts an equivalent part value', () => {
  const gate = { current: document.createElement('div') };
  const part = { id: 'tool', name: 'the command', text: 'old' };
  const { result, rerender } = renderHook(({ text }) => useShownToEnd(gate, 'request', [{ ...part, text }]), {
    initialProps: { text: part.text },
  });
  rerender({ text: 'new' });
  act(() => result.current.confirmRest(part));
  expect(result.current.locked).toBe(true);
  act(() => result.current.confirmRest({ ...part, text: 'new' }));
  expect(result.current.locked).toBe(false);
});

it.each([
  [-1, 12, false],
  [-2, 12, true],
  [88, 101, false],
  [88, 102, true],
])('measures the final line at %i–%i in a 0–100 viewport', (top, bottom, locked) => {
  const slot = document.createElement('div');
  slot.setAttribute('data-chat-gate', '');
  slot.innerHTML = '<div><pre data-allowed-part="tool">text</pre><div data-gate-answers></div></div>';
  const gate = slot.firstElementChild as HTMLElement;
  vi.spyOn(slot, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
  vi.spyOn(gate.lastElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 100, 20));
  vi.spyOn(gate.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
  const range = vi.spyOn(document, 'createRange').mockReturnValue({
    selectNodeContents: vi.fn(),
    getClientRects: () => [new DOMRect(0, top, 100, bottom - top)],
  } as unknown as Range);
  try {
    const { result } = renderHook(() =>
      useShownToEnd({ current: gate }, 'request', [{ id: 'tool', name: 'the command', text: 'text' }]),
    );
    expect(result.current.locked).toBe(locked);
  } finally {
    range.mockRestore();
  }
});
