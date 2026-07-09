/**
 * FormFieldsSlot — fields editor + `when` builder for the `form` step.
 *
 * FormFieldsSlot is a pure props-in renderer; `Harness` holds the step in
 * React state and feeds `onPatch` back in so a click can be immediately
 * followed by an assertion against the re-rendered DOM (e.g. the options
 * editor appearing after switching a field to `choice`). `onPatchSpy` still
 * gets every raw patch so we can assert the exact shape emitted.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormFieldsSlot } from '@/features/workflows/editor/config/FormFieldsSlot';
import type { WfField, WfStep } from '@/features/workflows/editor/wf-draft-types';

function Harness({ initial, onPatchSpy }: { initial: WfStep; onPatchSpy: (patch: Partial<WfStep>) => void }) {
  const [step, setStep] = useState(initial);
  function onPatch(patch: Partial<WfStep>): void {
    onPatchSpy(patch);
    setStep((s) => ({ ...s, ...patch }) as WfStep);
  }
  return <FormFieldsSlot step={step} onPatch={onPatch} scope={[]} />;
}

function formStep(id: string, fields: WfField[]): WfStep {
  return { id, kind: 'form', form: { title: 'T', fields } };
}

describe('FormFieldsSlot', () => {
  it('adds a field and patches a 2-element fields array', () => {
    const onPatchSpy = vi.fn();
    render(<Harness initial={formStep('frm1', [{ key: 'name', type: 'text' }])} onPatchSpy={onPatchSpy} />);

    fireEvent.click(screen.getByTestId('workflows-config-frm1-field-add'));

    const patch = onPatchSpy.mock.calls[0]![0] as { form: { fields: WfField[] } };
    expect(patch.form.fields).toHaveLength(2);
  });

  it('switching a field to choice reveals the options editor', () => {
    render(<Harness initial={formStep('frm2', [{ key: 'flavor', type: 'text' }])} onPatchSpy={vi.fn()} />);

    expect(screen.queryByTestId('workflows-config-frm2-field-flavor-option-add')).toBeNull();

    fireEvent.click(screen.getByTestId('workflows-config-frm2-field-flavor-type'));
    fireEvent.click(screen.getByTestId('workflows-config-frm2-field-flavor-type-option-choice'));

    expect(screen.getByTestId('workflows-config-frm2-field-flavor-option-add')).toBeInTheDocument();
  });

  it('adds an option to a choice field', () => {
    render(
      <Harness
        initial={formStep('frm3', [{ key: 'flavor', type: 'choice', options: ['vanilla'] }])}
        onPatchSpy={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('workflows-config-frm3-field-flavor-option-add'));

    expect(screen.getByTestId('workflows-config-frm3-field-flavor-option-0')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-config-frm3-field-flavor-option-1')).toBeInTheDocument();
  });

  it('sets a when clause referencing another field key', () => {
    const onPatchSpy = vi.fn();
    render(
      <Harness
        initial={formStep('frm4', [
          { key: 'country', type: 'text' },
          { key: 'state', type: 'text' },
        ])}
        onPatchSpy={onPatchSpy}
      />,
    );

    // Only the OTHER field's key is offered, never the row's own key.
    fireEvent.click(screen.getByTestId('workflows-config-frm4-field-state-when-key'));
    expect(screen.queryByTestId('workflows-config-frm4-field-state-when-key-option-state')).toBeNull();
    fireEvent.click(screen.getByTestId('workflows-config-frm4-field-state-when-key-option-country'));
    fireEvent.change(screen.getByTestId('workflows-config-frm4-field-state-when-equals'), {
      target: { value: 'US' },
    });

    const lastPatch = onPatchSpy.mock.calls[onPatchSpy.mock.calls.length - 1]![0] as { form: { fields: WfField[] } };
    const stateField = lastPatch.form.fields.find((f) => f.key === 'state');
    expect(stateField?.when).toEqual({ key: 'country', equals: 'US' });
  });

  it('patches key, label, and required from the row baseline controls', () => {
    const onPatchSpy = vi.fn();
    render(<Harness initial={formStep('frm5', [{ key: 'name', type: 'text' }])} onPatchSpy={onPatchSpy} />);

    fireEvent.change(screen.getByTestId('workflows-config-frm5-field-name-label'), {
      target: { value: 'Full name' },
    });
    fireEvent.click(screen.getByTestId('workflows-config-frm5-field-name-required'));

    const lastPatch = onPatchSpy.mock.calls[onPatchSpy.mock.calls.length - 1]![0] as { form: { fields: WfField[] } };
    expect(lastPatch.form.fields[0]).toEqual(
      expect.objectContaining({ key: 'name', label: 'Full name', required: true }),
    );
  });

  it('reorders fields via the move-down button', () => {
    const onPatchSpy = vi.fn();
    render(
      <Harness
        initial={formStep('frm6', [
          { key: 'a', type: 'text' },
          { key: 'b', type: 'text' },
        ])}
        onPatchSpy={onPatchSpy}
      />,
    );

    fireEvent.click(screen.getByTestId('workflows-config-frm6-field-a-move-down'));

    const patch = onPatchSpy.mock.calls[0]![0] as { form: { fields: WfField[] } };
    expect(patch.form.fields.map((f) => f.key)).toEqual(['b', 'a']);
  });

  it('removes a field', () => {
    const onPatchSpy = vi.fn();
    render(
      <Harness
        initial={formStep('frm7', [
          { key: 'a', type: 'text' },
          { key: 'b', type: 'text' },
        ])}
        onPatchSpy={onPatchSpy}
      />,
    );

    fireEvent.click(screen.getByTestId('workflows-config-frm7-field-a-remove'));

    const patch = onPatchSpy.mock.calls[0]![0] as { form: { fields: WfField[] } };
    expect(patch.form.fields.map((f) => f.key)).toEqual(['b']);
  });
});
