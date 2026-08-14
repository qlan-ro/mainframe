/**
 * seedProjectScope — the pure rule a modal uses to pick its opening project.
 *
 * Order: sidebar filter (validated against the live project list) → active
 * session's project (validated the same way) → the sole project when there is
 * exactly one → null (unresolved, caller shows a picker).
 */
import { describe, it, expect } from 'vitest';
import { seedProjectScope } from '../seed-project-scope';

const PROJECTS = [{ id: 'proj-a' }, { id: 'proj-b' }];

describe('seedProjectScope — filter names a project present in the project list', () => {
  it('returns the filter id', () => {
    const result = seedProjectScope({
      filterProjectId: 'proj-a',
      sessionProjectId: 'proj-b',
      projects: PROJECTS,
    });

    expect(result).toBe('proj-a');
  });
});

describe('seedProjectScope — filter names an id absent from the project list', () => {
  it('falls through to the session project', () => {
    const result = seedProjectScope({
      filterProjectId: 'proj-stale',
      sessionProjectId: 'proj-b',
      projects: PROJECTS,
    });

    expect(result).toBe('proj-b');
  });
});

describe('seedProjectScope — filter unset, session project set', () => {
  it('returns the session project id', () => {
    const result = seedProjectScope({
      filterProjectId: null,
      sessionProjectId: 'proj-b',
      projects: PROJECTS,
    });

    expect(result).toBe('proj-b');
  });
});

describe('seedProjectScope — filter unset, session unset, exactly one project', () => {
  it('returns the sole project id', () => {
    const result = seedProjectScope({
      filterProjectId: null,
      sessionProjectId: null,
      projects: [{ id: 'proj-only' }],
    });

    expect(result).toBe('proj-only');
  });
});

describe('seedProjectScope — filter unset, session unset, two or more projects', () => {
  it('returns null', () => {
    const result = seedProjectScope({
      filterProjectId: null,
      sessionProjectId: null,
      projects: PROJECTS,
    });

    expect(result).toBeNull();
  });
});

describe('seedProjectScope — filter unset, session unset, no projects', () => {
  it('returns null', () => {
    const result = seedProjectScope({
      filterProjectId: null,
      sessionProjectId: null,
      projects: [],
    });

    expect(result).toBeNull();
  });
});

describe('seedProjectScope — session project names an id absent from the project list', () => {
  it('returns null rather than trusting a stale session project', () => {
    const result = seedProjectScope({
      filterProjectId: null,
      sessionProjectId: 'proj-stale',
      projects: PROJECTS,
    });

    expect(result).toBeNull();
  });
});
