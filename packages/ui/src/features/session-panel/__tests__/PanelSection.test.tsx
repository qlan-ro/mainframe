/**
 * PanelSection — unit tests.
 *
 * Behaviors covered:
 *  - the section and its toggle carry the id-scoped testids
 *  - clicking the header row toggles (the whole row is the trigger, not just
 *    the chevron)
 *  - the chevron rotates when open
 *  - the count badge is hidden when count is undefined, and renders 0 when the
 *    caller genuinely means zero
 *  - the body is rendered when open and hidden when closed
 *  - sectionRef receives the section element, for the panel's scroll-to
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { PanelSection } from '../PanelSection';

function renderSection(props: Partial<Parameters<typeof PanelSection>[0]> = {}) {
  const onToggle = vi.fn();
  render(
    <PanelSection id="activity" label="Background Activity" icon={Activity} open onToggle={onToggle} {...props}>
      <div data-testid="section-body">body</div>
    </PanelSection>,
  );
  return { onToggle };
}

describe('PanelSection', () => {
  it('carries the id-scoped testids', () => {
    renderSection();
    expect(screen.getByTestId('session-panel-section-activity')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-section-toggle-activity')).toBeInTheDocument();
  });

  it('toggles from the whole header row', () => {
    const { onToggle } = renderSection();
    fireEvent.click(screen.getByTestId('session-panel-section-toggle-activity'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('rotates the chevron when open', () => {
    renderSection({ open: true });
    expect(
      screen.getByTestId('session-panel-section-toggle-activity').querySelector('.lucide-chevron-down'),
    ).toHaveClass('rotate-180');
  });

  it('leaves the chevron unrotated when closed', () => {
    renderSection({ open: false });
    expect(
      screen.getByTestId('session-panel-section-toggle-activity').querySelector('.lucide-chevron-down'),
    ).not.toHaveClass('rotate-180');
  });

  it('renders no count badge when count is undefined', () => {
    renderSection();
    expect(screen.getByTestId('session-panel-section-toggle-activity')).toHaveTextContent('Background Activity');
    expect(screen.getByTestId('session-panel-section-toggle-activity').querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('renders the count badge when a count is given, including zero', () => {
    renderSection({ count: 0 });
    expect(
      screen.getByTestId('session-panel-section-toggle-activity').querySelector('[data-slot="badge"]'),
    ).toHaveTextContent('0');
  });

  it('shows the body when open and hides it when closed', () => {
    const { unmount } = render(
      <PanelSection id="context" label="Context" icon={Activity} open onToggle={vi.fn()}>
        <div data-testid="section-body">body</div>
      </PanelSection>,
    );
    expect(screen.getByTestId('section-body')).toBeInTheDocument();
    unmount();

    render(
      <PanelSection id="context" label="Context" icon={Activity} open={false} onToggle={vi.fn()}>
        <div data-testid="section-body">body</div>
      </PanelSection>,
    );
    expect(screen.queryByTestId('section-body')).toBeNull();
  });

  it('hands the section element to sectionRef', () => {
    const sectionRef = vi.fn();
    renderSection({ sectionRef });
    expect(sectionRef).toHaveBeenCalledWith(screen.getByTestId('session-panel-section-activity'));
  });
});
