import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfChooseArmsEditor } from '@/features/workflows/editor/config/WfChooseArmsEditor';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';

function chooseStep(): WfStep {
  return {
    id: 'br1',
    kind: 'choose',
    arms: [
      { when: 'true', steps: [] },
      { else: true, steps: [] },
    ],
  };
}

describe('WfChooseArmsEditor', () => {
  it('adds an arm', () => {
    const onPatch = vi.fn();
    render(<WfChooseArmsEditor step={chooseStep()} onPatch={onPatch} scope={[]} />);
    fireEvent.click(screen.getByTestId('workflows-config-br1-arm-add'));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0]![0] as Partial<WfStep> & { arms: Array<{ when?: string }> };
    expect(patch.arms).toHaveLength(3);
  });

  it('sets a when condition on an arm', () => {
    const onPatch = vi.fn();
    render(<WfChooseArmsEditor step={chooseStep()} onPatch={onPatch} scope={[]} />);
    fireEvent.change(screen.getByTestId('workflows-config-br1-arm-0-when'), {
      target: { value: '${ inputs.x } > 1' },
    });
    const patch = onPatch.mock.calls[0]![0] as Partial<WfStep> & { arms: Array<{ when?: string }> };
    expect(patch.arms[0]?.when).toBe('${ inputs.x } > 1');
  });

  it('toggles the last arm to else, clearing when', () => {
    const step: WfStep = {
      id: 'br2',
      kind: 'choose',
      arms: [
        { when: 'true', steps: [] },
        { when: 'false', steps: [] },
      ],
    };
    const onPatch = vi.fn();
    render(<WfChooseArmsEditor step={step} onPatch={onPatch} scope={[]} />);
    fireEvent.click(screen.getByTestId('workflows-config-br2-arm-1-else-toggle'));
    const patch = onPatch.mock.calls[0]![0] as Partial<WfStep> & {
      arms: Array<{ when?: string; else?: true }>;
    };
    expect(patch.arms[1]?.when).toBeUndefined();
    expect(patch.arms[1]?.else).toBe(true);
    expect(patch.arms[0]?.when).toBe('true');
  });

  it('removes an arm', () => {
    const onPatch = vi.fn();
    render(<WfChooseArmsEditor step={chooseStep()} onPatch={onPatch} scope={[]} />);
    fireEvent.click(screen.getByTestId('workflows-config-br1-arm-0-remove'));
    const patch = onPatch.mock.calls[0]![0] as Partial<WfStep> & { arms: Array<{ when?: string; else?: true }> };
    expect(patch.arms).toHaveLength(1);
    expect(patch.arms[0]?.else).toBe(true);
  });
});
