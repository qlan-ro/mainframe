/**
 * gate-kit — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - No source modules exist yet; these tests drive the API contract for three
 *    shared presentational primitives: GateButton, GateCardShell,
 *    and GateHead (the last two exported from GateShell).
 *  - Wrap renders in TooltipProvider for Radix compatibility.
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    components under test.
 *
 * Behaviors covered:
 *  - GateButton: children text, data-testid forwarding, onClick callback,
 *    kind="primary" classes, kind="danger" classes, default-kind class.
 *  - GateCardShell: renders children, resolved/unresolved border classes.
 *  - GateHead: eyebrow text, title text, right slot, tileClassName on icon tile.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GateButton } from '../shared/GateButton';
import { GateCardShell, GateHead } from '../shared/GateShell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ---------------------------------------------------------------------------
// GateButton
// ---------------------------------------------------------------------------

describe('GateButton', () => {
  it('renders children text and forwards data-testid', () => {
    wrap(<GateButton data-testid="gb-1">Approve</GateButton>);
    expect(screen.getByTestId('gb-1')).toHaveTextContent('Approve');
  });

  it('calls onClick handler when clicked', () => {
    const handler = vi.fn();
    wrap(
      <GateButton data-testid="gb-click" onClick={handler}>
        Click me
      </GateButton>,
    );
    fireEvent.click(screen.getByTestId('gb-click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('kind="primary" applies bg-primary and text-primary-foreground classes', () => {
    wrap(
      <GateButton data-testid="gb-primary" kind="primary">
        Primary
      </GateButton>,
    );
    const el = screen.getByTestId('gb-primary');
    expect(el).toHaveClass('bg-primary');
    expect(el).toHaveClass('text-primary-foreground');
  });

  it('kind="danger" applies text-destructive class', () => {
    wrap(
      <GateButton data-testid="gb-danger" kind="danger">
        Danger
      </GateButton>,
    );
    expect(screen.getByTestId('gb-danger')).toHaveClass('text-destructive');
  });

  it('default kind (no kind prop) applies bg-background class', () => {
    wrap(<GateButton data-testid="gb-default">Default</GateButton>);
    expect(screen.getByTestId('gb-default')).toHaveClass('bg-background');
  });
});

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

  it('resolved=false: root element has border-mf-border-hover class', () => {
    wrap(
      <GateCardShell data-testid="shell-unresolved" resolved={false}>
        content
      </GateCardShell>,
    );
    expect(screen.getByTestId('shell-unresolved')).toHaveClass('border-mf-border-hover');
  });

  it('omitting resolved: root element has border-mf-border-hover class', () => {
    wrap(<GateCardShell data-testid="shell-omitted">content</GateCardShell>);
    expect(screen.getByTestId('shell-omitted')).toHaveClass('border-mf-border-hover');
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
        tileClassName="bg-mf-warning-tint"
      />,
    );
    // The icon tile span (wrapping the icon) must carry the tileClassName.
    const tile = screen.getByTestId('gate-head-tile');
    expect(tile).toHaveClass('bg-mf-warning-tint');
  });
});
