/**
 * BlockCard — If/Repeat bracket frame (ts153 wf2-editor.jsx `WfStepCard`'s
 * block branch). TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionCatalogEntry, IfBlock, RepeatBlock } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import type { ValidationIssue } from '../../domain/validate';
import { BlockCard } from '../BlockCard';

const TODAY: TokenDescriptor = {
  ref: { stepId: 'builtin', output: 'today' },
  label: 'Today',
  type: 'date',
  sourceKind: 'builtin',
  source: 'Built-in',
};

const NO_CATALOG: ActionCatalogEntry[] = [];

describe('BlockCard — if', () => {
  it('renders the static "If … otherwise" label and its IfBody', () => {
    const step: IfBlock = { id: 'if1', kind: 'if', match: 'all', conditions: [], then: [], otherwise: [] };
    render(
      <BlockCard
        step={step}
        onChange={vi.fn()}
        tokens={[TODAY]}
        catalog={NO_CATALOG}
        issues={[]}
        depth={0}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.getByText('If … otherwise')).toBeInTheDocument();
    expect(screen.getByTestId('automations-if-add-condition-if1')).toBeInTheDocument();
  });

  it("shows the issue strip only for issues pinned to this block's id", () => {
    const step: IfBlock = { id: 'if1', kind: 'if', match: 'all', conditions: [], then: [], otherwise: [] };
    const issues: ValidationIssue[] = [
      { stepId: 'if1', level: 'error', msg: 'This block has a problem.' },
      { stepId: 'other', level: 'error', msg: 'Not this one.' },
    ];
    render(
      <BlockCard
        step={step}
        onChange={vi.fn()}
        tokens={[TODAY]}
        catalog={NO_CATALOG}
        issues={issues}
        depth={0}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.getByText('This block has a problem.')).toBeInTheDocument();
    expect(screen.queryByText('Not this one.')).not.toBeInTheDocument();
  });

  it('clicking delete calls onChange(null)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: IfBlock = { id: 'if1', kind: 'if', match: 'all', conditions: [], then: [], otherwise: [] };
    render(
      <BlockCard
        step={step}
        onChange={onChange}
        tokens={[TODAY]}
        catalog={NO_CATALOG}
        issues={[]}
        depth={0}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('automations-step-delete-if1'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('BlockCard — repeat', () => {
  it('renders the static "Repeat for each" label and its RepeatBody', () => {
    const step: RepeatBlock = { id: 'r1', kind: 'repeat', items: TODAY.ref, steps: [] };
    render(
      <BlockCard
        step={step}
        onChange={vi.fn()}
        tokens={[TODAY]}
        catalog={NO_CATALOG}
        issues={[]}
        depth={0}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    expect(screen.getByText('Repeat for each')).toBeInTheDocument();
    expect(screen.getByTestId('automations-repeat-items-r1')).toBeInTheDocument();
  });
});
