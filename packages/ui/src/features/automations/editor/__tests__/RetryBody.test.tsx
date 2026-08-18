/**
 * RetryBody — the attempt count, and the side-effect warning. The warning has
 * a test because it is the only place a user learns that retrying re-runs
 * steps that already had an effect; the engine has no guard for that.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RetryBlock } from '../../contract';
import { RetryBody } from '../RetryBody';

function setup(maxAttempts: number) {
  const onChange = vi.fn();
  const initial: RetryBlock = { id: 'guard', kind: 'retry', maxAttempts, steps: [] };
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <RetryBody
        step={value}
        onChange={(patch) => {
          onChange(patch);
          setValue((v) => ({ ...v, ...patch }));
        }}
        tokens={[]}
        catalog={[]}
        issues={[]}
        depth={0}
      />
    );
  }
  render(<Host />);
  return { onChange };
}

describe('RetryBody', () => {
  it('always warns that attempts re-run side effects', () => {
    setup(3);
    expect(screen.getByTestId('automations-retry-warning-guard')).toHaveTextContent(/already had an effect/i);
  });

  it('says plainly that one attempt is no retry', () => {
    setup(1);
    expect(screen.getByText(/no retry/i)).toBeInTheDocument();
  });

  it('stores an edited attempt count', async () => {
    const { onChange } = setup(3);
    const field = screen.getByTestId('automations-retry-attempts-guard');
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    expect(onChange).toHaveBeenLastCalledWith({ maxAttempts: 5 });
  });

  it('reports a cleared count as zero so validation can reject it', async () => {
    const { onChange } = setup(3);
    await userEvent.clear(screen.getByTestId('automations-retry-attempts-guard'));
    expect(onChange).toHaveBeenLastCalledWith({ maxAttempts: 0 });
  });
});
