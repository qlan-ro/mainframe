/**
 * ChatGateMount — behavior tests.
 *
 * Strategy:
 *  - The queue hook (`useGateQueue`) and the delegated-task probes are mocked —
 *    the real gate components are used so that routing
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
import type { AdapterInfo, ExecutionMode, PermissionOption } from '@qlan-ro/mainframe-types';
import { resetAdapters, seedAdapters } from '@/store/adapters';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';

vi.mock('../use-gate-queue', () => ({ useGateQueue: vi.fn() }));
vi.mock('../DelegatedGateProbes', () => ({ DelegatedGateProbes: () => null }));
// Arming is GateGuard.test.tsx's; here every gate answers at once.
vi.mock('../GateGuard', () => ({ GateGuard: ({ children }: { children: React.ReactNode }) => children }));
import { useGateQueue, type GateQueue } from '../use-gate-queue';
import { ChatGateMount } from '../ChatGateMount';
import { installGateLayout } from './gate-layout';

const mockQueue = vi.mocked(useGateQueue);

/** The queue the mount reads: `front` asking through `reply`, `more` waiting behind it. */
function queue(
  front: ChatPermissionEntry | undefined,
  replyFn: unknown = reply,
  extra: {
    adapterId?: string;
    mode?: ExecutionMode;
    more?: number;
    from?: NonNullable<GateQueue['front']>['from'];
  } = {},
): GateQueue {
  return {
    front: front && {
      key: `chat-1:${front.requestId}`,
      chatId: 'chat-1',
      entry: front,
      reply: replyFn as never,
      adapterId: extra.adapterId,
      mode: extra.mode,
      from: extra.from ?? null,
    },
    more: extra.more ?? 0,
    waitingCalls: new Set(),
  };
}

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

