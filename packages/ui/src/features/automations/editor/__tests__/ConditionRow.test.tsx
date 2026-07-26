/**
 * ConditionRow — token chip · comparator · value (ts153 wf2-editor.jsx
 * `WfConditionRow`, ported onto the contract's typed `Comparator` enum and
 * A3's `is_one_of`). Structural assertions on the emitted `ConditionRow`
 * value, never rendered-string round-trips. TDD: test written first,
 * component implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TokenDescriptor } from '../../domain/tokens';
import { ConditionRow } from '../ConditionRow';

/** The shared select is a portalled popover — its options only exist once the trigger is open. */
async function openOptions(user: ReturnType<typeof userEvent.setup>, testId: string): Promise<Array<string | null>> {
  await user.click(screen.getByTestId(testId));
  return screen.getAllByRole('option').map((option) => option.textContent);
}

const TEXT_TOKEN: TokenDescriptor = {
  ref: { stepId: 'pick-feature', output: 'result' },
  label: 'Result',
  type: 'text',
  sourceKind: 'agent',
  source: 'Ask agent',
};

const CHOICE_TOKEN: TokenDescriptor = {
  ref: { stepId: 'pick-feature', output: 'scope' },
  label: 'Scope',
  type: 'choice',
  sourceKind: 'agent',
  source: 'Ask agent',
  options: ['xs', 's', 'm'],
};

const NUMBER_TOKEN: TokenDescriptor = {
  ref: { stepId: 'count', output: 'exitCode' },
  label: 'Exit code',
  type: 'number',
  sourceKind: 'action',
  source: 'Run a command',
};

const LIST_TOKEN: TokenDescriptor = {
  ref: { stepId: 'count', output: 'files' },
  label: 'Files',
  type: 'list',
  sourceKind: 'action',
  source: 'Run a command',
};

describe('ConditionRow — comparators per token type', () => {
  it('offers text comparators (is/is not/contains/starts with/is one of) for a text token', async () => {
    const user = userEvent.setup();
    render(
      <ConditionRow
        condition={{ token: TEXT_TOKEN.ref, comparator: 'is' }}
        tokens={[TEXT_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    expect(await openOptions(user, 'cond-comparator')).toEqual([
      'is',
      'is not',
      'contains',
      'starts with',
      'is one of',
    ]);
  });

  it('offers number comparators (=, is not, <, >) for a number token', async () => {
    const user = userEvent.setup();
    render(
      <ConditionRow
        condition={{ token: NUMBER_TOKEN.ref, comparator: 'eq' }}
        tokens={[NUMBER_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    expect(await openOptions(user, 'cond-comparator')).toEqual(['=', 'is not', '<', '>']);
  });

  it('offers only is/is not/is one of for a choice token', async () => {
    const user = userEvent.setup();
    render(
      <ConditionRow
        condition={{ token: CHOICE_TOKEN.ref, comparator: 'is' }}
        tokens={[CHOICE_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    expect(await openOptions(user, 'cond-comparator')).toEqual(['is', 'is not', 'is one of']);
  });

  it('emits the picked comparator and drops a value the new comparator has no use for', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionRow
        condition={{ token: LIST_TOKEN.ref, comparator: 'contains', value: 'ok' }}
        tokens={[LIST_TOKEN]}
        onChange={onChange}
        testId="cond"
      />,
    );
    await user.click(screen.getByTestId('cond-comparator'));
    await user.click(screen.getByTestId('cond-comparator-option-is_empty'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      token: LIST_TOKEN.ref,
      comparator: 'is_empty',
      value: undefined,
    });
  });
});

describe('ConditionRow — choice value editor', () => {
  it("renders a dropdown of the token's own options for a single-value choice comparator", async () => {
    const user = userEvent.setup();
    render(
      <ConditionRow
        condition={{ token: CHOICE_TOKEN.ref, comparator: 'is', value: 's' }}
        tokens={[CHOICE_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    expect(screen.getByTestId('cond-value')).toHaveTextContent('s');
    expect(await openOptions(user, 'cond-value')).toEqual(['xs', 's', 'm']);
  });

  it('commits the picked choice option as the condition value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionRow
        condition={{ token: CHOICE_TOKEN.ref, comparator: 'is', value: 's' }}
        tokens={[CHOICE_TOKEN]}
        onChange={onChange}
        testId="cond"
      />,
    );
    await user.click(screen.getByTestId('cond-value'));
    await user.click(screen.getByTestId('cond-value-option-m'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ token: CHOICE_TOKEN.ref, comparator: 'is', value: 'm' });
  });
});

describe('ConditionRow — is_one_of multi-value editor', () => {
  it('toggles a choice option in and out of the array value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionRow
        condition={{ token: CHOICE_TOKEN.ref, comparator: 'is_one_of', value: ['xs'] }}
        tokens={[CHOICE_TOKEN]}
        onChange={onChange}
        testId="cond"
      />,
    );
    await user.click(screen.getByTestId('cond-value-option-s'));
    expect(onChange).toHaveBeenCalledWith({ token: CHOICE_TOKEN.ref, comparator: 'is_one_of', value: ['xs', 's'] });
  });

  it('removes an already-selected option on a second click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionRow
        condition={{ token: CHOICE_TOKEN.ref, comparator: 'is_one_of', value: ['xs', 's'] }}
        tokens={[CHOICE_TOKEN]}
        onChange={onChange}
        testId="cond"
      />,
    );
    await user.click(screen.getByTestId('cond-value-option-xs'));
    expect(onChange).toHaveBeenCalledWith({ token: CHOICE_TOKEN.ref, comparator: 'is_one_of', value: ['s'] });
  });

  it('offers a free-form value-chip list for is_one_of on a non-choice token', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionRow
        condition={{ token: TEXT_TOKEN.ref, comparator: 'is_one_of', value: ['alpha'] }}
        tokens={[TEXT_TOKEN]}
        onChange={onChange}
        testId="cond"
      />,
    );
    expect(screen.getByText('alpha')).toBeInTheDocument();
    await user.type(screen.getByTestId('cond-value-input'), 'beta{Enter}');
    expect(onChange).toHaveBeenCalledWith({ token: TEXT_TOKEN.ref, comparator: 'is_one_of', value: ['alpha', 'beta'] });
  });
});

describe('ConditionRow — no-value comparators', () => {
  it('hides the value editor entirely for is_empty', () => {
    render(
      <ConditionRow
        condition={{ token: TEXT_TOKEN.ref, comparator: 'is_empty' }}
        tokens={[TEXT_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    expect(screen.queryByTestId('cond-value')).not.toBeInTheDocument();
  });

  it('hides the value editor entirely for not_empty', () => {
    render(
      <ConditionRow
        condition={{ token: TEXT_TOKEN.ref, comparator: 'not_empty' }}
        tokens={[TEXT_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    expect(screen.queryByTestId('cond-value')).not.toBeInTheDocument();
  });
});

describe('ConditionRow — token identity', () => {
  it('renders the current token as a resolved chip', () => {
    render(
      <ConditionRow
        condition={{ token: TEXT_TOKEN.ref, comparator: 'is', value: 'ok' }}
        tokens={[TEXT_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    expect(screen.getByTestId('cond-token')).toHaveTextContent('Result');
  });
});
