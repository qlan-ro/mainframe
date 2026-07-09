/**
 * WfStepList — TDD tests for the recursive step-list editor. Covers nested
 * rendering for a composite step's children (revealed once its Configure
 * panel is open), path-scoped insert/remove that touches only the addressed
 * list, and per-row scope resolution (each row gets its own `WfStepPath`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfStepList } from '@/features/workflows/editor/WfStepList';
import { scopeForPath } from '@/features/workflows/editor/config/wf-scope';
import type { WfDraft, WfStep } from '@/features/workflows/editor/wf-draft-types';

vi.mock('@/features/workflows/editor/config/wf-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/workflows/editor/config/wf-scope')>();
  return { ...actual, scopeForPath: vi.fn(actual.scopeForPath) };
});

function baseDraft(steps: WfStep[]): WfDraft {
  return { name: '', description: '', scope: 'project', triggers: [], inputs: [], vars: [], outputs: [], steps };
}

function chooseDraft(): WfDraft {
  return baseDraft([
    {
      id: 'c1',
      kind: 'choose',
      arms: [
        { when: 'true', steps: [{ id: 's0', kind: 'set', set: { v: 0 } }] },
        { when: 'false', steps: [{ id: 's1', kind: 'set', set: { v: 1 } }] },
      ],
    },
  ]);
}

function foreachDraft(): WfDraft {
  return baseDraft([
    { id: 'fe1', kind: 'foreach', over: '${ items }', as: 'item', steps: [{ id: 'b0', kind: 'set', set: { v: 0 } }] },
  ]);
}

function firstStep(root: WfStep[]): WfStep {
  return root[0]!;
}

describe('WfStepList', () => {
  it("renders nested rows for a choose step's arms once its Configure panel is open", () => {
    const draft = chooseDraft();
    render(<WfStepList draft={draft} path={[]} onRootChange={vi.fn()} />);

    expect(screen.getByTestId('workflows-builder-step-c1')).toBeInTheDocument();
    expect(screen.queryByTestId('workflows-builder-step-s0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('workflows-builder-step-configure-c1'));

    expect(screen.getByTestId('workflows-builder-step-s0')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-builder-step-s1')).toBeInTheDocument();
  });

  it('adding a step inside one arm only grows that arm, leaving the sibling arm untouched', () => {
    const draft = chooseDraft();
    const onRootChange = vi.fn();
    render(<WfStepList draft={draft} path={[]} onRootChange={onRootChange} />);

    fireEvent.click(screen.getByTestId('workflows-builder-step-configure-c1'));
    fireEvent.click(screen.getByTestId('workflows-builder-add-step-c1-arm-0'));
    fireEvent.click(screen.getByTestId('workflows-steplib-agent'));

    expect(onRootChange).toHaveBeenCalledOnce();
    const nextChoose = firstStep(onRootChange.mock.calls[0]![0] as WfStep[]);
    if (nextChoose.kind !== 'choose') throw new Error('expected choose');
    expect(nextChoose.arms[0]!.steps).toHaveLength(2);
    expect(nextChoose.arms[1]!.steps).toHaveLength(1);
    expect(nextChoose.arms[1]!.steps[0]!.id).toBe('s1');
  });

  it('removing a nested step reverts its arm to empty, leaving the sibling arm untouched', () => {
    const draft = chooseDraft();
    const onRootChange = vi.fn();
    render(<WfStepList draft={draft} path={[]} onRootChange={onRootChange} />);

    fireEvent.click(screen.getByTestId('workflows-builder-step-configure-c1'));
    fireEvent.click(screen.getByTestId('workflows-builder-step-remove-s0'));

    expect(onRootChange).toHaveBeenCalledOnce();
    const nextChoose = firstStep(onRootChange.mock.calls[0]![0] as WfStep[]);
    if (nextChoose.kind !== 'choose') throw new Error('expected choose');
    expect(nextChoose.arms[0]!.steps).toHaveLength(0);
    expect(nextChoose.arms[1]!.steps).toHaveLength(1);
  });

  it('calls scopeForPath once per rendered row, each with its own distinct path', () => {
    const draft = foreachDraft();
    render(<WfStepList draft={draft} path={[]} onRootChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('workflows-builder-step-configure-fe1'));

    const paths = vi.mocked(scopeForPath).mock.calls.map(([, path]) => path);
    expect(paths).toContainEqual([0]);
    expect(paths).toContainEqual([0, 0]);
  });
});
