/**
 * PlanExecModeControl — behavior tests.
 *
 * Strategy:
 *  - Fully prop-driven; the only context is TooltipProvider, which every
 *    Hint-wrapped segment needs.
 *  - Expected testids, labels and tint classes are hardcoded — never derived
 *    from the option table inside the component.
 *
 * Behaviors covered:
 *  1. The three always-on segments render in permissiveness order.
 *  2. Auto renders only when `autoAllowed` is true — absent when false and when
 *     the prop is omitted (an adapter that does not advertise the capability).
 *  3. Auto sits between Auto-edits and Unattended.
 *  4. A selected Auto reads as a caution (`text-warning`) and never carries the
 *     destructive tint a selected Unattended keeps.
 *  5. Clicking Auto reports `auto` to the caller.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PlanExecModeControl } from '../PlanExecModeControl';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';

function wrap(props: { value: ExecutionMode; onChange?: (m: ExecutionMode) => void; autoAllowed?: boolean }) {
  return render(
    <TooltipProvider>
      <PlanExecModeControl
        value={props.value}
        onChange={props.onChange ?? (() => {})}
        autoAllowed={props.autoAllowed}
      />
    </TooltipProvider>,
  );
}

describe('PlanExecModeControl', () => {
  // --- Behavior 1: the always-on segments ---

  it('renders Interactive, Auto-edits and Unattended regardless of the auto capability', () => {
    wrap({ value: 'default' });

    expect(screen.getByTestId('chat-plan-execmode-default')).toHaveTextContent('Interactive');
    expect(screen.getByTestId('chat-plan-execmode-acceptEdits')).toHaveTextContent('Auto-edits');
    expect(screen.getByTestId('chat-plan-execmode-yolo')).toHaveTextContent('Unattended');
  });

  // --- Behavior 2: capability gating ---

  it('renders the Auto segment when autoAllowed is true', () => {
    wrap({ value: 'default', autoAllowed: true });

    expect(screen.getByTestId('chat-plan-execmode-auto')).toHaveTextContent('Auto');
  });

  it('omits the Auto segment when autoAllowed is false', () => {
    wrap({ value: 'default', autoAllowed: false });

    expect(screen.queryByTestId('chat-plan-execmode-auto')).toBeNull();
  });

  it('omits the Auto segment when autoAllowed is not passed at all', () => {
    wrap({ value: 'default' });

    expect(screen.queryByTestId('chat-plan-execmode-auto')).toBeNull();
  });

  // --- Behavior 3: order ---

  it('places Auto between Auto-edits and Unattended', () => {
    wrap({ value: 'default', autoAllowed: true });

    const ids = Array.from(document.querySelectorAll('button[data-testid^="chat-plan-execmode-"]')).map((b) =>
      b.getAttribute('data-testid'),
    );

    expect(ids).toEqual([
      'chat-plan-execmode-default',
      'chat-plan-execmode-acceptEdits',
      'chat-plan-execmode-auto',
      'chat-plan-execmode-yolo',
    ]);
  });

  // --- Behavior 4: caution tint, not destructive ---

  it('tints a selected Auto with the warning ink and never the destructive one', () => {
    wrap({ value: 'auto', autoAllowed: true });

    const auto = screen.getByTestId('chat-plan-execmode-auto');
    expect(auto).toHaveClass('text-warning');
    expect(auto).not.toHaveClass('text-destructive');
    expect(auto).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the destructive tint on a selected Unattended', () => {
    wrap({ value: 'yolo', autoAllowed: true });

    const yolo = screen.getByTestId('chat-plan-execmode-yolo');
    expect(yolo).toHaveClass('text-destructive');
    expect(yolo).not.toHaveClass('text-warning');
  });

  it('leaves an unselected Auto on the muted ink', () => {
    wrap({ value: 'default', autoAllowed: true });

    const auto = screen.getByTestId('chat-plan-execmode-auto');
    expect(auto).toHaveClass('text-muted-foreground');
    expect(auto).not.toHaveClass('text-warning');
  });

  // --- Behavior 5: selection ---

  it('reports auto to onChange when the Auto segment is clicked', () => {
    const onChange = vi.fn();
    wrap({ value: 'default', autoAllowed: true, onChange });

    fireEvent.click(screen.getByTestId('chat-plan-execmode-auto'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('auto');
  });
});
