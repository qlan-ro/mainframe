/**
 * gate-kit — behavior tests for three shared presentational primitives:
 * GateButton, GateCardShell, and GateHead (the last two exported from GateShell).
 *
 * Strategy:
 *  - Wrap renders in TooltipProvider for Radix compatibility.
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    components under test.
 *
 * Behaviors covered:
 *  - GateButton: children text, data-testid forwarding, onClick callback,
 *    kind→class mapping (primary/danger/default).
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

  it.each([
    ['primary', ['bg-primary', 'text-primary-foreground']],
    ['danger', ['text-destructive']],
    [undefined, ['bg-background']],
  ] as const)('kind=%s applies the expected classes', (kind, expectedClasses) => {
    wrap(
      <GateButton data-testid="gb-kind" kind={kind}>
        Label
      </GateButton>,
    );
    const el = screen.getByTestId('gb-kind');
    for (const cls of expectedClasses) {
      expect(el).toHaveClass(cls);
    }
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

  it('root element uses bg-card (card surface) not bg-background (white)', () => {
    wrap(<GateCardShell data-testid="shell-bg">content</GateCardShell>);
    const el = screen.getByTestId('shell-bg');
    expect(el).toHaveClass('bg-card');
    expect(el).not.toHaveClass('bg-background');
  });

  it('caps width at the design maxWidth (680px)', () => {
    wrap(<GateCardShell data-testid="shell-width">content</GateCardShell>);
    expect(screen.getByTestId('shell-width')).toHaveClass('max-w-[680px]');
  });

  it('unresolved + accent="primary": shadow is tinted with the primary accent var', () => {
    wrap(
      <GateCardShell data-testid="shell-accent-primary" accent="primary">
        content
      </GateCardShell>,
    );
    const style = screen.getByTestId('shell-accent-primary').getAttribute('style') ?? '';
    expect(style).toContain('--primary');
  });

  it('unresolved + accent="warning": shadow is tinted with the mf-warning accent var', () => {
    wrap(
      <GateCardShell data-testid="shell-accent-warning" accent="warning">
        content
      </GateCardShell>,
    );
    const style = screen.getByTestId('shell-accent-warning').getAttribute('style') ?? '';
    expect(style).toContain('--mf-warning');
  });

  it('resolved=true: no accent-tinted shadow style is applied', () => {
    wrap(
      <GateCardShell data-testid="shell-resolved-noglow" resolved accent="primary">
        content
      </GateCardShell>,
    );
    const style = screen.getByTestId('shell-resolved-noglow').getAttribute('style') ?? '';
    expect(style).not.toContain('--primary');
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

  it('icon tile is sized to the design spec (26px, size-[26px])', () => {
    wrap(<GateHead eyebrow="Gate" title="Run script" icon={<span data-testid="head-icon" />} />);
    expect(screen.getByTestId('gate-head-tile')).toHaveClass('size-[26px]');
  });
});
