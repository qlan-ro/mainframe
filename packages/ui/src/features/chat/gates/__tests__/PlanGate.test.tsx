/**
 * PlanGate — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - No source module exists yet; these tests drive the API contract for
 *    the PlanGate component.
 *  - Component is fully prop-driven: no hooks, no context beyond TooltipProvider.
 *  - All expected values are hardcoded; ControlResponse objects are the contract
 *    and are never recomputed from the component under test.
 *  - Wrap renders in TooltipProvider for Radix compatibility.
 *
 * Behaviors covered:
 *  1. Root data-testid renders and plan text from request.input.plan is visible.
 *  2. Approve with no interaction → reply with default executionMode, no clearContext.
 *  3. Select yolo exec-mode, then approve → reply with executionMode:'yolo'.
 *  4. Check clear-context, then approve (default mode) → reply with clearContext:true.
 *  5. Feedback textarea hidden initially; Keep-planning reveals it; Send-feedback
 *     disabled while empty; typing trimmed text and sending → reply with deny+message.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import { PlanGate } from '../PlanGate';
import type { ReplyFn } from '../gate-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeEntry(): ChatPermissionEntry {
  return {
    requestId: 'r1',
    askedAt: 1,
    request: {
      requestId: 'r1',
      toolName: 'ExitPlanMode',
      toolUseId: 'tu1',
      input: { plan: '1. First step\n2. Second step' },
      suggestions: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanGate', () => {
  let reply: Mock<ReplyFn>;

  beforeEach(() => {
    reply = vi.fn<ReplyFn>();
  });

  // --- Behavior 1: root renders and plan text is visible ---

  it('renders chat-plan-gate root and shows plan text from request.input.plan', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    expect(screen.getByTestId('chat-plan-gate')).toBeInTheDocument();
    expect(screen.getByText(/First step/)).toBeInTheDocument();
    expect(screen.getByText(/Second step/)).toBeInTheDocument();
  });

  // --- Behavior 2: approve with default exec-mode and unchecked clear-context ---

  it('approve with no other interaction calls reply with executionMode default and no clearContext key', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      updatedInput: makeEntry().request.input,
      executionMode: 'default',
    });
  });

  // --- Behavior 3: select yolo then approve ---

  it('selecting yolo exec-mode then approving calls reply with executionMode yolo', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-execmode-yolo'));
    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      updatedInput: makeEntry().request.input,
      executionMode: 'yolo',
    });
  });

  // --- Behavior 4: check clear-context then approve with default exec-mode ---

  it('checking clear-context then approving with default mode calls reply with clearContext true', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-clear-context'));
    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      updatedInput: makeEntry().request.input,
      executionMode: 'default',
      clearContext: true,
    });
  });

  // --- Behavior 5: keep-planning flow with trimmed feedback ---

  it('feedback textarea is hidden initially; keep-planning shows it; send-feedback disabled when empty; typing and sending calls reply with deny and trimmed message', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    // Textarea not present before Keep planning is clicked
    expect(screen.queryByTestId('chat-plan-feedback-input')).not.toBeInTheDocument();

    // Reveal the textarea
    fireEvent.click(screen.getByTestId('chat-plan-keep-planning'));

    const textarea = screen.getByTestId('chat-plan-feedback-input');
    expect(textarea).toBeInTheDocument();

    // Send-feedback is disabled while textarea is empty
    const sendBtn = screen.getByTestId('chat-plan-send-feedback');
    expect(sendBtn).toBeDisabled();

    // Type text with leading/trailing whitespace
    fireEvent.change(textarea, { target: { value: '  please revise  ' } });

    // Send-feedback is enabled once there is non-blank content
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'deny',
      message: 'please revise',
    });
  });

  // --- Behavior 6: reject sends bare deny immediately, no feedback textarea ---

  it('clicking Reject calls reply once with behavior deny and no message property', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-reject'));

    expect(reply).toHaveBeenCalledTimes(1);
    const arg = reply.mock.calls[0]![0];
    expect(arg).toMatchObject({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'deny',
    });
    expect(arg).not.toHaveProperty('message');
  });

  it('clicking Reject does not open the feedback textarea (reject is immediate, not revise)', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-reject'));

    expect(screen.queryByTestId('chat-plan-feedback-input')).not.toBeInTheDocument();
  });

  // --- Behavior 8: approve shows persistent running footer with pulsing dot ---

  it('after approving, hides action row and shows running footer with pulsing dot and mode text', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    // Action row (Approve button) is gone
    expect(screen.queryByTestId('chat-plan-approve')).not.toBeInTheDocument();

    // Running footer is visible
    const footer = screen.getByTestId('chat-plan-running-footer');
    expect(footer).toBeInTheDocument();

    // Footer contains the execution mode text
    expect(footer).toHaveTextContent(/Executing in/);
    expect(footer).toHaveTextContent(/Interactive/);
  });

  it('running footer pulsing dot is present after approve', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    const footer = screen.getByTestId('chat-plan-running-footer');
    // The pulsing dot is a span with tw-pulse animation class
    const dot = footer.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('running footer uses destructive dot color in yolo exec-mode', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-plan-execmode-yolo'));
    fireEvent.click(screen.getByTestId('chat-plan-approve'));

    const footer = screen.getByTestId('chat-plan-running-footer');
    expect(footer).toHaveTextContent(/Unattended/);
    // Dot should have the destructive class for yolo mode
    const dot = footer.querySelector('.bg-destructive');
    expect(dot).toBeInTheDocument();
  });

  // --- Behavior 7: keep-planning Cancel returns to the approve panel ---

  it('clicking Keep planning then Cancel returns to the approve panel without calling reply', () => {
    wrap(<PlanGate entry={makeEntry()} reply={reply} />);

    // Initially the approve button is visible and the feedback textarea is not.
    expect(screen.getByTestId('chat-plan-approve')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-feedback-input')).not.toBeInTheDocument();

    // Reveal the revise panel.
    fireEvent.click(screen.getByTestId('chat-plan-keep-planning'));

    expect(screen.getByTestId('chat-plan-feedback-input')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-approve')).not.toBeInTheDocument();

    // Cancel returns to the approve panel.
    fireEvent.click(screen.getByTestId('chat-plan-revise-cancel'));

    expect(screen.getByTestId('chat-plan-approve')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-feedback-input')).not.toBeInTheDocument();

    // reply must NOT have been called.
    expect(reply).not.toHaveBeenCalled();
  });
});
