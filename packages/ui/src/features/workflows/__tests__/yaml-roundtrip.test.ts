/**
 * YAML round-trip — proves parse -> serialize -> parse is model-identity on
 * every canonical fixture, that re-serialized output still validates under
 * core's grammar, and that agent.worktree survives a form-edit that never
 * touches it (Resolution 1 — the v1 agent form has no worktree control).
 */
import { describe, it, expect } from 'vitest';
import { parseWorkflowYaml } from '@qlan-ro/mainframe-core/workflows/dsl';
import { serializeWorkflow } from '@/features/workflows/editor/yaml-serialize';
import { parseWorkflowToDraft } from '@/features/workflows/editor/yaml-parse';
import { CANONICAL_FIXTURES } from './fixtures';

describe('YAML round-trip', () => {
  it.each(CANONICAL_FIXTURES)('$name: parse -> serialize -> parse is model-identity', ({ yaml }) => {
    const first = parseWorkflowToDraft(yaml);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parseWorkflowToDraft(serializeWorkflow(first.draft));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.draft).toEqual(first.draft);
  });

  it.each(CANONICAL_FIXTURES)('$name: re-serialized output still validates under core', ({ yaml }) => {
    const r = parseWorkflowToDraft(yaml);
    if (!r.ok) return;
    expect(() => parseWorkflowYaml(serializeWorkflow(r.draft))).not.toThrow();
  });

  it('preserves an uppercase/underscore hydrated name through parse -> serialize', () => {
    const onDisk = ['version: 1', 'name: Release_Candidate', 'steps:', '  - id: a', '    set: { x: 1 }'].join('\n');
    const hydrated = parseWorkflowToDraft(onDisk);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    expect(hydrated.draft.name).toBe('Release_Candidate');

    const reparsed = parseWorkflowToDraft(serializeWorkflow(hydrated.draft));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.draft.name).toBe('Release_Candidate');
  });

  it('preserves agent.worktree through hydrate -> form-edit -> serialize', () => {
    const onDisk = [
      'version: 1',
      'name: keep-worktree',
      'steps:',
      '  - id: work',
      '    agent:',
      '      prompt: do it',
      '      model: sonnet',
      '      worktree:',
      '        branchName: feat/x',
      '        baseBranch: main',
    ].join('\n');
    const hydrated = parseWorkflowToDraft(onDisk);
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;

    // Simulate the agent form patching a non-worktree field (as AgentConfigSlot does:
    // spread ...step.agent so worktree is carried through, never dropped).
    const step = hydrated.draft.steps[0];
    if (!step || step.kind !== 'agent') throw new Error('expected agent step');
    const edited = {
      ...hydrated.draft,
      steps: [{ ...step, agent: { ...step.agent, timeoutMinutes: 30 } }],
    };

    const reparsed = parseWorkflowToDraft(serializeWorkflow(edited));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok && reparsed.draft.steps[0]?.kind === 'agent') {
      expect(reparsed.draft.steps[0].agent.worktree).toEqual({ branchName: 'feat/x', baseBranch: 'main' });
      expect(reparsed.draft.steps[0].agent.timeoutMinutes).toBe(30);
    }
  });
});
