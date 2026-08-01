/**
 * PlanBubble — render tests for the shared "approved plan" durable record.
 *
 * Strategy:
 *  - Pure props component; no assistant-ui hooks or context needed.
 *  - react-markdown renders in jsdom without mocking (see ReviewCommentCard.test.tsx).
 *  - All expected values are hardcoded — no markdown/regex logic is
 *    recomputed here.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanBubble } from '../PlanBubble';

describe('PlanBubble', () => {
  it('renders the plan markdown inside the resolved gate shell', () => {
    render(<PlanBubble plan={'# Heading Text\n\nParagraph body'} />);
    const bubble = screen.getByTestId('chat-plan-bubble');
    expect(bubble).toBeInTheDocument();
    expect(screen.getByTestId('gate-head-tile')).toBeInTheDocument();
    expect(bubble.className).toContain('border-border');
    expect(bubble.getAttribute('style') ?? '').not.toContain('box-shadow');
    expect(screen.getByText('Heading Text')).toBeInTheDocument();
    expect(screen.getByText('Paragraph body')).toBeInTheDocument();
  });

  it('shows the Plan eyebrow, the Implementing plan title and the Approved pill', () => {
    render(<PlanBubble plan="Some plan text" />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Implementing plan')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('omits the execution-mode caption when no execution mode is passed', () => {
    render(<PlanBubble plan="Some plan text" />);
    expect(screen.queryByTestId('chat-plan-exec-mode')).not.toBeInTheDocument();
  });

  it('renders the execution-mode caption from the executionMode prop', () => {
    render(<PlanBubble plan="Some plan text" executionMode="acceptEdits" />);
    expect(screen.getByTestId('chat-plan-exec-mode')).toHaveTextContent('Auto-edits');
  });

  it.each([
    { executionMode: 'acceptEdits' as const, clearedContext: true, expected: 'Auto-edits · context cleared' },
    { executionMode: undefined, clearedContext: true, expected: null },
  ])(
    'appends the cleared-context suffix only for the clear-context path ($executionMode, $clearedContext)',
    ({ executionMode, clearedContext, expected }) => {
      render(<PlanBubble plan="Some plan text" executionMode={executionMode} clearedContext={clearedContext} />);
      if (expected === null) {
        expect(screen.queryByTestId('chat-plan-exec-mode')).not.toBeInTheDocument();
      } else {
        expect(screen.getByTestId('chat-plan-exec-mode')).toHaveTextContent(expected);
      }
    },
  );

  it('drops the user-message card treatment', () => {
    render(<PlanBubble plan="Some plan text" />);
    const bubble = screen.getByTestId('chat-plan-bubble');
    expect(bubble.className).not.toContain('max-w-[530px]');
    expect(bubble.className).not.toContain('border-mf-um-edge');
    const style = bubble.getAttribute('style') ?? '';
    expect(style).not.toContain('--mf-um-card');
    expect(style).not.toContain('--mf-shadow-user-card');
  });

  it('the plan card wraps long tokens instead of clipping them', () => {
    render(<PlanBubble plan="Some plan text" />);
    const card = screen.getByTestId('chat-plan-bubble');
    expect(card.className).toContain('break-words');
    expect(card.className).not.toContain('overflow-hidden');
  });

  it('a long unbreakable token stays in the DOM', () => {
    render(<PlanBubble plan={'x'.repeat(200)} />);
    expect(screen.getByText('x'.repeat(200))).toBeInTheDocument();
  });
});
