// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
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
