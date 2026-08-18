/**
 * WaitConfig — amount + unit over a canonical `seconds` wire field. The unit
 * is derived from the stored value, so the tests that matter are the round
 * trips: what a given `seconds` displays as, and what an edit stores back.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WaitStep } from '../../contract';
import { WaitConfig } from '../WaitConfig';

function step(seconds: number): WaitStep {
  return { id: 'pause', kind: 'wait', seconds };
}

/**
 * `WaitConfig` is fully controlled, so a bare `vi.fn()` parent leaves stale
 * text in the input and every keystroke compounds against it. This wrapper is
 * the real parent's behavior — state in, re-render out — and `onChange` spies
 * on the values that pass through.
 */
function setup(seconds: number) {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState(step(seconds));
    return (
      <WaitConfig
        step={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        testId="automations-wait"
      />
    );
  }
  render(<Host />);
  return { onChange };
}

describe('WaitConfig', () => {
  it('shows 300 seconds as 5 minutes, not 300 seconds', () => {
    setup(300);
    expect(screen.getByTestId('automations-wait-amount')).toHaveValue(5);
    expect(screen.getByTestId('automations-wait-unit-minutes')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows 7200 seconds as 2 hours', () => {
    setup(7200);
    expect(screen.getByTestId('automations-wait-amount')).toHaveValue(2);
    expect(screen.getByTestId('automations-wait-unit-hours')).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to seconds when the value divides into no larger unit', () => {
    setup(90);
    expect(screen.getByTestId('automations-wait-amount')).toHaveValue(90);
    expect(screen.getByTestId('automations-wait-unit-seconds')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the unit across a clear-and-retype, so 5 min retyped as 2 is 2 minutes', async () => {
    const { onChange } = setup(300);
    const amount = screen.getByTestId('automations-wait-amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '2');
    expect(onChange).toHaveBeenLastCalledWith({ id: 'pause', kind: 'wait', seconds: 120 });
    expect(screen.getByTestId('automations-wait-unit-minutes')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the amount and re-scales the stored seconds when the unit changes', async () => {
    const { onChange } = setup(300);
    await userEvent.click(screen.getByTestId('automations-wait-unit-hours'));
    // 5 minutes -> 5 hours, matching how a unit toggle reads everywhere else.
    expect(onChange).toHaveBeenCalledWith({ id: 'pause', kind: 'wait', seconds: 18_000 });
  });

  it('leaves a cleared field at zero for validation to report, rather than clamping it', async () => {
    const { onChange } = setup(300);
    await userEvent.clear(screen.getByTestId('automations-wait-amount'));
    expect(onChange).toHaveBeenLastCalledWith({ id: 'pause', kind: 'wait', seconds: 0 });
  });
});
