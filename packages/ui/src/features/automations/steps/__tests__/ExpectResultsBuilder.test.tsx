/**
 * ExpectResultsBuilder — A2's "Expect results" rows: key + type +
 * options-for-choice; declared keys become typed tokens alongside ⟨Agent
 * result⟩ (contract §6 A2, `domain/tokens.ts`'s `stepProduces` already
 * consumes `step.expects` this way — this component only authors it). No
 * ts153 artboard; styled from the form-builder idiom (AskMeConfig's field
 * rows). TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationExpectedOutput } from '../../contract';
import { ExpectResultsBuilder } from '../ExpectResultsBuilder';

describe('ExpectResultsBuilder', () => {
  it('renders an empty state with an "Add a result" affordance when there are no expected outputs', () => {
    render(<ExpectResultsBuilder expects={[]} onChange={vi.fn()} testId="automations-expects-a" />);
    expect(screen.getByTestId('automations-expects-a-add')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-expects-a-row-0')).not.toBeInTheDocument();
  });

  it('clicking "Add a result" appends a new expected output with type text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ExpectResultsBuilder expects={[]} onChange={onChange} testId="automations-expects-a" />);
    await user.click(screen.getByTestId('automations-expects-a-add'));
    const added: AutomationExpectedOutput | undefined = onChange.mock.calls[0]?.[0]?.[0];
    expect(added?.type).toBe('text');
    expect(added?.key).toBeTruthy();
  });

  it("editing the key input patches that row's key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'text' }];
    render(<ExpectResultsBuilder expects={expects} onChange={onChange} testId="automations-expects-a" />);
    const input = screen.getByTestId('automations-expects-a-key-0');
    await user.type(input, '!');
    expect(onChange).toHaveBeenLastCalledWith([{ key: 'scope!', type: 'text' }]);
  });

  it("changing the type select patches that row's type", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'text' }];
    render(<ExpectResultsBuilder expects={expects} onChange={onChange} testId="automations-expects-a" />);
    await user.selectOptions(screen.getByTestId('automations-expects-a-type-0'), 'choice');
    expect(onChange).toHaveBeenCalledWith([{ key: 'scope', type: 'choice', options: [] }]);
  });

  it('shows an options chip editor only when type is choice, and adding an option patches row.options', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'choice', options: ['xs', 's'] }];
    render(<ExpectResultsBuilder expects={expects} onChange={onChange} testId="automations-expects-a" />);
    expect(screen.getByText('xs')).toBeInTheDocument();
    expect(screen.getByText('s')).toBeInTheDocument();

    const optionInput = screen.getByTestId('automations-expects-a-options-0-input');
    await user.type(optionInput, 'm{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([{ key: 'scope', type: 'choice', options: ['xs', 's', 'm'] }]);
  });

  it('hides the options editor for non-choice types', () => {
    const expects: AutomationExpectedOutput[] = [{ key: 'scope', type: 'number' }];
    render(<ExpectResultsBuilder expects={expects} onChange={vi.fn()} testId="automations-expects-a" />);
    expect(screen.queryByTestId('automations-expects-a-options-0-input')).not.toBeInTheDocument();
  });

  it('removing a row drops it from expects', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const expects: AutomationExpectedOutput[] = [
      { key: 'scope', type: 'text' },
      { key: 'confidence', type: 'number' },
    ];
    render(<ExpectResultsBuilder expects={expects} onChange={onChange} testId="automations-expects-a" />);
    await user.click(screen.getByTestId('automations-expects-a-remove-0'));
    expect(onChange).toHaveBeenCalledWith([{ key: 'confidence', type: 'number' }]);
  });
});
