/**
 * gate-kit — behavior tests for the two shared gate primitives, GateCardShell
 * and GateHead.
 *
 * Strategy:
 *  - Wrap renders in the **v2** TooltipProvider for Radix compatibility.
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    components under test.
 *
 * Behaviors covered:
 *  - GateCardShell: renders children, resolved/unresolved framing, per-accent
 *    ring, absence of a self-declared max-width, default testid.
 *  - GateHead: eyebrow text, title text, right slot, tileClassName on icon tile.
 *
 * (GateButton is gone: v2 `Button`'s default/outline/destructive variants are
 * exactly the three kinds it wrapped.)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GateCardShell, GateHead } from '../shared/GateShell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ---------------------------------------------------------------------------
// GateCardShell
// ---------------------------------------------------------------------------

describe('GateCardShell', () => {
  it('renders its children', () => {
    wrap(
      <GateCardShell>
        <span data-testid="shell-child">inner</span>
      </GateCardShell>,
    );
    expect(screen.getByTestId('shell-child')).toBeInTheDocument();
  });

  it('resolved=true: root element has border-border class', () => {
    wrap(
      <GateCardShell data-testid="shell-resolved" resolved>
        content
      </GateCardShell>,
    );
    expect(screen.getByTestId('shell-resolved')).toHaveClass('border-border');
  });

  it('resolved=false: root element carries the accent border, not the neutral one', () => {
    wrap(
      <GateCardShell data-testid="shell-unresolved" resolved={false}>
        content
      </GateCardShell>,
    );
    const el = screen.getByTestId('shell-unresolved');
    expect(el).toHaveClass('border-primary/40');
    expect(el).not.toHaveClass('border-border');
  });

  it('omitting resolved: root element carries the accent border', () => {
    wrap(<GateCardShell data-testid="shell-omitted">content</GateCardShell>);
    expect(screen.getByTestId('shell-omitted')).toHaveClass('border-primary/40');
  });

  it('root element uses bg-card (card surface) not bg-background (white)', () => {
    wrap(<GateCardShell data-testid="shell-bg">content</GateCardShell>);
    const el = screen.getByTestId('shell-bg');
    expect(el).toHaveClass('bg-card');
    expect(el).not.toHaveClass('bg-background');
  });

  it('declares no max-width of its own — width comes from the transcript column', () => {
    wrap(<GateCardShell data-testid="shell-width">content</GateCardShell>);
    const className = screen.getByTestId('shell-width').className;
    expect(className).not.toMatch(/(^|\s)max-w-/);
  });

  it('carries a default data-testid the E2E width assertion can target', () => {
    render(
      <TooltipProvider>
        <GateCardShell>content</GateCardShell>
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-gate-card')).toHaveTextContent('content');
  });

  it('unresolved + accent="primary": the live ring is tinted with primary', () => {
    wrap(
      <GateCardShell data-testid="shell-accent-primary" accent="primary">
        content
      </GateCardShell>,
    );
    expect(screen.getByTestId('shell-accent-primary')).toHaveClass('ring-primary/15');
  });

  it('unresolved + accent="warning": the live ring is tinted with warning', () => {
    wrap(
      <GateCardShell data-testid="shell-accent-warning" accent="warning">
        content
      </GateCardShell>,
    );
    const el = screen.getByTestId('shell-accent-warning');
    expect(el).toHaveClass('ring-warning/15');
    expect(el).not.toHaveClass('ring-primary/15');
  });

  it('resolved=true: no accent ring at all', () => {
    wrap(
      <GateCardShell data-testid="shell-resolved-noglow" resolved accent="primary">
        content
      </GateCardShell>,
    );
    const className = screen.getByTestId('shell-resolved-noglow').className;
    expect(className).not.toMatch(/ring-/);
  });

  it('carries no inline style: the live treatment is token-driven, not a color-mix boxShadow', () => {
    wrap(<GateCardShell data-testid="shell-no-inline">content</GateCardShell>);
    expect(screen.getByTestId('shell-no-inline')).not.toHaveAttribute('style');
  });
});

// ---------------------------------------------------------------------------
// GateHead
// ---------------------------------------------------------------------------

describe('GateHead', () => {
  it('renders eyebrow and title text', () => {
    wrap(<GateHead eyebrow="Permission" title="Allow bash execution?" icon={<span data-testid="head-icon" />} />);
    expect(screen.getByText('Permission')).toBeInTheDocument();
    expect(screen.getByText('Allow bash execution?')).toBeInTheDocument();
  });

  it('renders the right slot node', () => {
    wrap(<GateHead eyebrow="Gate" title="Run script" icon={<span />} right={<span data-testid="head-right" />} />);
    expect(screen.getByTestId('head-right')).toBeInTheDocument();
  });

  it('applies tileClassName to the icon tile span', () => {
    wrap(
      <GateHead
        eyebrow="Gate"
        title="Run script"
        icon={<span data-testid="head-icon" />}
        tileClassName="bg-warning/10"
      />,
    );
    // The icon tile span (wrapping the icon) must carry the tileClassName.
    const tile = screen.getByTestId('gate-head-tile');
    expect(tile).toHaveClass('bg-warning/10');
  });

  it('icon tile sits on the 24px step of the v2 scale', () => {
    wrap(<GateHead eyebrow="Gate" title="Run script" icon={<span data-testid="head-icon" />} />);
    expect(screen.getByTestId('gate-head-tile')).toHaveClass('size-6');
  });
});
