/**
 * SidebarScopeStrip — orders the scope avatars most recently used first, by
 * each project's latest session activity; in-scope projects still lead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSessionFilters } from '@/store/session-filters';

let __threadItems: Array<{ id: string; status: string; custom: { projectId: string; updatedAt: number } }> = [];

vi.mock('../use-projects', () => ({
  useProjects: () => ({
    projects: [
      { id: 'p1', name: 'Alpha', path: '/p1', createdAt: '', lastOpenedAt: '' },
      { id: 'p2', name: 'Beta', path: '/p2', createdAt: '', lastOpenedAt: '' },
      { id: 'p3', name: 'Gamma', path: '/p3', createdAt: '', lastOpenedAt: '' },
    ],
    reloadProjects: vi.fn(),
    removeProjectFromList: vi.fn(),
  }),
}));
vi.mock('../use-add-project', () => ({ useAddProject: () => vi.fn() }));
vi.mock('../use-remove-project', () => ({ useRemoveProject: () => vi.fn() }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: { threads: { threadItems: typeof __threadItems } }) => unknown) =>
    sel({ threads: { threadItems: __threadItems } }),
}));

import { SidebarScopeStrip } from '../SidebarScopeStrip';

function avatarOrder(): string[] {
  return screen
    .getAllByTestId(/^sessions-scope-avatar-/)
    .map((el) => el.getAttribute('data-testid')!.replace('sessions-scope-avatar-', ''));
}

function renderStrip() {
  return render(
    <TooltipProvider>
      <SidebarScopeStrip />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  __threadItems = [
    { id: 's1', status: 'regular', custom: { projectId: 'p1', updatedAt: 100 } },
    { id: 's2', status: 'regular', custom: { projectId: 'p3', updatedAt: 900 } },
    { id: 's3', status: 'regular', custom: { projectId: 'p2', updatedAt: 500 } },
  ];
  useSessionFilters.setState({ filterProjectIds: new Set() });
});

describe('SidebarScopeStrip — order', () => {
  it('puts the most recently used project first', () => {
    renderStrip();
    expect(avatarOrder()).toEqual(['p3', 'p2', 'p1']);
  });

  it('still leads with in-scope projects, recency ordering the rest', () => {
    useSessionFilters.setState({ filterProjectIds: new Set(['p1']) });
    renderStrip();
    expect(avatarOrder()).toEqual(['p1', 'p3', 'p2']);
  });
});
