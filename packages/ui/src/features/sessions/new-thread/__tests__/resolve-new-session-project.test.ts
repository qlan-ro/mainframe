/**
 * resolveNewSessionProject — pure target resolution shared by every "+" entry
 * point (spec: pill → active session's project → none).
 */
import { describe, it, expect } from 'vitest';
import { resolveNewSessionProject } from '../resolve-new-session-project';

describe('resolveNewSessionProject', () => {
  it("the pill's sole project wins over the active session's project", () => {
    expect(resolveNewSessionProject('proj-pill', 'proj-active')).toBe('proj-pill');
  });

  it("with no pill, the active session's project is returned", () => {
    expect(resolveNewSessionProject(null, 'proj-active')).toBe('proj-active');
  });

  it('a projectless active thread and no pill yields null', () => {
    expect(resolveNewSessionProject(null, undefined)).toBeNull();
  });

  it("a multi-project pill (sole id null) falls through to the active session's project", () => {
    // Callers pass soleProjectId(filterProjectIds), which is already null for a
    // multi-project scope — this pins that the resolver treats it identically
    // to "no pill".
    expect(resolveNewSessionProject(null, 'proj-active')).toBe('proj-active');
  });
});
