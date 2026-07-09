/**
 * WfbStepRow — TDD test for kind-icon resolution, plus (Task 13) the
 * onPatch-driven config form mount.
 *
 * WfbStepRow receives canonical v2 kinds (choose/foreach/call/service) and
 * resolves them directly via getKindMeta — the model and canonical
 * vocabularies no longer diverge (KIND_ALIAS/getKindMetaByModel removed).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfbStepRow } from '@/features/workflows/editor/WfbStepRow';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';

vi.mock('@/features/workflows/editor/config/AgentConfigSlot', () => ({
  AgentConfigSlot: ({ onPatch }: { onPatch: (patch: Partial<WfStep>) => void }) => (
    <input data-testid="mock-agent-prompt" onChange={(e) => onPatch({ agent: { prompt: e.target.value } })} />
  ),
}));

vi.mock('@/features/workflows/editor/config/FormFieldsSlot', () => ({
  FormFieldsSlot: ({ onPatch }: { onPatch: (patch: Partial<WfStep>) => void }) => (
    <input data-testid="mock-form-fields" onChange={(e) => onPatch({ form: { title: e.target.value, fields: [] } })} />
  ),
}));

// WfExprInput mounts real CodeMirror (Task 17); this suite exercises step-row
// patching, not CM6 itself (covered by wf-expr-chips[-editor].test.ts and
// WfVarPicker.test.tsx), so a plain-input stand-in keeps fireEvent.change
// working unchanged.
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

function chooseStep(): WfStep {
  return { id: 'b1', kind: 'choose', arms: [{ when: 'true', steps: [] }] };
}

function openConfigure(id: string): void {
  fireEvent.click(screen.getByTestId(`workflows-builder-step-configure-${id}`));
}

describe('WfbStepRow', () => {
  it('resolves the Branch label/icon meta for a "choose" step, not the "Value" default', () => {
    render(<WfbStepRow step={chooseStep()} index={0} onRemove={vi.fn()} />);
    const row = screen.getByTestId('workflows-builder-step-b1');
    expect(row.textContent).toContain('arms');
    // The title input falls back to meta.label when step.name is unset.
    const titleInput = screen.getByTestId('workflows-builder-step-title-b1') as HTMLInputElement;
    expect(titleInput.value).toBe('Branch');
    expect(titleInput.value).not.toBe('Value');
  });

  it('resolves the Loop label for a "foreach" step, not the "Value" default', () => {
    const step: WfStep = { id: 'l1', kind: 'foreach', over: '${ items }', as: 'item', steps: [] };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-l1') as HTMLInputElement;
    expect(titleInput.value).toBe('Loop');
  });

  it('resolves the Sub-workflow label for a "call" step, not the "Value" default', () => {
    const step: WfStep = { id: 'sf1', kind: 'call', ref: 'ship-work' };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-sf1') as HTMLInputElement;
    expect(titleInput.value).toBe('Sub-workflow');
  });

  it('resolves the Service label for a "service" step, not the "Value" default', () => {
    const step: WfStep = { id: 'svc1', kind: 'service', connector: 'files.append' };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-svc1') as HTMLInputElement;
    expect(titleInput.value).toBe('Service');
  });

  it('typing into the title input calls onPatch with a name patch, not onTitle', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'svc2', kind: 'service', connector: 'files.append' };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByTestId('workflows-builder-step-title-svc2'), { target: { value: 'Renamed' } });
    expect(onPatch).toHaveBeenCalledWith({ name: 'Renamed' });
  });

  it('opens the config form for an "agent" step and patches through the mocked slot', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'a1', kind: 'agent', agent: { prompt: 'x' } };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('a1');
    fireEvent.change(screen.getByTestId('mock-agent-prompt'), { target: { value: 'Describe the task' } });
    expect(onPatch).toHaveBeenCalledWith({ agent: { prompt: 'Describe the task' } });
  });

  it('opens the config form for a "form" step and patches through the mocked slot', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'f1', kind: 'form', form: { title: '', fields: [] } };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('f1');
    fireEvent.change(screen.getByTestId('mock-form-fields'), { target: { value: 'Ask something' } });
    expect(onPatch).toHaveBeenCalledWith({ form: { title: 'Ask something', fields: [] } });
  });

  it('opens the config form for a "service" step and patches the connector field', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 's1', kind: 'service', connector: 'files.append' };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('s1');
    fireEvent.change(screen.getByTestId('workflows-config-s1-connector'), { target: { value: 'slack.post' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ connector: 'slack.post' }));
  });

  it('opens the config form for a "choose" step and patches an arm\'s when-condition', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'c1', kind: 'choose', arms: [{ when: 'true', steps: [] }] };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('c1');
    fireEvent.change(screen.getByTestId('workflows-config-c1-arm-0-when'), { target: { value: 'x > 1' } });
    expect(onPatch).toHaveBeenCalledWith({ arms: [{ when: 'x > 1', steps: [] }] });
  });

  it('opens the config form for a "foreach" step and patches the over field', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'l2', kind: 'foreach', over: '', as: 'item', steps: [] };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('l2');
    fireEvent.change(screen.getByTestId('workflows-config-l2-over'), { target: { value: '${ items }' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ over: '${ items }' }));
  });

  it('opens the config form for a "parallel" step and patches a branch name', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'p1', kind: 'parallel', branches: { a: [], b: [] } };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('p1');
    fireEvent.change(screen.getByTestId('workflows-config-p1-branch-a-name'), { target: { value: 'renamed' } });
    expect(onPatch).toHaveBeenCalledWith({ branches: { renamed: [], b: [] } });
  });

  it('opens the config form for a "call" step and patches the ref field', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'call1', kind: 'call', ref: 'ship-work' };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('call1');
    fireEvent.change(screen.getByTestId('workflows-config-call1-ref'), { target: { value: 'other-workflow' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ ref: 'other-workflow' }));
  });

  it('opens the config form for a "set" step and patches the set map', () => {
    const onPatch = vi.fn();
    const step: WfStep = { id: 'set1', kind: 'set', set: { value: null } };
    render(<WfbStepRow step={step} index={0} onPatch={onPatch} onRemove={vi.fn()} />);
    openConfigure('set1');
    fireEvent.click(screen.getByTestId('workflows-config-set1-set-add'));
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ value: null }) }));
  });

  it('renders no error badge when `error` is absent', () => {
    const step: WfStep = { id: 'e0', kind: 'set', set: { value: null } };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    expect(screen.queryByTestId('workflows-builder-step-error-e0')).not.toBeInTheDocument();
  });

  it('renders a red error badge and the message in the (auto-opened) expander when `error` is set', () => {
    const step: WfStep = { id: 'e1', kind: 'set', set: { value: null } };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} error="must have exactly one kind" />);
    expect(screen.getByTestId('workflows-builder-step-error-e1')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-builder-step-error-message-e1')).toHaveTextContent(
      'must have exactly one kind',
    );
  });
});
