import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import React from 'react';

type Listener = () => void;

function createFakeRuntime(initial: string) {
  const listeners = new Set<Listener>();
  const state = { text: initial };
  return {
    getState: () => state,
    subscribe: (cb: Listener) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setText(next: string) {
      state.text = next;
      listeners.forEach((cb) => cb());
    },
  };
}

const runtime = createFakeRuntime('');

vi.mock('@assistant-ui/react', () => ({
  useComposerRuntime: () => runtime,
}));

import { ComposerHighlight } from '../../../renderer/components/chat/assistant-ui/composer/ComposerHighlight';

describe('ComposerHighlight', () => {
  beforeEach(() => {
    runtime.setText('');
  });

  // A <textarea> renders an empty line after a trailing '\n' (the caret lives there),
  // but a <div white-space: pre-wrap> absorbs the trailing '\n' and renders no line.
  // That mismatch lands the caret below the overlay's last line. The overlay must emit
  // a zero-width character after the text so the trailing '\n' gets a real inline stub
  // with line-height.
  it('emits a trailing zero-width marker so the overlay renders a line for a trailing newline', () => {
    const { container } = render(<ComposerHighlight />);

    act(() => {
      runtime.setText('foo\n');
    });

    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay?.textContent).toMatch(/\n\u200B$/);
  });

  // If an ancestor remounts (e.g. after a permission prompt unmounts), the overlay mounts
  // with the runtime already populated. Relying purely on subscribe() would miss the
  // current value — the overlay must seed from getState() on first render.
  it('renders existing runtime text on mount without waiting for a subscribe event', () => {
    runtime.setText('already here');

    const { container } = render(<ComposerHighlight />);

    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay?.textContent).toContain('already here');
  });
});
