/**
 * WfbStepRow — TDD test for kind-icon resolution.
 *
 * WfbStepRow receives canonical v2 kinds (choose/foreach/call/service) and
 * resolves them directly via getKindMeta — the model and canonical
 * vocabularies no longer diverge (KIND_ALIAS/getKindMetaByModel removed).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WfbStepRow } from '@/features/workflows/editor/WfbStepRow';
import type { WfStep } from '@/features/workflows/editor/yaml-serialize';

function chooseStep(): WfStep {
  return { id: 'b1', kind: 'choose', arms: [{ when: 'true', steps: [] }] };
}

describe('WfbStepRow', () => {
  it('resolves the Branch label/icon meta for a "choose" step, not the "Value" default', () => {
    render(<WfbStepRow step={chooseStep()} index={0} onRemove={vi.fn()} />);
    const row = screen.getByTestId('workflows-builder-step-b1');
    expect(row.textContent).toContain('arms');
    // The title input falls back to meta.label when step.name is unset.
    const titleInput = screen.getByTestId('workflows-builder-step-title-b1') as HTMLInputElement;
    expect(titleInput.value).toBe('Branch');
    expect(titleInput.value).not.toBe('Value');
  });

  it('resolves the Loop label for a "foreach" step, not the "Value" default', () => {
    const step: WfStep = { id: 'l1', kind: 'foreach', over: '${ items }', as: 'item', steps: [] };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-l1') as HTMLInputElement;
    expect(titleInput.value).toBe('Loop');
  });

  it('resolves the Sub-workflow label for a "call" step, not the "Value" default', () => {
    const step: WfStep = { id: 'sf1', kind: 'call', ref: 'ship-work' };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-sf1') as HTMLInputElement;
    expect(titleInput.value).toBe('Sub-workflow');
  });

  it('resolves the Service label for a "service" step, not the "Value" default', () => {
    const step: WfStep = { id: 'svc1', kind: 'service', connector: 'files.append' };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-svc1') as HTMLInputElement;
    expect(titleInput.value).toBe('Service');
  });
});
