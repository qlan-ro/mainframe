/**
 * stampAgentProjectId — todo #234 bullet 4: an `ask_agent` step's worktree
 * carries no project picker of its own; it inherits the automation's
 * resolved project automatically. `AutomationEditor.handleSave` runs every
 * step through this before saving. TDD: test written first, implemented
 * after.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationStep } from '../../contract';
import { stampAgentProjectId } from '../stamp-agent-project-id';

describe('stampAgentProjectId', () => {
  it('sets projectId on a top-level ask_agent step, overwriting any existing value', () => {
    const steps: AutomationStep[] = [
      { id: 'a', kind: 'ask_agent', prompt: [], projectId: 'stale' },
      { id: 'b', kind: 'ask_agent', prompt: [] },
    ];
    const result = stampAgentProjectId(steps, 'proj-9');
    expect(result).toEqual([
      { id: 'a', kind: 'ask_agent', prompt: [], projectId: 'proj-9' },
      { id: 'b', kind: 'ask_agent', prompt: [], projectId: 'proj-9' },
    ]);
  });

  it('leaves non-agent steps untouched', () => {
    const steps: AutomationStep[] = [{ id: 'n', kind: 'notify', message: ['hi'] }];
    expect(stampAgentProjectId(steps, 'proj-9')).toEqual(steps);
  });

  it('recurses into if/repeat blocks', () => {
    const steps: AutomationStep[] = [
      {
        id: 'i',
        kind: 'if',
        match: 'all',
        conditions: [],
        then: [{ id: 'a1', kind: 'ask_agent', prompt: [] }],
        otherwise: [{ id: 'a2', kind: 'ask_agent', prompt: [] }],
      },
      {
        id: 'r',
        kind: 'repeat',
        items: { stepId: 'builtin', output: 'today' },
        steps: [{ id: 'a3', kind: 'ask_agent', prompt: [] }],
      },
    ];
    const result = stampAgentProjectId(steps, 'proj-9');
    expect(result).toEqual([
      {
        id: 'i',
        kind: 'if',
        match: 'all',
        conditions: [],
        then: [{ id: 'a1', kind: 'ask_agent', prompt: [], projectId: 'proj-9' }],
        otherwise: [{ id: 'a2', kind: 'ask_agent', prompt: [], projectId: 'proj-9' }],
      },
      {
        id: 'r',
        kind: 'repeat',
        items: { stepId: 'builtin', output: 'today' },
        steps: [{ id: 'a3', kind: 'ask_agent', prompt: [], projectId: 'proj-9' }],
      },
    ]);
  });
});
