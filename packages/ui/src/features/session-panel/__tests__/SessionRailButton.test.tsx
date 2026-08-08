/**
 * SessionRailButton — unit tests.
 *
 * Behaviors covered:
 *  - RailIconButton renders its testid, its glyph, and its accessible name
 *  - RailIconButton fires onClick and onContextMenu
 *  - RailIconButton reflects `pressed` as aria-pressed, and omits the attribute
 *    when the caller passes no pressed state (the launch button never toggles)
 *  - RailIconButton shows the live dot only when `dot` is set
 *  - A disabled RailIconButton does not fire onClick
 *  - RailMeterButton renders the percentage and its accessible name
 *  - Hint wrapping from the OUTSIDE reaches the real <button>: Radix's
 *    TooltipTrigger clones the child, so a component that swallowed its rest
 *    props would silently lose the tooltip (and its ref)
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RailIconButton, RailMeterButton } from '../SessionRailButton';

describe('RailIconButton', () => {
  it('renders the testid, the glyph and the accessible name', () => {
    render(<RailIconButton testId="session-panel-rail-activity" label="Background Activity" icon={Activity} />);
    const button = screen.getByTestId('session-panel-rail-activity');
    expect(button).toHaveAttribute('aria-label', 'Background Activity');
    expect(button.querySelector('.lucide-activity')).toBeTruthy();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<RailIconButton testId="rail-open" label="Session panel" icon={Activity} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('rail-open'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fires onContextMenu so a right-click can route somewhere else', () => {
    const onContextMenu = vi.fn();
    render(<RailIconButton testId="rail-launch" label="Start dev" icon={Activity} onContextMenu={onContextMenu} />);
    fireEvent.contextMenu(screen.getByTestId('rail-launch'));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('reflects pressed as aria-pressed', () => {
    const { rerender } = render(<RailIconButton testId="rail-open" label="Session panel" icon={Activity} pressed />);
    expect(screen.getByTestId('rail-open')).toHaveAttribute('aria-pressed', 'true');
    rerender(<RailIconButton testId="rail-open" label="Session panel" icon={Activity} pressed={false} />);
    expect(screen.getByTestId('rail-open')).toHaveAttribute('aria-pressed', 'false');
  });

  it('omits aria-pressed entirely for a button that never toggles', () => {
    render(<RailIconButton testId="rail-launch" label="Start dev" icon={Activity} />);
    expect(screen.getByTestId('rail-launch')).not.toHaveAttribute('aria-pressed');
  });

  it('shows the live dot only when dot is set', () => {
    const { rerender } = render(<RailIconButton testId="rail-activity" label="Idle" icon={Activity} />);
    expect(screen.queryByTestId('rail-activity-dot')).toBeNull();
    rerender(<RailIconButton testId="rail-activity" label="1 task running" icon={Activity} dot />);
    expect(screen.getByTestId('rail-activity-dot')).toBeInTheDocument();
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <RailIconButton testId="rail-launch" label="No launch configs" icon={Activity} onClick={onClick} disabled />,
    );
    expect(screen.getByTestId('rail-launch')).toBeDisabled();
    fireEvent.click(screen.getByTestId('rail-launch'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('accepts the props Hint injects from the outside', () => {
    render(
      <TooltipProvider>
        <RailIconButton testId="rail-open" label="Session panel" icon={Activity} data-state="closed" />
      </TooltipProvider>,
    );
    // A component that dropped its rest props would render no data-state — and
    // would likewise drop the ref and handlers Radix needs for the tooltip.
    expect(screen.getByTestId('rail-open')).toHaveAttribute('data-state', 'closed');
  });
});

describe('RailMeterButton', () => {
  it('renders the percentage and the accessible name', () => {
    render(
      <RailMeterButton testId="session-panel-rail-context" label="Context: 42% used" percent={42} severity="normal" />,
    );
    const button = screen.getByTestId('session-panel-rail-context');
    expect(button).toHaveAttribute('aria-label', 'Context: 42% used');
    expect(button).toHaveTextContent('42%');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(
      <RailMeterButton
        testId="rail-context"
        label="Context: 8% used"
        percent={8}
        severity="normal"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('rail-context'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
