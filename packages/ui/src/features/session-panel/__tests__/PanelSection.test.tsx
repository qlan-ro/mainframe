/**
 * PanelSection — unit tests.
 *
 * The collapsible chrome the session card's Plan and Context sections wear.
 * Activity and Launch left this component in the stacked-panel rework — they
 * are PanelCards now — so the id type is 'plan' | 'context'.
 *
 * Behaviors covered:
 *  - the section and its toggle carry the id-scoped testids
 *  - clicking the header row toggles (the whole row is the trigger, not just
 *    the chevron)
 *  - the chevron rotates when open
 *  - the count badge is hidden when count is undefined, and renders 0 when the
 *    caller genuinely means zero
 *  - the body is rendered when open and hidden when closed
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListTodo } from 'lucide-react';
import { PanelSection } from '../PanelSection';

function renderSection(props: Partial<Parameters<typeof PanelSection>[0]> = {}) {
  const onToggle = vi.fn();
  render(
    <PanelSection id="plan" label="Plan" icon={ListTodo} open onToggle={onToggle} {...props}>
      <div data-testid="section-body">body</div>
    </PanelSection>,
  );
  return { onToggle };
}

describe('PanelSection', () => {
  it('carries the id-scoped testids', () => {
    renderSection();
    expect(screen.getByTestId('session-panel-section-plan')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-section-toggle-plan')).toBeInTheDocument();
  });

  it('scopes the testids to the section it was given', () => {
    renderSection({ id: 'context', label: 'Context' });
    expect(screen.getByTestId('session-panel-section-context')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-section-toggle-context')).toHaveTextContent('Context');
  });

  it('toggles from the whole header row', () => {
    const { onToggle } = renderSection();
    fireEvent.click(screen.getByTestId('session-panel-section-toggle-plan'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('rotates the chevron when open', () => {
    renderSection({ open: true });
    expect(screen.getByTestId('session-panel-section-toggle-plan').querySelector('.lucide-chevron-down')).toHaveClass(
      'rotate-180',
    );
  });

  it('leaves the chevron unrotated when closed', () => {
    renderSection({ open: false });
    expect(
      screen.getByTestId('session-panel-section-toggle-plan').querySelector('.lucide-chevron-down'),
    ).not.toHaveClass('rotate-180');
  });

  it('renders no count badge when count is undefined', () => {
    renderSection();
    expect(screen.getByTestId('session-panel-section-toggle-plan')).toHaveTextContent('Plan');
    expect(screen.getByTestId('session-panel-section-toggle-plan').querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('renders the count badge when a count is given, including zero', () => {
    renderSection({ count: 0 });
    expect(
      screen.getByTestId('session-panel-section-toggle-plan').querySelector('[data-slot="badge"]'),
    ).toHaveTextContent('0');
  });

  it('shows the body when open and hides it when closed', () => {
    const { unmount } = render(
      <PanelSection id="context" label="Context" icon={ListTodo} open onToggle={vi.fn()}>
        <div data-testid="section-body">body</div>
      </PanelSection>,
    );
    expect(screen.getByTestId('section-body')).toBeInTheDocument();
    unmount();

    render(
      <PanelSection id="context" label="Context" icon={ListTodo} open={false} onToggle={vi.fn()}>
        <div data-testid="section-body">body</div>
      </PanelSection>,
    );
    expect(screen.queryByTestId('section-body')).toBeNull();
  });
});
