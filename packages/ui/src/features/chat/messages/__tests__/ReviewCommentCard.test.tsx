/**
 * ReviewCommentCard — behavior tests.
 *
 * Strategy:
 *  - Pure props component; no assistant-ui hooks; no context mocking needed.
 *  - All expected values are hardcoded — no component logic is recomputed here.
 *  - react-markdown renders in jsdom (no mocking required for this pure component).
 *
 * Behaviors covered:
 *  RC1 — single comment: card root present; header shows basename; L43 label;
 *         code line present; body text present; no "2 comments" counter.
 *  RC2 — two comments: both section testids present; L51–53 en-dash label;
 *         header shows "2 comments".
 *  RC3 — empty code: no snippet block inside the section; body still shown.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ReviewCommentCard } from '../ReviewCommentCard';
import type { ReviewComment } from '../../view-model/parse-review-comment';

// ---------------------------------------------------------------------------
// RC1 — single comment
// ---------------------------------------------------------------------------

describe('ReviewCommentCard — single comment', () => {
  const singleReview: ReviewComment = {
    file: '/Users/x/app/globals.css',
    comments: [{ start: 43, code: '--mf-app-bg: #f4f4f2;', body: 'too bright' }],
  };

  it('renders the card root with data-testid="chat-user-review-comment"', () => {
    render(<ReviewCommentCard review={singleReview} />);
    expect(screen.getByTestId('chat-user-review-comment')).toBeTruthy();
  });

  it('shows the BASENAME "globals.css" in the header (not the full path)', () => {
    render(<ReviewCommentCard review={singleReview} />);
    expect(screen.getByText('globals.css')).toBeTruthy();
  });

  it('shows the full path as a tooltip when the filename span is hovered', async () => {
    const user = userEvent.setup();
    render(<ReviewCommentCard review={singleReview} />);
    // The filename span shows the basename; the full path is the Hint tooltip label.
    await user.hover(screen.getByText('globals.css'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('/Users/x/app/globals.css');
  });

  it('shows the "L43" range label', () => {
    render(<ReviewCommentCard review={singleReview} />);
    expect(screen.getByText('L43')).toBeTruthy();
  });

  it('shows the code line text "--mf-app-bg: #f4f4f2;"', () => {
    render(<ReviewCommentCard review={singleReview} />);
    expect(screen.getByText('--mf-app-bg: #f4f4f2;')).toBeTruthy();
  });

  it('shows the comment body "too bright"', () => {
    render(<ReviewCommentCard review={singleReview} />);
    expect(screen.getByText('too bright')).toBeTruthy();
  });

  it('does NOT show a "2 comments" counter for a single comment', () => {
    render(<ReviewCommentCard review={singleReview} />);
    expect(screen.queryByText('2 comments')).toBeNull();
  });

  it('renders the section with testid "chat-user-review-comment-L43"', () => {
    render(<ReviewCommentCard review={singleReview} />);
    expect(screen.getByTestId('chat-user-review-comment-L43')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RC2 — two comments
// ---------------------------------------------------------------------------

describe('ReviewCommentCard — two comments', () => {
  const twoReview: ReviewComment = {
    file: '/Users/x/app/globals.css',
    comments: [
      { start: 43, code: '--mf-app-bg: #f4f4f2;', body: 'too bright' },
      { start: 51, end: 53, code: '.panel {\n  width: 200px;\n}', body: 'wrong width' },
    ],
  };

  it('renders a section with testid "chat-user-review-comment-L43"', () => {
    render(<ReviewCommentCard review={twoReview} />);
    expect(screen.getByTestId('chat-user-review-comment-L43')).toBeTruthy();
  });

  it('renders a section with testid "chat-user-review-comment-L51"', () => {
    render(<ReviewCommentCard review={twoReview} />);
    expect(screen.getByTestId('chat-user-review-comment-L51')).toBeTruthy();
  });

  it('shows the "L51–53" range label (en-dash U+2013, not a hyphen)', () => {
    render(<ReviewCommentCard review={twoReview} />);
    // U+2013 is the en-dash — the same character used by code-snippet.rangeLabel
    expect(screen.getByText('L51–53')).toBeTruthy();
  });

  it('shows "2 comments" in the header', () => {
    render(<ReviewCommentCard review={twoReview} />);
    expect(screen.getByText('2 comments')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RC3 — empty code: no snippet block; body still shown
// ---------------------------------------------------------------------------

describe('ReviewCommentCard — empty code string', () => {
  const emptyCodeReview: ReviewComment = {
    file: '/project/a.ts',
    comments: [{ start: 7, code: '', body: 'just a note' }],
  };

  it('does not render line-number cells when code is empty', () => {
    render(<ReviewCommentCard review={emptyCodeReview} />);
    // When code is '' the lines array is [] and SnippetLines is never rendered,
    // so there is no element with text "7" (the line number).
    expect(screen.queryByText('7')).toBeNull();
  });

  it('still renders the comment body when code is empty', () => {
    render(<ReviewCommentCard review={emptyCodeReview} />);
    expect(screen.getByText('just a note')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RC4 — long snippet (> 7 lines): clamp + "Show all N lines" expander (7.8)
// ---------------------------------------------------------------------------

describe('ReviewCommentCard — long snippet clamp (7.8)', () => {
  const longCode = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  const longReview: ReviewComment = {
    file: '/project/big.ts',
    comments: [{ start: 1, code: longCode, body: 'refactor this' }],
  };

  it('renders the "Show all 10 lines" expander for a 10-line snippet', () => {
    render(<ReviewCommentCard review={longReview} />);
    expect(screen.getByTestId('chat-user-snippet-expand')).toHaveTextContent('Show all 10 lines');
  });

  it('does not render an expander for a short (<=7 line) snippet', () => {
    const shortReview: ReviewComment = {
      file: '/project/small.ts',
      comments: [{ start: 1, code: 'a\nb\nc', body: 'ok' }],
    };
    render(<ReviewCommentCard review={shortReview} />);
    expect(screen.queryByTestId('chat-user-snippet-expand')).not.toBeInTheDocument();
  });
});
