/**
 * Placeholder-render coverage for the remaining typed custom-slot stub.
 * Task 15 replaced AgentConfigSlot's body in place (see AgentConfigSlot.test.tsx
 * for its real coverage now); this file only pins FormFieldsSlot's placeholder
 * testid contract until Task 16 replaces it too, at which point this file is
 * deleted entirely (see FormFieldsSlot.test.tsx for its real coverage).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormFieldsSlot } from '@/features/workflows/editor/config/FormFieldsSlot';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';

describe('custom-slot stubs', () => {
  it('FormFieldsSlot renders the not-yet-implemented placeholder', () => {
    const step: WfStep = { id: 'fm1', kind: 'form', form: { title: 'T', fields: [] } };
    render(<FormFieldsSlot step={step} onPatch={vi.fn()} scope={[]} />);
    expect(screen.getByTestId('workflows-config-fm1-not-yet-implemented')).toBeInTheDocument();
  });
});
