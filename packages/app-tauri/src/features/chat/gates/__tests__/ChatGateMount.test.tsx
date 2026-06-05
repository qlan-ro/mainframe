/**
 * ChatGateMount — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - `ChatGateMount` does not exist yet; these tests drive its API contract.
 *  - Only `useChatPermissionFront` is mocked — the real gate components are
 *    used so that routing decisions are verified through observable DOM state
 *    (data-testids), not through inspecting which JSX branch the component
 *    chose.
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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatPermissionFront: vi.fn(),
}));
import { useChatPermissionFront } from '../../runtime/use-chat-thread-runtime';
import { ChatGateMount } from '../ChatGateMount';

const mockFront = vi.mocked(useChatPermissionFront);

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
  });

  // --- Behavior 1: front undefined → renders nothing ---

  it('renders nothing when front is undefined', () => {
    mockFront.mockReturnValue({ front: undefined, reply });
    const { container } = wrap(<ChatGateMount />);
    expect(screen.queryByTestId('chat-question-gate')).toBeNull();
    expect(screen.queryByTestId('chat-plan-gate')).toBeNull();
    expect(screen.queryByTestId('chat-permission-gate')).toBeNull();
    expect(container.firstChild).toBeEmptyDOMElement();
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
    expect(localReply).toHaveBeenCalledWith('r1', {
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'deny',
    });
  });
});
