/**
 * WfbStepRow — TDD test for the kind-icon resolution bug.
 *
 * WfbStepRow receives MODEL kinds (branch/loop/subflow/service), which are
 * not direct keys in KIND_META (the canonical vocabulary is choose/foreach/
 * call/connector). Calling getKindMeta(step.kind) directly falls through to
 * the gray DEFAULT_KIND_META ("Value") for these steps — the same bug
 * already fixed in WfStepLibrary via getKindMetaByModel.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WfbStepRow } from '@/features/workflows/editor/WfbStepRow';
import type { WfStep } from '@/features/workflows/editor/yaml-serialize';

function branchStep(): WfStep {
  return { id: 'b1', kind: 'branch', arms: [{ cond: 'true', steps: [] }] };
}

describe('WfbStepRow', () => {
  it('resolves the Branch label/icon meta for a model "branch" step, not the "Value" default', () => {
    render(<WfbStepRow step={branchStep()} index={0} onRemove={vi.fn()} />);
    const row = screen.getByTestId('workflows-builder-step-b1');
    expect(row.textContent).toContain('arms');
    // The title input falls back to meta.label when step.title is unset.
    const titleInput = screen.getByTestId('workflows-builder-step-title-b1') as HTMLInputElement;
    expect(titleInput.value).toBe('Branch');
    expect(titleInput.value).not.toBe('Value');
  });

  it('resolves the Loop label for a model "loop" step, not the "Value" default', () => {
    const step: WfStep = { id: 'l1', kind: 'loop', over: '${ items }', as: 'item', steps: [] };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-l1') as HTMLInputElement;
    expect(titleInput.value).toBe('Loop');
  });

  it('resolves the Sub-workflow label for a model "subflow" step, not the "Value" default', () => {
    const step: WfStep = { id: 'sf1', kind: 'subflow', ref: 'ship-work' };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-sf1') as HTMLInputElement;
    expect(titleInput.value).toBe('Sub-workflow');
  });

  it('resolves the Service label for a model "service" step, not the "Value" default', () => {
    const step: WfStep = { id: 'svc1', kind: 'service', connector: 'files', action: 'append' };
    render(<WfbStepRow step={step} index={0} onRemove={vi.fn()} />);
    const titleInput = screen.getByTestId('workflows-builder-step-title-svc1') as HTMLInputElement;
    expect(titleInput.value).toBe('Service');
  });
});
