/**
 * IfBody — condition rows, and/or, Match all/any, Then/Otherwise, add-
 * otherwise (ts153 wf2-editor.jsx `WfIfBody`). The contract's `IfBlock.
 * otherwise` is always an array (no `null` "not added" state like ts153's
 * `else`) — whether the Otherwise section is showing is local UI state,
 * seeded from `otherwise.length > 0`. TDD: test written first, component
 * implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionCatalogEntry, IfBlock } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import { IfBody } from '../IfBody';

const TODAY: TokenDescriptor = {
  ref: { stepId: 'builtin', output: 'today' },
  label: 'Today',
  type: 'date',
  sourceKind: 'builtin',
  source: 'Built-in',
};

const NO_CATALOG: ActionCatalogEntry[] = [];

function ifStep(overrides: Partial<IfBlock> = {}): IfBlock {
  return { id: 'if1', kind: 'if', match: 'all', conditions: [], then: [], otherwise: [], ...overrides };
}

describe('IfBody — conditions', () => {
  it('shows "+ Add condition" with no conditions yet', () => {
    render(<IfBody step={ifStep()} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} depth={0} />);
    expect(screen.getByTestId('automations-if-add-condition-if1')).toBeInTheDocument();
  });

  it('adding a condition defaults its token to the first in-scope token', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IfBody step={ifStep()} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} depth={0} />);
    await user.click(screen.getByTestId('automations-if-add-condition-if1'));
    expect(onChange).toHaveBeenCalledWith({
      conditions: [{ token: TODAY.ref, comparator: 'is' }],
    });
  });

  it('shows the and/or connector only from the second condition on, and only Match all/any once there are 2+', () => {
    const step = ifStep({
      conditions: [
        { token: TODAY.ref, comparator: 'is', value: 'x' },
        { token: TODAY.ref, comparator: 'is', value: 'y' },
      ],
    });
    render(<IfBody step={step} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} depth={0} />);
    expect(screen.getByText('and')).toBeInTheDocument();
    expect(screen.getByTestId('automations-if-match-all')).toBeInTheDocument();
    expect(screen.getByTestId('automations-if-match-any')).toBeInTheDocument();
  });

  it('shows "or" once match is "any"', () => {
    const step = ifStep({
      match: 'any',
      conditions: [
        { token: TODAY.ref, comparator: 'is', value: 'x' },
        { token: TODAY.ref, comparator: 'is', value: 'y' },
      ],
    });
    render(<IfBody step={step} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} depth={0} />);
    expect(screen.getByText('or')).toBeInTheDocument();
  });
});

describe('IfBody — otherwise', () => {
  it('starts collapsed when otherwise is empty, showing "+ Add otherwise"', () => {
    render(<IfBody step={ifStep()} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} depth={0} />);
    expect(screen.getByTestId('automations-if-add-otherwise-if1')).toBeInTheDocument();
    expect(screen.queryByText('Otherwise')).not.toBeInTheDocument();
  });

  it('starts expanded when otherwise already has steps', () => {
    const step = ifStep({ otherwise: [{ id: 'n1', kind: 'notify', message: [] }] });
    render(<IfBody step={step} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} depth={0} />);
    expect(screen.getByText('Otherwise')).toBeInTheDocument();
    expect(screen.getByTestId('automations-recipe-if1-otherwise')).toBeInTheDocument();
  });

  it('clicking "+ Add otherwise" reveals the Otherwise recipe without patching the step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IfBody step={ifStep()} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} depth={0} />);
    await user.click(screen.getByTestId('automations-if-add-otherwise-if1'));
    expect(screen.getByText('Otherwise')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
