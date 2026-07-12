import { describe, expect, it } from 'vitest';
import type { Project } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '../chat-to-thread-custom';
import { sortProjectsByRecentActivity } from '../project-activity';

const PROJECTS: Project[] = [
  project('p1', 'Alpha'),
  project('p2', 'Beta'),
  project('p3', 'Gamma'),
  project('p4', 'No sessions'),
];

function project(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/projects/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
  };
}

function item(id: string, projectId: string, updatedAt: number): SessionItem {
  return {
    id,
    status: 'regular',
    custom: {
      projectId,
      adapterId: 'claude',
      tags: [],
      pinned: false,
      status: 'active',
      displayStatus: 'idle',
      hasPending: false,
      detectedPrs: [],
      worktreeMissing: false,
      transcriptMissing: false,
      updatedAt,
    },
  };
}

describe('sortProjectsByRecentActivity', () => {
  it('orders projects by their most recent session update, newest first', () => {
    const sorted = sortProjectsByRecentActivity(PROJECTS, [
      item('old-p1', 'p1', 100),
      item('new-p1', 'p1', 400),
      item('newest-p3', 'p3', 900),
      item('mid-p2', 'p2', 500),
    ]);

    expect(sorted.map((project) => project.id)).toEqual(['p3', 'p2', 'p1', 'p4']);
  });

  it('keeps input order as the tie-breaker for projects with the same activity', () => {
    const sorted = sortProjectsByRecentActivity(PROJECTS, [item('same-p1', 'p1', 300), item('same-p2', 'p2', 300)]);

    expect(sorted.map((project) => project.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});
