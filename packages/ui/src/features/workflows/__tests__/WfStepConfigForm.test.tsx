import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfStepConfigForm } from '@/features/workflows/editor/config/WfStepConfigForm';
import { WfFieldControl } from '@/features/workflows/editor/config/WfFieldControl';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';

// WfExprInput mounts real CodeMirror (Task 17); these tests exercise
// getByPath/setByPath patching through WfFieldControl, not CM6 itself
// (covered by wf-expr-chips[-editor].test.ts and WfVarPicker.test.tsx), so a
// plain-input stand-in keeps fireEvent.change working unchanged.
vi.mock('@/features/workflows/editor/config/WfExprInput', () => ({
  WfExprInput: ({
    value,
    onChange,
    multiline,
    testId,
  }: {
    value: string;
    onChange: (v: string) => void;
    multiline?: boolean;
    testId: string;
  }) =>
    multiline ? (
      <textarea data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} />
    ) : (
      <input data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));

describe('WfStepConfigForm', () => {
  it('renders foreach fields and patches over/as', () => {
    const step: WfStep = { id: 'loop', kind: 'foreach', over: '', as: 'item', steps: [] };
    const onPatch = vi.fn();
    render(<WfStepConfigForm step={step} onPatch={onPatch} scope={[]} />);
    fireEvent.change(screen.getByTestId('workflows-config-loop-over'), { target: { value: '${inputs.items}' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ over: '${inputs.items}' }));
  });

  it('renders base fields outside the collapsed Advanced section', () => {
    const step: WfStep = { id: 'loop2', kind: 'foreach', over: '', as: 'item', steps: [] };
    render(<WfStepConfigForm step={step} onPatch={vi.fn()} scope={[]} />);
    expect(screen.getByTestId('workflows-config-loop2-over')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-config-loop2-onFailure')).not.toBeInTheDocument();
  });

  it('expands Advanced to reveal retry, onFailure, and output', () => {
    const step: WfStep = { id: 'loop3', kind: 'foreach', over: '', as: 'item', steps: [] };
    render(<WfStepConfigForm step={step} onPatch={vi.fn()} scope={[]} />);
    fireEvent.click(screen.getByTestId('workflows-config-loop3-advanced-toggle'));
    expect(screen.getByTestId('workflows-config-loop3-attempts')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-config-loop3-onFailure')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-config-loop3-output')).toBeInTheDocument();
  });

  it('patches a number field to a parsed number', () => {
    const step: WfStep = { id: 'frm1', kind: 'form', form: { title: '', fields: [] } };
    const onPatch = vi.fn();
    render(<WfStepConfigForm step={step} onPatch={onPatch} scope={[]} />);

    fireEvent.change(screen.getByTestId('workflows-config-frm1-afterMinutes'), { target: { value: '5' } });
    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        form: expect.objectContaining({ timeout: expect.objectContaining({ afterMinutes: 5 }) }),
      }),
    );
  });

  it('clears a number field to undefined, never NaN', () => {
    const step: WfStep = {
      id: 'frm4',
      kind: 'form',
      form: { title: '', fields: [], timeout: { afterMinutes: 5, onTimeout: 'cancel' } },
    };
    const onPatch = vi.fn();
    render(<WfStepConfigForm step={step} onPatch={onPatch} scope={[]} />);

    fireEvent.change(screen.getByTestId('workflows-config-frm4-afterMinutes'), { target: { value: '' } });
    const patch = onPatch.mock.calls[0]![0] as { form: { timeout: { afterMinutes: unknown } } };
    expect(patch.form.timeout.afterMinutes).toBeUndefined();
  });

  it('patches a select field (form.timeout.onTimeout)', () => {
    const step: WfStep = { id: 'frm2', kind: 'form', form: { title: '', fields: [] } };
    const onPatch = vi.fn();
    render(<WfStepConfigForm step={step} onPatch={onPatch} scope={[]} />);

    fireEvent.click(screen.getByTestId('workflows-config-frm2-onTimeout'));
    fireEvent.click(screen.getByTestId('workflows-config-frm2-onTimeout-option-continue'));

    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        form: expect.objectContaining({ timeout: expect.objectContaining({ onTimeout: 'continue' }) }),
      }),
    );
  });

  it('patches a kv field (service.with), leaving string values as strings', () => {
    const step: WfStep = { id: 'svc1', kind: 'service', connector: 'files.append', with: { path: 'log.md' } };
    const onPatch = vi.fn();
    render(<WfStepConfigForm step={step} onPatch={onPatch} scope={[]} />);

    fireEvent.change(screen.getByTestId('workflows-config-svc1-with-row-0-value'), { target: { value: 'new.md' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ with: { path: 'new.md' } }));
  });

  it('adds and removes a kv row', () => {
    const step: WfStep = { id: 'svc2', kind: 'service', connector: 'files.append', with: {} };
    const onPatch = vi.fn();
    render(<WfStepConfigForm step={step} onPatch={onPatch} scope={[]} />);

    fireEvent.click(screen.getByTestId('workflows-config-svc2-with-add'));
    const added = onPatch.mock.calls[0]![0] as { with: Record<string, unknown> };
    expect(Object.keys(added.with)).toHaveLength(1);
  });
});

describe('WfFieldControl (toggle)', () => {
  it('renders a toggle descriptor as a Switch and patches a boolean', () => {
    const step: WfStep = { id: 'ag1', kind: 'agent', agent: { prompt: '' } };
    const onPatch = vi.fn();
    render(
      <WfFieldControl
        desc={{ kind: 'toggle', key: 'agent.dryRun', label: 'Dry run' }}
        step={step}
        onPatch={onPatch}
        scope={[]}
      />,
    );
    const toggle = screen.getByTestId('workflows-config-ag1-dryRun');
    fireEvent.click(toggle);
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ agent: expect.objectContaining({ dryRun: true }) }));
  });
});
