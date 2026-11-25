/**
 * G2: nothing is allowed unread. While the end of what a request asks to allow
 * has not been in view, the answers that allow it are locked and a pinned
 * button offers the rest. The layout is `gate-layout`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';

vi.mock('../use-gate-queue', () => ({ useGateQueue: vi.fn() }));
vi.mock('../DelegatedGateProbes', () => ({ DelegatedGateProbes: () => null }));
import { useGateQueue, type PendingGate } from '../use-gate-queue';
import { ChatGateMount } from '../ChatGateMount';
import { GATE_ARM_MS } from '../GateGuard';
import { installGateLayout, type GateLayout } from './gate-layout';

const reply = vi.fn();
let layout: GateLayout;
let resized: Set<() => void>;

const rule = (ruleContent: string): ControlUpdate => ({
  type: 'addRules',
  rules: [{ toolName: 'Bash', ruleContent }],
  behavior: 'allow',
  destination: 'session',
});

function gate(
  requestId: string,
  input: Record<string, unknown>,
  { suggestions = [], toolName = 'Bash' }: { suggestions?: ControlUpdate[]; toolName?: string } = {},
): PendingGate {
  const entry: ChatPermissionEntry = {
    requestId,
    askedAt: 1,
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
    request: { requestId, toolName, toolUseId: requestId, input, suggestions },
  };
  return { key: `c:${requestId}`, chatId: 'c', entry, reply, adapterId: 'claude', mode: undefined, from: null };
}

const ui = () => (
  <TooltipProvider>
    <ChatGateMount />
  </TooltipProvider>
);

function queueFront(front: PendingGate): void {
  vi.mocked(useGateQueue).mockReturnValue({ front, more: 0, waitingCalls: new Set() });
}
const arm = () => act(() => vi.advanceTimersByTime(GATE_ARM_MS));

/** Shows a gate, armed. */
function show(front: PendingGate) {
  queueFront(front);
  const view = render(ui());
  arm();
  return view;
}

const slot = () => screen.getByTestId('chat-thread-gate-slot');
const option = (id: string) => screen.getByTestId(`chat-permission-option-${id}`);
const showRest = () => screen.queryByTestId('chat-permission-show-rest');
const locked = () => ['allow-once', 'allow-always'].map((id) => option(id).getAttribute('aria-disabled') === 'true');
const LOCKED = [true, true];
const FREE = [false, false];

function press(element: HTMLElement, detail = 1) {
  fireEvent.pointerDown(element);
  fireEvent.click(element, { detail });
}
function enter(element: HTMLElement) {
  element.focus();
  if (fireEvent.keyDown(element, { key: 'Enter' })) fireEvent.click(element, { detail: 0 });
}
function scrollTo(top: number) {
  slot().scrollTop = top;
  fireEvent.scroll(slot());
}
const resize = () => act(() => resized.forEach((callback) => callback()));

