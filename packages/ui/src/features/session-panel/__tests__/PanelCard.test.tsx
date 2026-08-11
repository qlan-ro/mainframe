/**
 * PanelCard — unit tests.
 *
 * The glass card every stacked panel wears: a header row (icon, label, optional
 * count, close X) over the panel's own scroll region.
 *
 * Behaviors covered:
 *  - the card and its close button carry the id-scoped testids
 *  - the label renders, and the close button is named for a screen reader
 *  - the count badge is hidden when count is undefined, and renders 0 when the
 *    caller genuinely means zero
 *  - clicking the X calls onClose
 *  - children render in the body
 *  - the height cap is the default unless the caller overrides it
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { PanelCard } from '../PanelCard';

function renderCard(props: Partial<Parameters<typeof PanelCard>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <PanelCard id="activity" label="Background Activity" icon={Activity} onClose={onClose} {...props}>
      <div data-testid="card-body">body</div>
    </PanelCard>,
  );
  return { onClose };
}

describe('PanelCard', () => {
  it('carries the id-scoped testids', () => {
    renderCard();
    expect(screen.getByTestId('session-panel-card-activity')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-card-close-activity')).toBeInTheDocument();
  });

  it('scopes the testids to the panel it was given', () => {
    renderCard({ id: 'tasks', label: 'Tasks' });
    expect(screen.getByTestId('session-panel-card-tasks')).toHaveTextContent('Tasks');
    expect(screen.getByTestId('session-panel-card-close-tasks')).toBeInTheDocument();
  });

  it('names the close button for a screen reader — it is glyph-only', () => {
    renderCard();
    expect(screen.getByTestId('session-panel-card-close-activity')).toHaveAttribute(
      'aria-label',
      'Close Background Activity',
    );
  });

  it('closes on a click of the X', () => {
    const { onClose } = renderCard();
    fireEvent.click(screen.getByTestId('session-panel-card-close-activity'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no count badge when count is undefined', () => {
    renderCard();
    expect(screen.getByTestId('session-panel-card-activity').querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('renders the count badge when a count is given, including zero', () => {
    renderCard({ count: 3 });
    expect(screen.getByTestId('session-panel-card-activity').querySelector('[data-slot="badge"]')).toHaveTextContent(
      '3',
    );
  });

  it('renders a zero the caller genuinely asked for', () => {
    renderCard({ count: 0 });
    expect(screen.getByTestId('session-panel-card-activity').querySelector('[data-slot="badge"]')).toHaveTextContent(
      '0',
    );
  });

  it('renders its children in the body', () => {
    renderCard();
    expect(screen.getByTestId('card-body')).toBeInTheDocument();
  });

  it('caps its own height so a long stack degrades card by card', () => {
    renderCard();
    expect(screen.getByTestId('session-panel-card-activity')).toHaveClass('max-h-96', 'overflow-hidden');
  });

  it('lets the caller override the cap — the session card runs taller', () => {
    renderCard({ className: 'max-h-[36rem]' });
    const card = screen.getByTestId('session-panel-card-activity');
    expect(card).toHaveClass('max-h-[36rem]');
    expect(card).not.toHaveClass('max-h-96');
  });

  it('opts back into pointer events — the stack root is click-through', () => {
    renderCard();
    expect(screen.getByTestId('session-panel-card-activity')).toHaveClass('pointer-events-auto');
  });
});
