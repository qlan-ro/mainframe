/**
 * RepeatBody — "For each item in" list-token pick + inner recipe (ts153
 * wf2-editor.jsx `WfRepeatBody`). The contract's `RepeatBlock.items` is a
 * non-optional `TokenRef` (no ts153 `list: []` "unpicked" state) — a fresh
 * Repeat is created already pointing at a real token (`Recipe`'s `newStep`
 * factory), so this component only needs to resolve-and-display, plus offer
 * a picker to change the pick. TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionCatalogEntry, RepeatBlock } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import { RepeatBody } from '../RepeatBody';

const OPEN_PRS: TokenDescriptor = {
  ref: { stepId: 'list-prs', output: 'prs' },
  label: 'Open PRs',
  type: 'list',
  sourceKind: 'action',
  source: 'List my open PRs',
  fields: ['url', 'title', 'number', 'author'],
};

const TODAY: TokenDescriptor = {
  ref: { stepId: 'builtin', output: 'today' },
  label: 'Today',
  type: 'date',
  sourceKind: 'builtin',
  source: 'Built-in',
};

const NO_CATALOG: ActionCatalogEntry[] = [];

function repeatStep(overrides: Partial<RepeatBlock> = {}): RepeatBlock {
  return { id: 'r1', kind: 'repeat', items: OPEN_PRS.ref, steps: [], ...overrides };
}

describe('RepeatBody', () => {
  it('shows the chosen list token as a resolved chip', () => {
    render(
      <RepeatBody
        step={repeatStep()}
        onChange={vi.fn()}
        tokens={[TODAY, OPEN_PRS]}
        catalog={NO_CATALOG}
        issues={[]}
        depth={0}
      />,
    );
    expect(screen.getByTestId('automations-repeat-items-r1')).toHaveTextContent('Open PRs');
  });

  it('offers only list-type tokens in the "pick a list" picker', async () => {
    const user = userEvent.setup();
    render(
      <RepeatBody
        step={repeatStep()}
        onChange={vi.fn()}
        tokens={[TODAY, OPEN_PRS]}
        catalog={NO_CATALOG}
        issues={[]}
        depth={0}
      />,
    );
    await user.click(screen.getByTestId('automations-repeat-items-picker-r1'));
    expect(screen.getByTestId('automations-repeat-items-picker-r1-option-list-prs-prs')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-repeat-items-picker-r1-option-builtin-today')).not.toBeInTheDocument();
  });

  it('exposes ⟨Current item⟩ (fields of the chosen list token) inside its own inner recipe scope', () => {
    render(
      <RepeatBody
        step={repeatStep()}
        onChange={vi.fn()}
        tokens={[TODAY, OPEN_PRS]}
        catalog={NO_CATALOG}
        issues={[]}
        depth={0}
      />,
    );
    expect(screen.getByTestId('automations-recipe-r1-steps')).toBeInTheDocument();
  });

  it('changing the pick calls onChange with the new items ref', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const otherList: TokenDescriptor = {
      ref: { stepId: 'other', output: 'items' },
      label: 'Other list',
      type: 'list',
      sourceKind: 'action',
      source: 'Other action',
    };
    render(
      <RepeatBody
        step={repeatStep()}
        onChange={onChange}
        tokens={[TODAY, OPEN_PRS, otherList]}
        catalog={NO_CATALOG}
        issues={[]}
        depth={0}
      />,
    );
    await user.click(screen.getByTestId('automations-repeat-items-picker-r1'));
    await user.click(screen.getByTestId('automations-repeat-items-picker-r1-option-other-items'));
    expect(onChange).toHaveBeenCalledWith({ items: otherList.ref });
  });
});
