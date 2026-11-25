/**
 * G2: nothing is allowed unread. While the end of what a request asks to allow
 * has not been in view, the answers that allow it are locked and a pinned
 * button offers the rest. The layout is `gate-layout`'s.
 */
import { afterEach, beforeEach, vi } from 'vitest';
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
let resized: Map<() => void, Set<Element>>;

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
const resize = (target?: Element) =>
  act(() => {
    for (const [callback, targets] of resized) {
      if (!target || targets.has(target)) callback();
    }
  });

const WRAPPED = `echo ${'a'.repeat(1700)}; rm -rf ~`;
const GAP = `echo ok${'\n'.repeat(11)}rm -rf ~`;
const TALL = Array.from({ length: 200 }, (_, i) => `step ${i}`).join('\n');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  reply.mockResolvedValue(undefined);
  layout = installGateLayout({ cap: 300 });
  const callbacks = new Map<() => void, Set<Element>>();
  resized = callbacks;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe = (target: Element) => {
        const targets = callbacks.get(this.callback) ?? new Set();
        targets.add(target);
        callbacks.set(this.callback, targets);
      };
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

export {
  gate,
  rule,
  ui,
  queueFront,
  arm,
  show,
  slot,
  option,
  showRest,
  locked,
  LOCKED,
  FREE,
  press,
  enter,
  scrollTo,
  resize,
  layout,
  reply,
  WRAPPED,
  GAP,
  TALL,
};