const permissionEntry = entry('Bash', { command: 'ls' });
const askEntry = entry('AskUserQuestion', { questions: [{ question: 'Pick', options: [{ label: 'A' }] }] });
const planEntry = entry('ExitPlanMode', { plan: '1. step' });
const synthesizedAskEntry: ChatPermissionEntry = { ...askEntry, synthesizedRequest: true };

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
    installGateLayout();
    // clearAllMocks does not drop a mockReturnValue, so each case restates it.
    resetAdapters();
  });

  // --- Behavior 1: front undefined → renders nothing ---

  it('renders nothing when front is undefined', () => {
    mockQueue.mockReturnValue(queue(undefined));
    const { container } = wrap(<ChatGateMount />);
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  // --- Behavior 2: AskUserQuestion → question gate only ---

  it('renders chat-question-gate and only that gate when toolName is AskUserQuestion', () => {
    mockQueue.mockReturnValue(queue(askEntry));
    wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-question-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
  });

  // --- Behavior 3: ExitPlanMode → plan gate only ---

  it('renders chat-plan-gate and only that gate when toolName is ExitPlanMode', () => {
    mockQueue.mockReturnValue(queue(planEntry));
    wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-plan-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
  });

  // --- Behavior 4: unknown toolName → permission gate only ---

  it('renders chat-permission-gate and only that gate when toolName is Bash (unknown to gate router)', () => {
    mockQueue.mockReturnValue(queue(permissionEntry));
    wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-permission-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
  });

  // --- A synthesized request (no daemon _meta) always renders the generic
  // options card, even for a toolName the router would otherwise dispatch to
  // a rich Plan/AskUserQuestion card (spec decision 27) ---

  it('routes a synthesized AskUserQuestion entry to chat-permission-gate, not chat-question-gate', () => {
    mockQueue.mockReturnValue(queue(synthesizedAskEntry));
    wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-permission-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
  });

  // --- Behavior 5: reply forwarded to PermissionGate's chosen-option action ---

  it('forwards the hook reply fn to PermissionGate — the Reject option calls reply with the deny ControlResponse', () => {
    const localReply = vi.fn();
    mockQueue.mockReturnValue(queue(permissionEntry, localReply));
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
    mockQueue.mockReturnValue(queue(planEntry));
    const { container, rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    mockQueue.mockReturnValue(queue(undefined));
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('unmounts the permission gate once an option answer clears the queue front', () => {
    mockQueue.mockReturnValue(queue(permissionEntry));
    const { container, rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-permission-option-allow-once'));

    mockQueue.mockReturnValue(queue(undefined));
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('still routes AskUserQuestion and permission gates by toolName after a plan gate was answered', () => {
    mockQueue.mockReturnValue(queue(planEntry));
    const { rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    mockQueue.mockReturnValue(queue(askEntry));
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-question-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();

    mockQueue.mockReturnValue(queue(permissionEntry));
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
    mockQueue.mockReturnValue(queue(planEntry, reply, { adapterId: 'claude' }));

    wrap(<ChatGateMount />);

    expect(screen.getByTestId('chat-plan-execmode-auto')).toBeInTheDocument();
  });

  it('omits the Auto exec-mode segment when the chat adapter does not advertise autoMode', () => {
    seedAdapters([adapter('codex', { planMode: true })]);
    mockQueue.mockReturnValue(queue(planEntry, reply, { adapterId: 'codex' }));

    wrap(<ChatGateMount />);

    expect(screen.getByTestId('chat-plan-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-execmode-auto')).toBeNull();
  });

  // --- Behavior 9: the pinned-slot wrapper ---

  it('wraps a permission gate in the chat-thread-gate-slot', () => {
    mockQueue.mockReturnValue(queue(permissionEntry));
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toContainElement(screen.getByTestId('chat-permission-gate'));
    // An Activity row that needs you finds the request by this.
    expect(slot).toHaveAttribute('data-chat-gate');
  });

  it('wraps an AskUserQuestion gate in the chat-thread-gate-slot', () => {
    mockQueue.mockReturnValue(queue(askEntry));
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toContainElement(screen.getByTestId('chat-question-gate'));
  });

  it('wraps a plan gate in the chat-thread-gate-slot', () => {
    mockQueue.mockReturnValue(queue(planEntry));
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toContainElement(screen.getByTestId('chat-plan-gate'));
  });

  it('renders no slot and an empty container when front is undefined', () => {
    mockQueue.mockReturnValue(queue(undefined));
    const { container } = wrap(<ChatGateMount />);

    expect(screen.queryByTestId('chat-thread-gate-slot')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('re-mounts the slot with the same gate after the front clears and returns', () => {
    mockQueue.mockReturnValue(queue(permissionEntry));
    const { rerender } = wrap(<ChatGateMount />);
    expect(screen.getByTestId('chat-thread-gate-slot')).toContainElement(screen.getByTestId('chat-permission-gate'));

    mockQueue.mockReturnValue(queue(undefined));
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('chat-thread-gate-slot')).toBeNull();

    mockQueue.mockReturnValue(queue(permissionEntry));
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-thread-gate-slot')).toContainElement(screen.getByTestId('chat-permission-gate'));
  });

  // Class-string regression check only: this pins the tokens the height cap
  // and the composer width parity depend on. `max-h-[45vh]` is the slot's
  // preferred cap; `min-h-0` is the floor it shrinks to (no lower) once the
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
  // in gates.spec.ts. Overlay scrollbars (S3) take no width, so the
  // edges line up whether or not the slot scrolls.
  it('carries the slot/scroll/cap class contract the height cap and width parity depend on', () => {
    mockQueue.mockReturnValue(queue(permissionEntry));
    wrap(<ChatGateMount />);

    const slot = screen.getByTestId('chat-thread-gate-slot');
    expect(slot).toHaveClass('overflow-y-auto');
    expect(slot).toHaveClass('max-h-[45vh]');
    expect(slot).toHaveClass('min-h-[min(6rem,45vh)]');
    expect(slot).toHaveClass('shrink-[100]');
  });
});

describe('ChatGateMount — the queue (G5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAdapters();
  });

  it('tells the front gate who asks and how many wait behind it', () => {
    mockQueue.mockReturnValue(
      queue(permissionEntry, reply, {
        more: 2,
        from: { name: 'code-reviewer', title: 'Review the diff', matches: () => false },
      }),
    );

    wrap(<ChatGateMount />);

    expect(screen.getByText('Permission required · code-reviewer · 2 more waiting')).toBeInTheDocument();
    expect(screen.getByText('Review the diff')).toBeInTheDocument();
  });

  it('shows a plain eyebrow for the session’s own request with nothing behind it', () => {
    mockQueue.mockReturnValue(queue(permissionEntry));

    wrap(<ChatGateMount />);

    expect(screen.getByText('Permission required')).toBeInTheDocument();
  });

  it('preselects the asking chat’s permission mode on a plan gate', () => {
    mockQueue.mockReturnValue(queue(planEntry, reply, { mode: 'acceptEdits' }));

    wrap(<ChatGateMount />);

    expect(screen.getByTestId('chat-plan-execmode-acceptEdits')).toHaveAttribute('aria-pressed', 'true');
  });
});
