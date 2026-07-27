/**
 * VariablePickerButton — the `⟨⟩` affordance mounted in `TriggerTextField`'s
 * slot: lists the same in-scope names as the `$` trigger adapter
 * (`buildVariablesTriggerAdapter`) and inserts a literal `$name` at the
 * caret on pick. TDD: test written first, component implemented after.
 */
import { describe, it, expect } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TokenDescriptor } from '@qlan-ro/mainframe-types';
import { VariablePickerButton } from '../VariablePickerButton';

const SCOPE: TokenDescriptor[] = [
  {
    ref: { stepId: 'trigger', output: 'result' },
    label: 'Result',
    type: 'text',
    sourceKind: 'trigger',
    source: 'Trigger',
  },
  {
    ref: { stepId: 'pick-feature', output: 'result' },
    label: 'Result',
    type: 'text',
    sourceKind: 'agent',
    source: 'Ask agent',
  },
];

function Field({ scope, initial = '' }: { scope: TokenDescriptor[]; initial?: string }) {
  const [value, setValue] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <textarea ref={textareaRef} data-testid="msg" value={value} onChange={(e) => setValue(e.target.value)} />
      <VariablePickerButton scope={scope} testId="msg" value={value} onChange={setValue} textareaRef={textareaRef} />
    </div>
  );
}

describe('VariablePickerButton', () => {
  it('renders with the field testid suffix and an accessible label', () => {
    render(<Field scope={SCOPE} />);
    const button = screen.getByTestId('msg-var-picker');
    expect(button).toHaveAttribute('aria-label', 'Insert variable');
  });

  it('lists the same in-scope names as the $ adapter', async () => {
    const user = userEvent.setup();
    render(<Field scope={SCOPE} />);

    await user.click(screen.getByTestId('msg-var-picker'));

    expect(screen.getByTestId('msg-var-picker-option-trigger_result')).toBeInTheDocument();
    expect(screen.getByTestId('msg-var-picker-option-agent_result')).toBeInTheDocument();
  });

  it('inserts $name at the caret — honoring cursor position, not appending — and refocuses the textarea', async () => {
    const user = userEvent.setup();
    render(<Field scope={SCOPE} initial="before  after" />);
    const textarea = screen.getByTestId('msg') as HTMLTextAreaElement;
    textarea.setSelectionRange(7, 7);

    await user.click(screen.getByTestId('msg-var-picker'));
    await user.click(screen.getByTestId('msg-var-picker-option-trigger_result'));

    expect(textarea.value).toBe('before $trigger_result after');
    expect(document.activeElement).toBe(textarea);
  });

  // A bare `$` only opens a reference at a word boundary, so `todo/$id` is
  // literal text; the braced spelling is the only one that resolves there.
  it('inserts the braced ${name} when the caret is mid-word', async () => {
    const user = userEvent.setup();
    render(<Field scope={SCOPE} initial="todo/" />);
    const textarea = screen.getByTestId('msg') as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 5);

    await user.click(screen.getByTestId('msg-var-picker'));
    await user.click(screen.getByTestId('msg-var-picker-option-trigger_result'));

    expect(textarea.value).toBe('todo/${trigger_result}');
  });

  it('shows an empty state instead of a broken popover when scope is empty', async () => {
    const user = userEvent.setup();
    render(<Field scope={[]} />);

    await user.click(screen.getByTestId('msg-var-picker'));

    expect(await screen.findByText('No variables in scope yet.')).toBeInTheDocument();
  });
});
