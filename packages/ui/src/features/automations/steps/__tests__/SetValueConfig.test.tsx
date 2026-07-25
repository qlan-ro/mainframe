/**
 * SetValueConfig — the `set_variable` step's pane: the identifier later steps
 * type as `$name`, and the value it stands for. TDD: tests written first,
 * implemented after.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SetVariableStep } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import { SetValueConfig, type SetValueConfigProps } from '../SetValueConfig';

const TODAY: TokenDescriptor = {
  ref: { stepId: 'builtin', output: 'today' },
  label: 'Today',
  type: 'date',
  sourceKind: 'builtin',
  source: 'Built-in',
};

const STEP: SetVariableStep = { id: 'v1', kind: 'set_variable', name: '', value: [''] };

function Pane(props: {
  initial: SetVariableStep;
  onChange?: SetValueConfigProps['onChange'];
  tokens?: TokenDescriptor[];
}) {
  const [step, setStep] = useState(props.initial);
  return (
    <SetValueConfig
      step={step}
      tokens={props.tokens ?? []}
      testId="automations-step-config-v1"
      onChange={(next) => {
        setStep(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe('SetValueConfig — name', () => {
  it('renders an input bound to step.name', () => {
    render(<Pane initial={{ ...STEP, name: 'headline' }} />);
    expect(screen.getByTestId('automations-step-config-v1-name')).toHaveValue('headline');
  });

  it('shows the reference later steps will type', () => {
    render(<Pane initial={{ ...STEP, name: 'headline' }} />);
    expect(screen.getByTestId('automations-step-config-v1-reference')).toHaveTextContent('$headline');
  });

  it('asks for a name instead of showing a bare "$" while the step is unnamed', () => {
    render(<Pane initial={STEP} />);
    const reference = screen.getByTestId('automations-step-config-v1-reference');
    expect(reference).toHaveTextContent('Name it to use it in later steps.');
    expect(reference).not.toHaveTextContent('$ ');
  });
});

describe('SetValueConfig — name commit semantics', () => {
  it('does not patch the step while the name is being typed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pane initial={STEP} onChange={onChange} />);

    await user.click(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard('headline');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the name once, on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pane initial={STEP} onChange={onChange} />);

    await user.click(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard('headline');
    await user.tab();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...STEP, name: 'headline' });
  });

  it('commits the name on Enter, without waiting for a blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pane initial={STEP} onChange={onChange} />);

    await user.click(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard('headline{Enter}');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...STEP, name: 'headline' });
  });

  it('refuses a name that cannot be typed as $name, and says what is allowed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pane initial={{ ...STEP, name: 'headline' }} onChange={onChange} />);

    await user.clear(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard('Head Line{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('automations-step-config-v1-name-error')).toHaveTextContent(
      'Use lowercase letters, numbers and underscores for a value name, starting with a letter.',
    );
  });

  it('refuses an emptied name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pane initial={{ ...STEP, name: 'headline' }} onChange={onChange} />);

    await user.clear(screen.getByTestId('automations-step-config-v1-name'));
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('automations-step-config-v1-name-error')).toHaveTextContent('Give this value a name.');
  });

  it('refuses a name another value in scope already holds', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const taken: TokenDescriptor = {
      ref: { stepId: 'v0', output: 'value' },
      label: 'headline',
      type: 'text',
      sourceKind: 'variable',
      source: 'Set value',
    };
    render(<Pane initial={STEP} onChange={onChange} tokens={[taken]} />);

    await user.click(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard('headline{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('automations-step-config-v1-name-error')).toHaveTextContent(
      'Another value in scope is already called $headline',
    );
  });

  it('clears the error once the name is fixed', async () => {
    const user = userEvent.setup();
    render(<Pane initial={STEP} />);

    await user.click(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard('Head Line{Enter}');
    expect(screen.getByTestId('automations-step-config-v1-name-error')).toBeInTheDocument();

    await user.clear(screen.getByTestId('automations-step-config-v1-name'));
    await user.keyboard('headline{Enter}');

    expect(screen.queryByTestId('automations-step-config-v1-name-error')).not.toBeInTheDocument();
  });

  it('leaves an unchanged name alone — visiting the field is not an edit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pane initial={{ ...STEP, name: 'headline' }} onChange={onChange} />);

    await user.click(screen.getByTestId('automations-step-config-v1-name'));
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('automations-step-config-v1-name-error')).not.toBeInTheDocument();
  });
});

describe('SetValueConfig — value', () => {
  it('typing a value patches the step as chip text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pane initial={{ ...STEP, name: 'headline' }} onChange={onChange} />);

    await user.click(screen.getByTestId('automations-step-config-v1-value'));
    await user.keyboard('Release day');

    expect(onChange).toHaveBeenLastCalledWith({ ...STEP, name: 'headline', value: ['Release day'] });
  });

  it('offers the step scope in the value field, so a value can be built from earlier steps', async () => {
    const user = userEvent.setup();
    render(<Pane initial={STEP} tokens={[TODAY]} />);

    await user.click(screen.getByTestId('automations-step-config-v1-value-var-picker'));

    expect(screen.getByTestId('automations-step-config-v1-value-var-picker-option-today')).toBeInTheDocument();
  });
});
