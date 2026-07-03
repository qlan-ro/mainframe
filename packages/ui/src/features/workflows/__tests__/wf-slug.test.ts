/**
 * wf-slug — TDD tests for deriveWorkflowId.
 *
 * The daemon's PUT /api/workflows/:id route (packages/core/src/server/routes/workflows.ts
 * `resolveWorkflowDir`) reads scope from the `<scope>:<name>` id, not from the YAML body:
 * 'global' -> <dataDir>/workflows, any other segment -> looked up as a project id ->
 * <project.path>/.mainframe/workflows. There is no builder-level project picker, so
 * "This project" scope resolves to the active session's project (the same source
 * MainToolbar/useActiveIdentity already use elsewhere in the shell).
 */
import { describe, it, expect } from 'vitest';
import { deriveWorkflowId } from '@/features/workflows/editor/wf-slug';

const YAML = 'version: 1\nname: My Workflow\nsteps:\n  - id: a\n    set: { x: 1 }\n';

describe('deriveWorkflowId', () => {
  it('global scope always uses the global: prefix', () => {
    expect(deriveWorkflowId(YAML, 'global')).toBe('global:my-workflow');
  });

  it('global scope ignores an active projectId', () => {
    expect(deriveWorkflowId(YAML, 'global', 'proj-abc')).toBe('global:my-workflow');
  });

  it('project scope uses the active session project id when known', () => {
    expect(deriveWorkflowId(YAML, 'project', 'proj-abc')).toBe('proj-abc:my-workflow');
  });

  it('project scope falls back to global: when no active project is known', () => {
    expect(deriveWorkflowId(YAML, 'project')).toBe('global:my-workflow');
  });
});
