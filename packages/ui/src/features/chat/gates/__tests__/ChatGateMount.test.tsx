/**
 * ChatGateMount — behavior tests.
 *
 * Strategy:
 *  - Only `useChatPermissionFront` is mocked — the real gate components are
 *    used so that routing decisions are verified through observable DOM state
 *    (data-testids), not through inspecting which JSX branch the component
 *    chose.
 *  - `useAuiState` (isRunning) is also mocked — ChatGateMount reads it to
 *    know whether an approved plan is still executing after the gate itself
 *    has been optimistically dropped from the permission queue.
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
 *  6. Approving a plan, then having `front` drop out (optimistic queue-drop)
 *     while the run is still active, keeps `chat-plan-running-footer` mounted
 *     instead of unmounting the whole gate.
 *  7. Once the run actually ends, the retained running footer is dropped too.
 *  8. Rejecting/keep-planning (never approving) does NOT resurrect the footer
 *     once front drops, even while still running — retention is approve-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatPermissionFront: vi.fn(),
}));
vi.mock('@assistant-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@assistant-ui/react')>();
  return { ...actual, useAuiState: vi.fn().mockReturnValue(false) };
});
import { useChatPermissionFront } from '../../runtime/use-chat-thread-runtime';
import { useAuiState } from '@assistant-ui/react';
import { ChatGateMount } from '../ChatGateMount';

const mockFront = vi.mocked(useChatPermissionFront);
const mockIsRunning = vi.mocked(useAuiState);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const reply = vi.fn();

function entry(toolName: string, input: Record<string, unknown>): ChatPermissionEntry {
  return {
    requestId: 'r1',
    askedAt: 1,
    request: { requestId: 'r1', toolName, toolUseId: 'tu1', input, suggestions: [] },
  };
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
    mockIsRunning.mockReturnValue(false);
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

  // --- Behavior 5: reply forwarded to PermissionGate deny action ---

  it('forwards the hook reply fn to PermissionGate — deny click calls reply with the deny ControlResponse', () => {
    const localReply = vi.fn();
    mockFront.mockReturnValue({ front: permissionEntry, reply: localReply });
    wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-permission-deny'));

    expect(localReply).toHaveBeenCalledTimes(1);
    expect(localReply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'deny',
    });
  });

  // --- Behavior 6/7/8: running footer survives the optimistic gate-drop ---
  //
  // replyToPermission optimistically drops the entry from `permissions` (and
  // therefore `front`) the same tick Approve is clicked, well before the agent
  // finishes executing the plan. Simulates that by rerendering with
  // `front: undefined` right after the approve click, while `isRunning` stays
  // true (mirrors the daemon still running the approved plan).

  it('keeps chat-plan-running-footer mounted once front drops after approve, while the run is still active', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    mockIsRunning.mockReturnValue(true);
    const { rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    // Simulate the optimistic queue-drop: front goes away, run still active.
    mockFront.mockReturnValue({ front: undefined, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('chat-plan-running-footer')).toBeInTheDocument();
  });

  it('drops the retained running footer once the run actually ends', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    mockIsRunning.mockReturnValue(true);
    const { rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    mockFront.mockReturnValue({ front: undefined, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-plan-running-footer')).toBeInTheDocument();

    // The run ends — the retained footer must go away, not linger forever.
    mockIsRunning.mockReturnValue(false);
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('chat-plan-running-footer')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
  });

  // --- Regression: the daemon confirms the resumed run asynchronously, so
  // `isRunning` can still read `false` for one or more renders after the
  // optimistic queue-drop (front goes undefined) — before it flips true.
  // Gating the retained render on `approvedPlan != null && isRunning` (the
  // earlier fix) unmounts ChatGateMount entirely during that window (neither
  // `front` nor the isRunning-gated fallback holds), and remounting PlanGate
  // afterwards loses its local `approved` state — the card resets to the
  // pre-approval ActionRow instead of keeping the running footer. The render
  // must stay retained on `approvedPlan` alone, independent of `isRunning`.

  it('keeps the plan gate mounted (no reset) when front drops before isRunning has flipped true', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    mockIsRunning.mockReturnValue(false);
    const { rerender } = wrap(<ChatGateMount />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    // Optimistic queue-drop lands before the daemon confirms the run resumed.
    mockFront.mockReturnValue({ front: undefined, reply });
    mockIsRunning.mockReturnValue(false);
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('chat-plan-gate')).toBeInTheDocument();
    expect(screen.getByTestId('chat-plan-running-footer')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-approve')).toBeNull();

    // The daemon confirms the run resumed.
    mockIsRunning.mockReturnValue(true);
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-plan-running-footer')).toBeInTheDocument();

    // The run ends — now the retained gate is dropped.
    mockIsRunning.mockReturnValue(false);
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('chat-plan-running-footer')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
  });

  it('does not resurrect the footer for a plan that was rejected, not approved, once front drops', () => {
    mockFront.mockReturnValue({ front: planEntry, reply });
    mockIsRunning.mockReturnValue(true);
    const { rerender } = wrap(<ChatGateMount />);

    // Reject — never clicks Approve, so nothing should be retained.
    fireEvent.click(screen.getByTestId('chat-plan-reject'));

    mockFront.mockReturnValue({ front: undefined, reply });
    rerender(
      <TooltipProvider>
        <ChatGateMount />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId('chat-plan-running-footer')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
  });
});
