/**
 * Placeholder-render coverage for the two typed custom-slot stubs. Tasks 15/16
 * replace these bodies in place; this test only pins the placeholder testid
 * contract so a drop-in replacement can't silently drop it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentConfigSlot } from '@/features/workflows/editor/config/AgentConfigSlot';
import { FormFieldsSlot } from '@/features/workflows/editor/config/FormFieldsSlot';
import type { WfStep } from '@/features/workflows/editor/wf-draft-types';

describe('custom-slot stubs', () => {
  it('AgentConfigSlot renders the not-yet-implemented placeholder', () => {
    const step: WfStep = { id: 'ag1', kind: 'agent', agent: { prompt: '' } };
    render(<AgentConfigSlot step={step} onPatch={vi.fn()} scope={[]} />);
    expect(screen.getByTestId('workflows-config-ag1-not-yet-implemented')).toBeInTheDocument();
  });

  it('FormFieldsSlot renders the not-yet-implemented placeholder', () => {
    const step: WfStep = { id: 'fm1', kind: 'form', form: { title: 'T', fields: [] } };
    render(<FormFieldsSlot step={step} onPatch={vi.fn()} scope={[]} />);
    expect(screen.getByTestId('workflows-config-fm1-not-yet-implemented')).toBeInTheDocument();
  });
});
