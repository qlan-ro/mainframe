/**
 * ChatGateMount — behavior tests.
 *
 * Strategy:
 *  - The runtime module is mocked for its two hooks (`useChatPermissionFront`
 *    and `useChatExtras`) — the real gate components are used so that routing
 *    decisions are verified through observable DOM state (data-testids), not
 *    through inspecting which JSX branch the component chose.
 *  - The adapters store is the real one, seeded per case.
 *  - All expected values are hardcoded; no logic mirrors the dispatch table
 *    inside ChatGateMount.
 *
 * Behaviors covered:
 *  1. front=undefined → renders nothing (empty container).
 *  2. front=AskUserQuestion entry → chat-question-gate present; plan and
 *     permission gates absent.
 *  3. front=ExitPlanMode entry → chat-plan-gate present; question and
 *     permission gates absent.
 *  4. front=Bash entry (unknown toolName) → chat-permission-gate present;
 *     question and plan gates absent.
 *  5. Reply passthrough: with a permission entry the hook's `reply` fn is
 *     forwarded to PermissionGate — clicking deny calls it with the correct
 *     deny ControlResponse.
 *  6. An answered plan gate unmounts when the queue front clears — nothing is
 *     retained past the answer.
 *  7. Routing keeps working after a plan gate was answered.
 *  8. The plan gate's Auto exec-mode segment follows the chat adapter's
 *     `capabilities.autoMode` — present for an adapter that advertises it,
 *     absent for one that does not.
 *  9. The pinned-slot wrapper (`chat-thread-gate-slot`): present and wrapping
 *     each of the three card variants when a front exists; absent (and the
 *     container still empty) when front is undefined; re-mounted with the
 *     same gate after a front clears and returns (the delayed-re-read
 *     restore path); carries the class contract the height cap and the
 *     composer width parity depend on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AdapterInfo, PermissionOption } from '@qlan-ro/mainframe-types';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import type { ChatRuntimeExtras } from '../../runtime/use-chat-thread-runtime';

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatPermissionFront: vi.fn(),
  useChatExtras: vi.fn(),
}));
import { useChatExtras, useChatPermissionFront } from '../../runtime/use-chat-thread-runtime';
import { ChatGateMount } from '../ChatGateMount';

const mockFront = vi.mocked(useChatPermissionFront);
const mockExtras = vi.mocked(useChatExtras);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const reply = vi.fn();

const OPTIONS: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
];

function entry(toolName: string, input: Record<string, unknown>): ChatPermissionEntry {
  return {
    requestId: 'r1',
    askedAt: 1,
    request: { requestId: 'r1', toolName, toolUseId: 'tu1', input, suggestions: [] },
    options: OPTIONS,
  };
}

function adapter(id: string, capabilities: AdapterInfo['capabilities']): AdapterInfo {
  return { id, name: id, description: '', installed: true, models: [], capabilities };
}

function extrasWithAdapter(adapterId: string): ChatRuntimeExtras {
  return { state: { chatConfig: { adapterId } } } as unknown as ChatRuntimeExtras;
}

const permissionEntry = entry('Bash', { command: 'ls' });
const askEntry = entry('AskUserQuestion', { questions: [{ question: 'Pick', options: [{ label: 'A' }] }] });
const planEntry = entry('ExitPlanMode', { plan: '1. step' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatGateMount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks does not drop a mockReturnValue, so each case restates it.
    mockExtras.mockReturnValue(undefined);
    resetAdapters();
  });

  // --- Behavior 1: front undefined → renders nothing ---

  it('renders nothing when front is undefined', () => {
    mockFront.mockReturnValue({ front: undefined, reply });
    const { container } = wrap(<ChatGateMount />);
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  // --- Behavior 2: AskUserQuestion → question gate only ---

  it('renders chat-question-gate and only that gate when toolName is AskUserQuestion', () => {
    mockFront.mockReturnValue({ front: askEntry, reply });
    wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-question-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
  });

  // --- Behavior 3: ExitPlanMode → plan gate only ---

  it('renders chat-plan-gate and only that gate when toolName is ExitPlanMode', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-plan-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
  });

  // --- Behavior 4: unknown toolName → permission gate only ---

  it('renders chat-permission-gate and only that gate when toolName is Bash (unknown to gate router)', () => {
    mockFront.mockReturnValue({ front: permissionEntry, reply });
    wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-permission-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
  });

  // --- Behavior 5: reply forwarded to PermissionGate's chosen-option action ---

  it('forwards the hook reply fn to PermissionGate — the Reject option calls reply with the deny ControlResponse', () => {
    const localReply = vi.fn();
    mockFront.mockReturnValue({ front: permissionEntry, reply: localReply });
    wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-permission-option-reject-once'));

    expect(localReply).toHaveBeenCalledTimes(1);
    expect(localReply).toHaveBeenCalledWith(
      {
        requestId: 'r1',
        toolUseId: 'tu1',
        toolName: 'Bash',
        behavior: 'deny',
      },
      'reject-once',
    );
  });

  // --- Behavior 6: an answered gate unmounts with the queue front ---
  //
  // replyToPermission optimistically drops the entry from `permissions` (and
  // therefore `front`) the same tick an action is clicked; the daemon then
  // shifts the pending permission, so nothing restores it. The approved plan's
  // durable record is the transcript PlanBubble, not this card.

  it('unmounts the plan gate once the queue front clears', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    const { container, rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    mockFront.mockReturnValue({ front: undefined, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('unmounts the permission gate once an option answer clears the queue front', () => {
    mockFront.mockReturnValue({ front: permissionEntry, reply });
    const { container, rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-permission-option-allow-once'));

    mockFront.mockReturnValue({ front: undefined, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('still routes AskUserQuestion and permission gates by toolName after a plan gate was answered', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    const { rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    mockFront.mockReturnValue({ front: askEntry, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-question-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();

    mockFront.mockReturnValue({ front: permissionEntry, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-permission-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
  });

  // --- Behavior 8: the plan gate's Auto segment follows the chat adapter ---

  it('offers the Auto exec-mode segment when the chat adapter advertises autoMode', () => {
    seedAdapters([adapter('claude', { planMode: true, autoMode: true })]);
    mockExtras.mockReturnValue(extrasWithAdapter('claude'));
    mockFront.mockReturnValue({ front: planEntry, reply });

    wrap(<ChatGateMount />);

    expect(screen.getByTestId('chat-plan-execmode-auto')).toBeInTheDocument();
  });

  it('omits the Auto exec-mode segment when the chat adapter does not advertise autoMode', () => {
    seedAdapters([adapter('codex', { planMode: true })]);
    mockExtras.mockReturnValue(extrasWithAdapter('codex'));
    mockFront.mockReturnValue({ front: planEntry, reply });

    wrap(<ChatGateMount />);

    expect(screen.getByTestId('chat-plan-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-execmode-auto')).toBeNull();
  });

  // --- Behavior 9: the pinned-slot wrapper ---

  it('wraps a permission gate in the chat-thread-gate-slot', () => {
    mockFront.mockReturnValue({ front: permissionEntry, reply });
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toContainElement(screen.getByTestId('chat-permission-gate'));
  });

  it('wraps an AskUserQuestion gate in the chat-thread-gate-slot', () => {
    mockFront.mockReturnValue({ front: askEntry, reply });
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toContainElement(screen.getByTestId('chat-question-gate'));
  });

  it('wraps a plan gate in the chat-thread-gate-slot', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toContainElement(screen.getByTestId('chat-plan-gate'));
  });

  it('renders no slot and an empty container when front is undefined', () => {
    mockFront.mockReturnValue({ front: undefined, reply });
    const { container } = wrap(<ChatGateMount />);

    expect(screen.queryByTestId('chat-thread-gate-slot')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('re-mounts the slot with the same gate after the front clears and returns', () => {
    mockFront.mockReturnValue({ front: permissionEntry, reply });
    const { rerender } = wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-thread-gate-slot')).toContainElement(screen.getByTestId('chat-permission-gate'));

    mockFront.mockReturnValue({ front: undefined, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('chat-thread-gate-slot')).toBeNull();

    mockFront.mockReturnValue({ front: permissionEntry, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-thread-gate-slot')).toContainElement(screen.getByTestId('chat-permission-gate'));
  });

  // Class-string regression check only: this pins the tokens the height cap
  // and the composer width parity depend on. `max-h-[45cqh]` is the slot's
  // preferred cap; `min-h-24` is the floor it shrinks to (no lower) once the
  // footer's own `max-h-[calc(100cqh-2rem)]` (ChatThread.tsx) squeezes it
  // below that — `overflow-y-auto` zeroes flexbox's automatic minimum, so
  // without an explicit floor the slot would compress to 0px under a tall
  // composer draft. `shrink-[100]` gives the slot first claim on any
  // shrinkage the footer needs, ahead of the composer wrapper's plain
  // default (#336 round 3) — without it, a squeeze shrinks both
  // proportionally instead of the composer only compressing once the slot
  // is already pinned at its floor. Neither cap is pinnable in full here
  // because the thread tests stub `ThreadPrimitive` entirely — the real
  // geometry (both caps engaging against a live container, the edges
  // lining up while the slot scrolls, and the composer's bottom edge never
  // painting past the pane) is verified live by the Playwright assertions
  // in gates.spec.ts. Dropping `[scrollbar-width:none]` costs 8px of card
  // width off the composer's edge whenever the slot actually scrolls (see
  // the plan's fact 8).
  it('carries the slot/scroll/cap class contract the height cap and width parity depend on', () => {
    mockFront.mockReturnValue({ front: permissionEntry, reply });
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toHaveClass('overflow-y-auto');
    expect(slot).toHaveClass('[scrollbar-width:none]');
    expect(slot).toHaveClass('max-h-[45cqh]');
    expect(slot).toHaveClass('min-h-24');
    expect(slot).toHaveClass('shrink-[100]');
  });
});
