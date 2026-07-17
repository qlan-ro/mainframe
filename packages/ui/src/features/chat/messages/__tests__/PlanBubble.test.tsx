/**
 * PlanBubble — render tests for the shared "Implementing plan" card.
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
  it('renders the root, the "Implementing plan" heading, and the "Approved" pill', () => {
    render(<PlanBubble plan="Some plan text" />);
    expect(screen.getByTestId('chat-plan-bubble')).toBeInTheDocument();
    expect(screen.getByText('Implementing plan')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('renders the plan markdown body', () => {
    render(<PlanBubble plan={'# Heading Text\n\nParagraph body'} />);
    expect(screen.getByText('Heading Text')).toBeInTheDocument();
    expect(screen.getByText('Paragraph body')).toBeInTheDocument();
  });
});
