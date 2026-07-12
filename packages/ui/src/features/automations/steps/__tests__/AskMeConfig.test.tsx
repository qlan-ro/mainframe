/**
 * AskMeConfig — title + field list + add-field (ts153 wf2-stepconfig.jsx
 * `WfAskMeConfig`/`WfFieldRow`, ported onto `AskMeStep.fields` and the
 * contract's `showWhen` — ts153's `when` is the wire-renamed `showWhen`).
 * TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AskMeStep } from '../../contract';
import { AskMeConfig } from '../AskMeConfig';

const BASE_STEP: AskMeStep = { id: 'a', kind: 'ask_me', title: 'Health check-in', fields: [] };

describe('AskMeConfig — title', () => {
  it('renders the title input bound to step.title', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AskMeConfig step={BASE_STEP} onChange={onChange} testId="automations-askme-a" />);
    const input = screen.getByTestId('automations-askme-a-title');
    expect(input).toHaveValue('Health check-in');
    await user.type(input, '!');
    expect(onChange).toHaveBeenLastCalledWith({ ...BASE_STEP, title: 'Health check-in!' });
  });
});

describe('AskMeConfig — field CRUD', () => {
  it('renders zero rows and an "Add a field" affordance when there are no fields', () => {
    render(<AskMeConfig step={BASE_STEP} onChange={vi.fn()} testId="automations-askme-a" />);
    expect(screen.getByTestId('automations-askme-a-add')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-askme-a-field-0')).not.toBeInTheDocument();
  });

  it('clicking "Add a field" appends a new text field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AskMeConfig step={BASE_STEP} onChange={onChange} testId="automations-askme-a" />);
    await user.click(screen.getByTestId('automations-askme-a-add'));
    const call = onChange.mock.calls[0]?.[0] as AskMeStep | undefined;
    expect(call?.fields).toHaveLength(1);
    expect(call?.fields[0]?.type).toBe('text');
  });

  it("editing a field's label patches that field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskMeStep = { ...BASE_STEP, fields: [{ key: 'mood', type: 'text', label: 'Mood' }] };
    render(<AskMeConfig step={step} onChange={onChange} testId="automations-askme-a" />);
    await user.type(screen.getByTestId('automations-askme-a-field-0-label'), '!');
    expect(onChange).toHaveBeenLastCalledWith({
      ...step,
      fields: [{ key: 'mood', type: 'text', label: 'Mood!' }],
    });
  });

  it('removing a field drops it from step.fields', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskMeStep = {
      ...BASE_STEP,
      fields: [
        { key: 'mood', type: 'text', label: 'Mood' },
        { key: 'sleep', type: 'number', label: 'Sleep' },
      ],
    };
    render(<AskMeConfig step={step} onChange={onChange} testId="automations-askme-a" />);
    await user.click(screen.getByTestId('automations-askme-a-field-0-remove'));
    expect(onChange).toHaveBeenCalledWith({ ...step, fields: [{ key: 'sleep', type: 'number', label: 'Sleep' }] });
  });
});

describe('AskMeConfig — options chips (choice/multi)', () => {
  it('shows an options editor for a choice field and adding an option appends it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskMeStep = {
      ...BASE_STEP,
      fields: [{ key: 'mood', type: 'choice', label: 'Mood', options: ['Great'] }],
    };
    render(<AskMeConfig step={step} onChange={onChange} testId="automations-askme-a" />);
    expect(screen.getByText('Great')).toBeInTheDocument();
    await user.type(screen.getByTestId('automations-askme-a-field-0-options-input'), 'OK{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({
      ...step,
      fields: [{ key: 'mood', type: 'choice', label: 'Mood', options: ['Great', 'OK'] }],
    });
  });

  it('hides the options editor for text/number fields', () => {
    const step: AskMeStep = { ...BASE_STEP, fields: [{ key: 'sleep', type: 'number', label: 'Sleep' }] };
    render(<AskMeConfig step={step} onChange={vi.fn()} testId="automations-askme-a" />);
    expect(screen.queryByTestId('automations-askme-a-field-0-options-input')).not.toBeInTheDocument();
  });

  it('shows the options editor for multi fields too', () => {
    const step: AskMeStep = {
      ...BASE_STEP,
      fields: [{ key: 'symptoms', type: 'multi', label: 'Symptoms', options: [] }],
    };
    render(<AskMeConfig step={step} onChange={vi.fn()} testId="automations-askme-a" />);
    expect(screen.getByTestId('automations-askme-a-field-0-options-input')).toBeInTheDocument();
  });
});

describe('AskMeConfig — show-when', () => {
  it('offers a "show only when…" affordance keyed off other fields, and adding one patches showWhen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskMeStep = {
      ...BASE_STEP,
      fields: [
        { key: 'symptoms', type: 'multi', label: 'Symptoms', options: ['Other'] },
        { key: 'other', type: 'text', label: 'Other symptom' },
      ],
    };
    render(<AskMeConfig step={step} onChange={onChange} testId="automations-askme-a" />);
    await user.click(screen.getByTestId('automations-askme-a-field-1-add-showwhen'));
    const call = onChange.mock.calls[0]?.[0] as AskMeStep | undefined;
    expect(call?.fields[1]?.showWhen?.key).toBe('symptoms');
  });

  it('renders the showWhen key/equals editor once set, and editing equals patches it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskMeStep = {
      ...BASE_STEP,
      fields: [
        { key: 'symptoms', type: 'multi', label: 'Symptoms', options: ['Other'] },
        { key: 'other', type: 'text', label: 'Other symptom', showWhen: { key: 'symptoms', equals: 'Othe' } },
      ],
    };
    render(<AskMeConfig step={step} onChange={onChange} testId="automations-askme-a" />);
    // Single trailing keystroke on an already-rendered value — matching this
    // suite's other controlled-input tests (see AutomationEditor's name-input
    // test): typing a whole fresh string here would fail because the
    // component's `step` prop is static across the test, so each keystroke
    // resets the DOM back to the un-rerendered value.
    await user.type(screen.getByTestId('automations-askme-a-field-1-showwhen-equals'), 'r');
    expect(onChange).toHaveBeenLastCalledWith({
      ...step,
      fields: [
        step.fields[0],
        { key: 'other', type: 'text', label: 'Other symptom', showWhen: { key: 'symptoms', equals: 'Other' } },
      ],
    });
  });

  it('removing showWhen clears it back to the "show only when…" affordance', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const step: AskMeStep = {
      ...BASE_STEP,
      fields: [
        { key: 'symptoms', type: 'multi', label: 'Symptoms', options: ['Other'] },
        { key: 'other', type: 'text', label: 'Other symptom', showWhen: { key: 'symptoms', equals: 'Other' } },
      ],
    };
    render(<AskMeConfig step={step} onChange={onChange} testId="automations-askme-a" />);
    await user.click(screen.getByTestId('automations-askme-a-field-1-showwhen-remove'));
    expect(onChange).toHaveBeenCalledWith({
      ...step,
      fields: [step.fields[0], { key: 'other', type: 'text', label: 'Other symptom', showWhen: undefined }],
    });
  });
});

describe('AskMeConfig — failure toggle', () => {
  it('renders FailureToggle under More options, patching step.keepGoing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AskMeConfig step={BASE_STEP} onChange={onChange} testId="automations-askme-a" />);
    await user.click(screen.getByTestId('automations-askme-a-more'));
    await user.click(screen.getByTestId('automations-askme-a-keepgoing'));
    expect(onChange).toHaveBeenCalledWith({ ...BASE_STEP, keepGoing: true });
  });
});
