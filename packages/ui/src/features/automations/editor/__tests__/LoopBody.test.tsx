/**
 * LoopBody — the fields that decide how a condition loop runs. The pass
 * ceiling gets its own coverage because the engine FAILS a loop that exhausts
 * it, so a value the user can't see or set is a failure they can't explain.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LoopBlock } from '../../contract';
import { LoopBody } from '../LoopBody';

function block(patch: Partial<LoopBlock> = {}): LoopBlock {
  return {
    id: 'poll',
    kind: 'loop',
    mode: 'until',
    match: 'all',
    conditions: [],
    maxIterations: 20,
    steps: [],
    ...patch,
  };
}

function setup(initial: LoopBlock = block()) {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <LoopBody
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

describe('LoopBody', () => {
  it('shows which mode is active', () => {
    setup(block({ mode: 'until' }));
    expect(screen.getByTestId('automations-loop-mode-poll-until')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('automations-loop-mode-poll-while')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches mode without touching the conditions', async () => {
    const { onChange } = setup(block({ mode: 'until' }));
    await userEvent.click(screen.getByTestId('automations-loop-mode-poll-while'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'while' });
  });

  it('renders the pass ceiling as an editable value, not a hidden default', async () => {
    const { onChange } = setup(block({ maxIterations: 20 }));
    const max = screen.getByTestId('automations-loop-max-poll');
    expect(max).toHaveValue(20);
    await userEvent.clear(max);
    await userEvent.type(max, '5');
    expect(onChange).toHaveBeenLastCalledWith({ maxIterations: 5 });
  });

  it('reports a cleared ceiling as zero so validation can reject it', async () => {
    const { onChange } = setup(block({ maxIterations: 20 }));
    await userEvent.clear(screen.getByTestId('automations-loop-max-poll'));
    expect(onChange).toHaveBeenLastCalledWith({ maxIterations: 0 });
  });
});
