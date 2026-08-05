/**
 * WorkspaceUrlEntry — the inline "open a URL" field shared by the tab strip's `+`
 * menu and the empty-state picker (#281, AC6, D2).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => emitSurfaceIntent(intent) }));

import { WorkspaceUrlEntry } from '../WorkspaceUrlEntry';

function input(): HTMLElement {
  return screen.getByTestId('workspace-url-entry-input');
}

beforeEach(() => {
  emitSurfaceIntent.mockReset();
});

describe('WorkspaceUrlEntry — commit', () => {
  it('emits one open-url-tab intent with the normalized URL and calls onDone', async () => {
    const onDone = vi.fn();
    render(<WorkspaceUrlEntry paneId="pane-1" onDone={onDone} />);

    await userEvent.type(input(), 'localhost:5173');
    await userEvent.keyboard('{Enter}');

    expect(emitSurfaceIntent).toHaveBeenCalledTimes(1);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({
      type: 'open-url-tab',
      url: 'http://localhost:5173/',
      paneId: 'pane-1',
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('omits paneId when the caller supplies none — the empty-state picker case', async () => {
    const onDone = vi.fn();
    render(<WorkspaceUrlEntry onDone={onDone} />);

    await userEvent.type(input(), 'localhost:5173');
    await userEvent.keyboard('{Enter}');

    expect(emitSurfaceIntent).toHaveBeenCalledWith({
      type: 'open-url-tab',
      url: 'http://localhost:5173/',
      paneId: undefined,
    });
  });
});

describe('WorkspaceUrlEntry — invalid input', () => {
  it.each(['', '   ', 'not a url', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'emits nothing and marks the field invalid for %j',
    async (draft) => {
      const onDone = vi.fn();
      render(<WorkspaceUrlEntry paneId="pane-1" onDone={onDone} />);

      if (draft) await userEvent.type(input(), draft);
      await userEvent.keyboard('{Enter}');

      expect(emitSurfaceIntent).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      expect(input()).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('clears the invalid state once the user types again', async () => {
    render(<WorkspaceUrlEntry paneId="pane-1" onDone={vi.fn()} />);

    await userEvent.keyboard('{Enter}');
    expect(input()).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(input(), 'l');
    expect(input()).toHaveAttribute('aria-invalid', 'false');
  });
});

describe('WorkspaceUrlEntry — Escape', () => {
  it('emits nothing and calls onDone', async () => {
    const onDone = vi.fn();
    render(<WorkspaceUrlEntry paneId="pane-1" onDone={onDone} />);

    await userEvent.type(input(), 'localhost:5173');
    await userEvent.keyboard('{Escape}');

    expect(emitSurfaceIntent).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
