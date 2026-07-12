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

describe('ConditionRow — comparators per token type', () => {
  it('offers text comparators (is/is not/contains/starts with/is one of) for a text token', () => {
    render(
      <ConditionRow
        condition={{ token: TEXT_TOKEN.ref, comparator: 'is' }}
        tokens={[TEXT_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    const options = Array.from(screen.getByTestId('cond-comparator').querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['is', 'is not', 'contains', 'starts with', 'is one of']);
  });

  it('offers number comparators (=, is not, <, >) for a number token', () => {
    render(
      <ConditionRow
        condition={{ token: NUMBER_TOKEN.ref, comparator: 'eq' }}
        tokens={[NUMBER_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    const options = Array.from(screen.getByTestId('cond-comparator').querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['=', 'is not', '<', '>']);
  });

  it('offers only is/is not/is one of for a choice token', () => {
    render(
      <ConditionRow
        condition={{ token: CHOICE_TOKEN.ref, comparator: 'is' }}
        tokens={[CHOICE_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    const options = Array.from(screen.getByTestId('cond-comparator').querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['is', 'is not', 'is one of']);
  });
});

describe('ConditionRow — choice value editor', () => {
  it("renders a dropdown of the token's own options for a single-value choice comparator", () => {
    render(
      <ConditionRow
        condition={{ token: CHOICE_TOKEN.ref, comparator: 'is', value: 's' }}
        tokens={[CHOICE_TOKEN]}
        onChange={vi.fn()}
        testId="cond"
      />,
    );
    const options = Array.from(screen.getByTestId('cond-value').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['xs', 's', 'm']);
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
