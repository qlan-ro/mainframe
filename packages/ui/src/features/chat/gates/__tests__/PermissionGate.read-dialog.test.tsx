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
  Object.defineProperty(viewport, 'getClientRects', { value: () => [viewport.getBoundingClientRect()] });
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
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();

  rerender(dialog(current));
  viewport.scrollTop = 400;
  resize(target === 'viewport' ? viewport : content);
  expect(current).toHaveBeenCalledOnce();
  expect(previous).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
});

it.each(['none', 'permission', 'locked permission', 'plan'] as const)(
  'restores focus when an open request disappears with next gate %s',
  async (replacement) => {
    layout.cap = 96;
    layout.answers = 95;
    layout.button = 0;
    layout.parts = { tool: 600 };
    const { rerender } = show(gate('r1', { command: WRAPPED }));
    enter(showRest()!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    layout.cap = 300;
    layout.answers = 44;
    layout.parts = replacement === 'locked permission' ? { tool: 600 } : {};
    const next =
      replacement === 'plan'
        ? gate('r2', { plan: 'Plan text' }, { toolName: 'ExitPlanMode' })
        : gate('r2', { command: replacement === 'locked permission' ? TALL : 'ls' });
    queueFront(replacement === 'none' ? undefined : next);
    rerender(ui());
    await act(async () => vi.runAllTimersAsync());
    expect(screen.queryByRole('dialog')).toBeNull();
    // The request as a whole, or the thread: a key meant for the text just read answers and sends nothing.
    const target = screen.getByTestId(replacement === 'none' ? 'chat-thread' : 'chat-thread-gate-slot');
    expect(target).toHaveFocus();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    for (const key of [' ', 'Enter']) {
      fireEvent.keyDown(document.activeElement!, { key });
      fireEvent.keyUp(document.activeElement!, { key });
    }
    expect(target).toHaveFocus();
    expect(reply).not.toHaveBeenCalled();
  },
);

it.each([360, 800])('requires the new end after rule text grows at %i×600', (width) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', 600);
  const name = 'the saved rules '.repeat(40);
  const onRead = vi.fn();
  const onClose = vi.fn();
  const dialog = (text: string) => (
    <PermissionReadDialog
      part={{ id: 'rules', name, text }}
      onRead={onRead}
      onClose={onClose}
      onRestoreFocus={onClose}
    />
  );
  const { rerender } = render(dialog(TALL));
  const viewport = screen.getByRole('region', { name: name.trim() });
  const content = viewport.querySelector('pre')!;
  let height = 600;
  const box = () => new DOMRect(0, 0, width - 48, 64);
  vi.spyOn(viewport, 'getClientRects').mockReturnValue([box()] as unknown as DOMRectList);
  Object.defineProperty(viewport, 'getBoundingClientRect', { value: box });
  Object.defineProperty(content, 'getBoundingClientRect', {
    value: () => new DOMRect(0, -viewport.scrollTop, width - 48, height),
  });
  viewport.scrollTop = 536;
  fireEvent.scroll(viewport);
  const done = screen.getByRole('button', { name: 'Done' });
  expect(done).toBeEnabled();
  expect(onRead).toHaveBeenCalledOnce();

  height = 900;
  rerender(dialog(TALL + WRAPPED));
  expect(content.textContent).toBe(TALL + WRAPPED);
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: "I've read it" })).toBeNull();
  fireEvent.scroll(viewport);
  expect(onRead).toHaveBeenCalledOnce();
  viewport.scrollTop = 836;
  fireEvent.scroll(viewport);
  expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  expect(onRead).toHaveBeenCalledTimes(2);
});

it('does not offer manual confirmation when the scroller has a zero-height client rect', () => {
  const onRead = vi.fn();
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
  render(
    <PermissionReadDialog
      part={{ id: 'tool', name: 'the command', text: WRAPPED }}
      onRead={onRead}
      onClose={vi.fn()}
      onRestoreFocus={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: "I've read it" })).toBeNull();
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  expect(onRead).not.toHaveBeenCalled();
});
