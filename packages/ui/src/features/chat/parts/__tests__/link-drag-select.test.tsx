/**
 * Todo #396 — a drag that starts on a transcript link selects text instead of
 * dragging (Chromium) or doing nothing (WebKit), the click that ends such a
 * drag never opens the link, and the link's text survives Cmd+C. A plain click
 * still opens it.
 *
 * jsdom has no layout, so `caretRangeFromPoint` is stubbed to map clientX to
 * a character offset inside the link's own text node.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => emitSurfaceIntent(intent) }));

const openExternal = vi.fn(() => Promise.resolve());
vi.mock('@/lib/host', () => ({ useHost: () => ({ shell: { openExternal } }) }));

import { SmartLink } from '../../smart-actions/SmartLink';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { TooltipProvider } from '@/components/ui/tooltip';

function stubCaretFromPoint(link: HTMLElement) {
  const text = [...link.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!;
  document.caretRangeFromPoint = (x: number) => {
    const range = document.createRange();
    range.setStart(text, Math.min(x, text.textContent!.length));
    return range;
  };
}

function dragAcross(link: HTMLElement, fromX: number, toX: number) {
  fireEvent.mouseDown(link, { button: 0, clientX: fromX, clientY: 0 });
  fireEvent.mouseMove(document, { clientX: toX, clientY: 0 });
  fireEvent.mouseUp(link, { clientX: toX, clientY: 0 });
  fireEvent.click(link, { clientX: toX, clientY: 0 });
}

beforeEach(() => {
  vi.useFakeTimers();
  emitSurfaceIntent.mockReset();
  openExternal.mockClear();
  useActiveBasesStore.setState({ bases: { projectPath: '/repo' }, scopeKey: null });
});

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
});

describe('dragging from a web link (#396)', () => {
  function renderWebLink() {
    render(
      <TooltipProvider>
        <SmartLink href="https://example.com/a/b">https://example.com/a/b</SmartLink>
      </TooltipProvider>,
    );
    const link = screen.getByRole('link');
    stubCaretFromPoint(link);
    return link;
  }

  it('is not natively draggable', () => {
    expect(renderWebLink()).toHaveAttribute('draggable', 'false');
  });

  it('stays part of a copied selection (no select-none from the context-menu trigger)', () => {
    expect(renderWebLink()).not.toHaveClass('select-none');
  });

  it('selects the dragged-over text and does not open the link', () => {
    const link = renderWebLink();
    dragAcross(link, 8, 19);

    expect(window.getSelection()?.toString()).toBe('example.com');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('still opens on a plain click', () => {
    const link = renderWebLink();
    fireEvent.mouseDown(link, { button: 0, clientX: 5, clientY: 0 });
    fireEvent.mouseUp(link, { clientX: 5, clientY: 0 });
    fireEvent.click(link);

    expect(openExternal).toHaveBeenCalledWith('https://example.com/a/b');
  });

  it('opens on the next click once a drag has ended', () => {
    const link = renderWebLink();
    dragAcross(link, 8, 19);
    act(() => vi.runAllTimers());
    fireEvent.click(link);

    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});

describe('dragging from a file reference (#396)', () => {
  it('selects text and emits no open-file intent', () => {
    render(<SmartLink href="/repo/src/a.ts">src/a.ts</SmartLink>);
    const link = screen.getByRole('link', { name: 'src/a.ts' });
    stubCaretFromPoint(link);
    dragAcross(link, 0, 5);

    expect(window.getSelection()?.toString()).toBe('src/a');
    expect(emitSurfaceIntent).not.toHaveBeenCalled();
  });

  it('stays part of a copied selection (no select-none from the context-menu trigger)', () => {
    render(<SmartLink href="/repo/src/a.ts">src/a.ts</SmartLink>);
    expect(screen.getByRole('link', { name: 'src/a.ts' })).not.toHaveClass('select-none');
  });
});
