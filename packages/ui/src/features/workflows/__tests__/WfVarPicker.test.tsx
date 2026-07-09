/**
 * WfVarPicker — flat, source-grouped, searchable variable list (Task 18).
 * The insertion-into-CM path (⊕ button → pick → doc contains the inserted
 * expr) is covered as a lighter integration assertion against WfExprInput,
 * per the plan's Task 18 Step 1.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WfVarPicker } from '@/features/workflows/editor/config/WfVarPicker';
import { WfExprInput } from '@/features/workflows/editor/config/WfExprInput';
import type { WfScopeSource } from '@/features/workflows/editor/config/wf-scope';

const scope: WfScopeSource[] = [
  { kind: 'step', id: 'triage', label: 'Triage output', expr: '${ steps.triage.output }' },
  { kind: 'input', name: 'topic', label: 'Topic', expr: '${ inputs.topic }' },
  { kind: 'var', key: 'count', label: 'Count', expr: '${ vars.count }' },
];

describe('WfVarPicker', () => {
  it('renders one row per scope source, grouped by kind', () => {
    render(<WfVarPicker scope={scope} onPick={vi.fn()} />);
    expect(screen.getByTestId('workflows-varpicker-steps-triage-output')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-varpicker-inputs-topic')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-varpicker-vars-count')).toBeInTheDocument();
    expect(screen.getByText('Step outputs')).toBeInTheDocument();
    expect(screen.getByText('Inputs')).toBeInTheDocument();
    expect(screen.getByText('Vars')).toBeInTheDocument();
  });

  it('filters rows by a typed search term and fires onPick with the matching source', async () => {
    const onPick = vi.fn();
    render(<WfVarPicker scope={scope} onPick={onPick} />);

    await userEvent.type(screen.getByTestId('workflows-varpicker-search'), 'Topic');

    expect(screen.queryByTestId('workflows-varpicker-steps-triage-output')).not.toBeInTheDocument();
    const row = screen.getByTestId('workflows-varpicker-inputs-topic');
    fireEvent.click(row);

    expect(onPick).toHaveBeenCalledWith(scope[1]);
  });
});

describe('WfExprInput — insert-variable integration', () => {
  it('clicking insert-var then a row leaves the document containing the inserted expr', async () => {
    const onChange = vi.fn();
    render(<WfExprInput value="" onChange={onChange} scope={scope} testId="workflows-config-x-prompt" />);

    fireEvent.click(screen.getByTestId('workflows-config-x-prompt-insert-var'));
    fireEvent.click(await screen.findByTestId('workflows-varpicker-inputs-topic'));

    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('${ inputs.topic }'));
  });
});
