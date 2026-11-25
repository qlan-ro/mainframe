import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PermissionReadDialog } from '../PermissionReadDialog';
import { PermissionGate } from '../PermissionGate';
import {
  gate,
  ui,
  queueFront,
  show,
  option,
  showRest,
  locked,
  LOCKED,
  FREE,
  press,
  enter,
  layout,
  resize,
  reply,
  WRAPPED,
  TALL,
} from './read-lock-fixture';

function installDialogRects(viewport: HTMLElement, content: HTMLElement) {
  Object.defineProperty(viewport, 'getBoundingClientRect', { value: () => new DOMRect(0, 0, 600, 200) });
  Object.defineProperty(content, 'getBoundingClientRect', {
    value: () => new DOMRect(0, -viewport.scrollTop, 600, 600),
  });
}

describe('where nothing can be measured', () => {
  it('without observers the button still unlocks it', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('IntersectionObserver', undefined);
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));
    expect(locked()).toEqual(LOCKED);

    press(showRest()!);

    expect(locked()).toEqual(FREE);
  });

  it('keeps Allow locked when the sticky footer leaves only one pixel', () => {
    layout.cap = 96;
    layout.answers = 95;
    layout.button = 0;
    layout.parts = { tool: 600 };
    show(gate('r1', { command: WRAPPED }));

    press(showRest()!);

    expect(locked()).toEqual(LOCKED);
    const dialog = screen.getByRole('dialog');
    const content = dialog.querySelector('pre')!;
    const viewport = screen.getByRole('region', { name: 'the command' });
    installDialogRects(viewport, content);
    fireEvent.scroll(viewport);
    expect(screen.queryByRole('button', { name: "I've read it" })).toBeNull();

    viewport.scrollTop = 700;
    fireEvent.scroll(viewport);
    expect(locked()).toEqual(LOCKED);

    viewport.scrollTop = 400;
    fireEvent.scroll(viewport);
    expect(locked()).toEqual(FREE);
    expect(dialog).toBeInTheDocument();
    press(screen.getByRole('button', { name: 'Done' }));
    expect(dialog).not.toBeInTheDocument();
    act(() => vi.runOnlyPendingTimers());
    expect(option('allow-once')).toHaveFocus();
  });

  it('without a layout nothing counts as seen until the button says so', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
    show(gate('r1', { command: 'ls' }));
    expect(locked()).toEqual(LOCKED);

    press(showRest()!);

    expect(locked()).toEqual(LOCKED);
    press(screen.getByRole('button', { name: "I've read it" }));
    expect(locked()).toEqual(FREE);
  });
});

it('returns focus to Show on Escape and measures updated text in the open dialog', () => {
  layout.cap = 96;
  layout.answers = 95;
  layout.button = 0;
  layout.parts = { tool: 600 };
  const { rerender } = show(gate('r1', { command: WRAPPED }));
  enter(showRest()!);
  queueFront(gate('r1', { command: TALL }));
  rerender(ui());
  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelector('pre')?.textContent).toBe(`Bash\n${TALL}`);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  act(() => vi.runOnlyPendingTimers());
  expect(showRest()).toHaveFocus();
  expect(locked()).toEqual(LOCKED);
});

it('dismisses the old read dialog when the request changes in place', () => {
  layout.cap = 96;
  layout.answers = 95;
  layout.button = 0;
  layout.parts = { tool: 600 };
  const card = (id: string) => (
    <TooltipProvider>
      <div data-chat-gate>
        <PermissionGate entry={gate(id, { command: WRAPPED }).entry} reply={reply} />
      </div>
    </TooltipProvider>
  );
  const { rerender } = render(card('r1'));
  enter(showRest()!);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  rerender(card('r2'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(locked()).toEqual(LOCKED);
});

it.each(['viewport', 'content'] as const)('remeasures the observed %s with the current callback', (target) => {
  const part = { id: 'tool', name: 'the command', text: WRAPPED };
  const previous = vi.fn();
  const current = vi.fn();
  const onClose = vi.fn();
  const dialog = (onRead: () => void) => (
    <PermissionReadDialog part={part} onRead={onRead} onClose={onClose} onRestoreFocus={onClose} />
  );
  const { rerender } = render(dialog(previous));
  const viewport = screen.getByRole('region', { name: part.name });
  const content = viewport.querySelector('pre')!;
  installDialogRects(viewport, content);
  resize(viewport);
  expect(previous).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: "I've read it" })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

  rerender(dialog(current));
  viewport.scrollTop = 400;
  resize(target === 'viewport' ? viewport : content);
  expect(current).toHaveBeenCalledOnce();
  expect(previous).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
});