const WRAPPED = `echo ${'a'.repeat(1700)}; rm -rf ~`;
const GAP = `echo ok${'\n'.repeat(11)}rm -rf ~`;
const TALL = Array.from({ length: 200 }, (_, i) => `step ${i}`).join('\n');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  reply.mockResolvedValue(undefined);
  layout = installGateLayout({ cap: 300 });
  const callbacks = new Set<() => void>();
  resized = callbacks;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe = () => callbacks.add(this.callback);
      unobserve = () => {};
      disconnect = () => callbacks.delete(this.callback);
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a request whose end is out of view', () => {
  it.each([
    ['one wrapped line', WRAPPED, 400],
    ['a ten-line gap', GAP, 240],
    ['200 lines', TALL, 3600],
  ])('locks what allows it: %s', (_what, command, height) => {
    layout.parts = { tool: height };
    show(gate('r1', { command }));

    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of the command');

    press(option('allow-once'));
    press(option('allow-always'));
    enter(option('allow-once'));
    fireEvent.keyDown(option('allow-once'), { key: ' ' });
    fireEvent.keyUp(option('allow-once'), { key: ' ' });
    fireEvent.click(option('allow-once'), { detail: 0 });
    expect(reply).not.toHaveBeenCalled();
  });

  it('leaves Reject live', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    expect(option('reject-once')).not.toHaveAttribute('aria-disabled');
    press(option('reject-once'));

    expect(reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ behavior: 'deny' }), 'reject-once');
  });

  it('locks an answer of a kind it does not know, which may allow', () => {
    layout.parts = { tool: 400 };
    const front = gate('r1', { command: WRAPPED });
    front.entry.options.push({ optionId: 'new', name: 'New', kind: 'allow_for_a_day' as never });
    show(front);

    press(option('new'));

    expect(reply).not.toHaveBeenCalled();
  });

  it('the button scrolls to the end and unlocks every answer', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    press(showRest()!);

    // Head and command are 450 px; 300 − 44 − 40 of them show above the answers and the button.
    expect(slot().scrollTop).toBe(450 - 216);
    expect(locked()).toEqual(FREE);
    expect(showRest()).toBeNull();
    press(option('allow-once'));
    expect(reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ behavior: 'allow' }), 'allow-once');
  });

  it('scrolling there unlocks it too, and scrolling short of it does not', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    scrollTo(200);
    expect(locked()).toEqual(LOCKED);

    scrollTo(450 - 216);
    expect(locked()).toEqual(FREE);
    expect(showRest()).toBeNull();
  });

  it('a last line behind the answers is out of view', () => {
    layout.parts = { tool: 220 };
    show(gate('r1', { command: GAP }));

    // It ends at 270: inside the slot, under the answers that start at 256.
    expect(locked()).toEqual(LOCKED);
  });

  it('a jump past the end does not count: the end was never in view', () => {
    layout.parts = { tool: 400, grants: 900 };
    show(gate('r1', { command: WRAPPED }, { suggestions: [rule('a')] }));

    scrollTo(900);

    expect(showRest()).toHaveAccessibleName('Show the rest of the command');
  });

  it('once shown, hiding the end again locks nothing', () => {
    layout.parts = { tool: 150 };
    show(gate('r1', { command: GAP }));
    expect(locked()).toEqual(FREE);

    layout.cap = 120;
    resize();
    scrollTo(0);

    expect(locked()).toEqual(FREE);
    expect(showRest()).toBeNull();
  });

  it('a resize that brings the end into view unlocks it', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    layout.cap = 900;
    resize();

    expect(locked()).toEqual(FREE);
  });

  it('the next request is locked again, for itself, and starts at its top', () => {
    layout.parts = { tool: 400 };
    const { rerender } = show(gate('r1', { command: WRAPPED }));
    press(showRest()!);
    expect(slot().scrollTop).toBeGreaterThan(0);
    press(option('allow-once'));

    // The same command, asked again.
    queueFront(gate('r2', { command: WRAPPED }));
    rerender(ui());
    arm();

    expect(slot().scrollTop).toBe(0);
    expect(locked()).toEqual(LOCKED);
    press(option('allow-once'));
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

describe('a request that fits', () => {
  it('has no button and no lock', () => {
    layout.parts = { tool: 100 };
    show(gate('r1', { command: GAP }));

    expect(showRest()).toBeNull();
    expect(locked()).toEqual(FREE);
    expect(option('allow-once')).not.toHaveAccessibleDescription();
  });

  it('is measured without the button, whose own room would hide the end', () => {
    // Ends at 250, above the answers at 256; a button above them would cover it.
    layout.parts = { tool: 200 };
    show(gate('r1', { command: GAP }));

    expect(showRest()).toBeNull();
  });
});

describe('everything on show that is allowed', () => {
  it('counts the rules “Always allow” saves', () => {
    layout.parts = { grants: 800 };
    show(gate('r1', { command: 'ls' }, { suggestions: [rule('a'), rule('b')] }));

    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of what “Always allow” saves');
    press(showRest()!);
    expect(locked()).toEqual(FREE);
  });

  it('counts directories', () => {
    layout.parts = { grants: 800 };
    show(
      gate(
        'r1',
        { command: 'ls' },
        {
          suggestions: [{ type: 'addDirectories', directories: ['/a', '/b'], destination: 'session' } as ControlUpdate],
        },
      ),
    );

    expect(locked()).toEqual(LOCKED);
  });

  it('counts Details once they are open', () => {
    layout.parts = { details: 700 };
    show(gate('r1', { file_path: '/a', content: 'x' }, { toolName: 'Write' }));
    expect(locked()).toEqual(FREE);

    press(screen.getByTestId('chat-permission-details-toggle'));

    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of the details');
    press(showRest()!);
    expect(locked()).toEqual(FREE);
  });

  it('a long tool name counts as the request', () => {
    layout.parts = { tool: 500 };
    show(gate('r1', {}, { toolName: `mcp__${'x'.repeat(900)}` }));

    expect(showRest()).toHaveAccessibleName('Show the rest of the request');
  });

  it('one press shows one end: a command’s is not passed by on the way to the rules', () => {
    layout.parts = { tool: 900, grants: 900 };
    show(gate('r1', { command: TALL }, { suggestions: [rule('a')] }));

    press(showRest()!);
    expect(locked()).toEqual(LOCKED);
    expect(showRest()).toHaveAccessibleName('Show the rest of what “Always allow” saves');
    // The second click of a double-click is not a press.
    press(showRest()!, 2);
    expect(locked()).toEqual(LOCKED);

    press(showRest()!);
    expect(locked()).toEqual(FREE);
  });

  it('rules that fit behind the command’s end come into view with it', () => {
    layout.parts = { tool: 900, grants: 60 };
    show(gate('r1', { command: TALL }, { suggestions: [rule('a')] }));

    press(showRest()!);

    expect(locked()).toEqual(FREE);
  });
});

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

  it('without a layout nothing counts as seen until the button says so', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
    show(gate('r1', { command: 'ls' }));
    expect(locked()).toEqual(LOCKED);

    press(showRest()!);

    expect(locked()).toEqual(FREE);
  });
});

describe('the keyboard and screen readers', () => {
  it('a locked answer keeps its name and its place in the tab order, and says why', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    expect(option('allow-once')).toHaveAccessibleName('Allow once');
    expect(option('allow-once')).toHaveAccessibleDescription(
      'Not available until you have seen the end of the command.',
    );
    expect(option('allow-once')).not.toBeDisabled();
    expect(option('reject-once')).not.toHaveAccessibleDescription();
    option('allow-once').focus();
    expect(option('allow-once')).toHaveFocus();
  });

  it('the keyboard alone shows the rest, keeps its place, and answers', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));

    enter(showRest()!);

    // The button is gone; focus is on what it showed, before the answers.
    const shownPart = screen.getByTestId('chat-permission-command').closest('[data-allowed-part]');
    expect(shownPart).toHaveFocus();
    fireEvent.keyUp(shownPart!, { key: 'Enter' });
    enter(option('allow-once'));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('a scroll that takes the button away hands its focus on', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));
    showRest()!.focus();

    scrollTo(450);

    expect(showRest()).toBeNull();
    expect(screen.getByTestId('chat-permission-command').closest('[data-allowed-part]')).toHaveFocus();
  });

  it('a scroll takes no focus from anything else', () => {
    layout.parts = { tool: 400 };
    show(gate('r1', { command: WRAPPED }));
    option('reject-once').focus();

    scrollTo(450);

    expect(option('reject-once')).toHaveFocus();
  });
});
