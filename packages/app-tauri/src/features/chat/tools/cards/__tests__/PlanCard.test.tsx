/**
 * PlanCard — behavior tests.
 *
 * Strategy:
 *  - No external hook mocks needed: PlanCard does not call useChatId or any
 *    assistant-ui hooks — it only reads from its props.
 *  - Wrap renders in TooltipProvider for Radix Tooltip compatibility.
 *  - Assert hardcoded expected values; never recompute card logic.
 *
 * Behaviors covered:
 *  - done state (string result): label visible, collapsible enabled, body
 *    text rendered after click
 *  - pending state (result === undefined): label visible, collapsible
 *    disabled, no body
 *  - error state (isError=true + string result): card renders (border tokens
 *    are CSS-only, verified via absence of animate-pulse)
 *  - XML sentinel stripping in the plan body
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PlanCard } from '../PlanCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

function makePart(overrides: { result?: unknown; isError?: boolean; toolCallId?: string }) {
  return {
    type: 'tool-call' as const,
    toolName: 'ExitPlanMode',
    toolCallId: overrides.toolCallId ?? 'tc-plan-1',
    args: {},
    argsText: '',
    result: overrides.result,
    isError: overrides.isError,
    status: { type: 'complete' as const },
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
  };
}

function renderCard(props: ReturnType<typeof makePart>) {
  return render(
    <TooltipProvider>
      <PlanCard {...props} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Root element ---

  it('renders the card root with data-testid="chat-plan-card"', () => {
    renderCard(makePart({}));
    expect(screen.getByTestId('chat-plan-card')).toBeInTheDocument();
  });

  // --- Header label always visible ---

  it('always renders the "Updated plan" label', () => {
    renderCard(makePart({}));
    expect(screen.getByTestId('chat-plan-label')).toHaveTextContent('Updated plan');
  });

  it('renders the trigger with data-testid="chat-plan-trigger"', () => {
    renderCard(makePart({}));
    expect(screen.getByTestId('chat-plan-trigger')).toBeInTheDocument();
  });

  // --- Pending state (result === undefined) ---

  it('renders a pulsing status dot when result is undefined (pending)', () => {
    renderCard(makePart({ result: undefined }));
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('trigger is disabled when result is undefined', () => {
    renderCard(makePart({ result: undefined }));
    expect(screen.getByTestId('chat-plan-trigger')).toHaveAttribute('data-disabled');
  });

  it('does not render the plan body when result is undefined', () => {
    renderCard(makePart({ result: undefined }));
    expect(screen.queryByTestId('chat-plan-body')).not.toBeInTheDocument();
  });

  // --- Done state (string result) ---

  it('does NOT render a pulsing dot when result is a string', () => {
    renderCard(makePart({ result: '1. Implement feature\n2. Write tests', isError: false }));
    expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('trigger is not disabled when result is a non-empty string', () => {
    renderCard(makePart({ result: 'Step 1: done', isError: false }));
    expect(screen.getByTestId('chat-plan-trigger')).not.toHaveAttribute('data-disabled');
  });

  it('clicking the trigger reveals the plan body with the result text', () => {
    renderCard(makePart({ result: 'Step 1: implement\nStep 2: test', isError: false }));
    fireEvent.click(screen.getByTestId('chat-plan-trigger'));
    const body = screen.getByTestId('chat-plan-body');
    expect(body).toHaveTextContent('Step 1: implement');
    expect(body).toHaveTextContent('Step 2: test');
  });

  it('plan body is not visible before the trigger is clicked (defaultOpen=false)', () => {
    renderCard(makePart({ result: 'The plan is here', isError: false }));
    // Radix Collapsible hides content until opened
    expect(screen.queryByTestId('chat-plan-body')).not.toBeInTheDocument();
  });

  it('clicking the trigger twice collapses the body again', () => {
    renderCard(makePart({ result: 'Plan text', isError: false }));
    const trigger = screen.getByTestId('chat-plan-trigger');
    fireEvent.click(trigger);
    expect(screen.getByTestId('chat-plan-body')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByTestId('chat-plan-body')).not.toBeInTheDocument();
  });

  // --- XML sentinel stripping ---

  it('strips <tool_use_error> sentinel tags from the plan body text', () => {
    renderCard(
      makePart({
        result: '<tool_use_error>Plan failed to parse</tool_use_error>',
        isError: true,
      }),
    );
    fireEvent.click(screen.getByTestId('chat-plan-trigger'));
    const body = screen.getByTestId('chat-plan-body');
    expect(body).toHaveTextContent('Plan failed to parse');
    expect(body).not.toHaveTextContent('<tool_use_error>');
  });

  it('strips <error> sentinel tags from the plan body text', () => {
    renderCard(
      makePart({
        result: '<error>No plan mode active</error>',
        isError: true,
      }),
    );
    fireEvent.click(screen.getByTestId('chat-plan-trigger'));
    const body = screen.getByTestId('chat-plan-body');
    expect(body).toHaveTextContent('No plan mode active');
    expect(body).not.toHaveTextContent('<error>');
  });

  // --- Non-string result falls through (treated as no result) ---

  it('does not render the body when result is an object (not a string)', () => {
    renderCard(makePart({ result: { content: 'something' }, isError: false }));
    // PlanCard only handles string results; objects produce no body
    expect(screen.queryByTestId('chat-plan-body')).not.toBeInTheDocument();
  });

  // --- Error state ---

  it('renders without crashing when isError=true and result is a plain string', () => {
    renderCard(makePart({ result: 'error text', isError: true }));
    expect(screen.getByTestId('chat-plan-card')).toBeInTheDocument();
  });
});
