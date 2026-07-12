/**
 * ChipField — structural part-array editing (ts153 `WfChipField`, ported
 * onto the contract's flat `ChipPart = string | {token: TokenRef}` union).
 * Every assertion here inspects `onChange`'s array argument directly —
 * never a rendered string — per the chunk's structural-assertions mandate.
 * TDD: test written first, component implemented after.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChipText } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import { ChipField } from '../ChipField';

const RESULT_TOKEN: TokenDescriptor = {
  ref: { stepId: 'pick-feature', output: 'result' },
  label: 'Result',
  type: 'text',
  sourceKind: 'agent',
  source: 'Ask agent',
};

function Controlled({
  initial,
  onChange,
  tokens = [],
  slash,
}: {
  initial: ChipText;
  onChange: (next: ChipText) => void;
  tokens?: TokenDescriptor[];
  slash?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ChipField
      value={value}
      onChange={(next: ChipText) => {
        setValue(next);
        onChange(next);
      }}
      tokens={tokens}
      testId="prompt-field"
      slash={slash}
    />
  );
}

describe('ChipField', () => {
  it('starts empty and commits typed text into a single string part on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={[]} onChange={onChange} />);

    await user.type(screen.getByTestId('prompt-field-input'), 'hello world{Enter}');

    expect(onChange).toHaveBeenLastCalledWith(['hello world']);
  });

  it('backspace on an empty draft pops the last committed part', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={['hello', { token: RESULT_TOKEN.ref }]} onChange={onChange} tokens={[RESULT_TOKEN]} />);

    await user.click(screen.getByTestId('prompt-field-input'));
    await user.keyboard('{Backspace}');

    expect(onChange).toHaveBeenLastCalledWith(['hello']);
  });

  it('backspace does nothing when the draft has text (edits the draft, not the parts array)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={['hello']} onChange={onChange} />);

    await user.type(screen.getByTestId('prompt-field-input'), 'x');
    onChange.mockClear();
    await user.keyboard('{Backspace}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('inserting a token merges any in-progress draft as a trailing string part, then appends the token part', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={[]} onChange={onChange} tokens={[RESULT_TOKEN]} />);

    await user.type(screen.getByTestId('prompt-field-input'), 'see ');
    await user.click(screen.getByTestId('prompt-field-picker'));
    await user.click(await screen.findByTestId('prompt-field-picker-option-pick-feature-result'));

    expect(onChange).toHaveBeenLastCalledWith(['see ', { token: { stepId: 'pick-feature', output: 'result' } }]);
  });

  it('the picker button is disabled when the token scope is empty', () => {
    render(<Controlled initial={[]} onChange={vi.fn()} tokens={[]} />);
    expect(screen.getByTestId('prompt-field-picker')).toBeDisabled();
  });

  it('a leading "/" opens the slash menu when slash is enabled', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={[]} onChange={vi.fn()} slash />);

    await user.type(screen.getByTestId('prompt-field-input'), '/pla');

    expect(await screen.findByTestId('prompt-field-slash-menu')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-field-slash-menu-option-/plan')).toBeInTheDocument();
  });

  it('the slash menu never opens when slash is disabled', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={[]} onChange={vi.fn()} slash={false} />);

    await user.type(screen.getByTestId('prompt-field-input'), '/pla');

    expect(screen.queryByTestId('prompt-field-slash-menu')).not.toBeInTheDocument();
  });

  it('selecting a slash command commits it as literal text, not a distinct part kind', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={[]} onChange={onChange} slash />);

    await user.type(screen.getByTestId('prompt-field-input'), '/pla');
    await user.click(await screen.findByTestId('prompt-field-slash-menu-option-/plan'));

    expect(onChange).toHaveBeenLastCalledWith(['/plan']);
  });

  it('Enter while the slash menu is open commits the first match', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={[]} onChange={onChange} slash />);

    await user.type(screen.getByTestId('prompt-field-input'), '/pla{Enter}');

    expect(onChange).toHaveBeenLastCalledWith(['/plan']);
  });

  it('renders a chip for a committed token part, resolved against the tokens prop', () => {
    render(<Controlled initial={[{ token: RESULT_TOKEN.ref }]} onChange={vi.fn()} tokens={[RESULT_TOKEN]} />);
    expect(screen.getByTestId('prompt-field-chip-pick-feature-result')).toHaveTextContent('Result');
  });

  it('clicking a chip remove button removes exactly that part, preserving the rest of the array', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        initial={['before ', { token: RESULT_TOKEN.ref }, ' after']}
        onChange={onChange}
        tokens={[RESULT_TOKEN]}
      />,
    );

    await user.click(screen.getByTestId('prompt-field-chip-pick-feature-result-remove'));

    expect(onChange).toHaveBeenLastCalledWith(['before ', ' after']);
  });

  it('renders a "Missing value" fallback chip for a token ref outside the current scope, without crashing', () => {
    render(<Controlled initial={[{ token: { stepId: 'gone', output: 'result' } }]} onChange={vi.fn()} tokens={[]} />);
    expect(screen.getByTestId('prompt-field-chip-gone-result')).toHaveTextContent('Missing value');
  });
});
