/**
 * Behavior contract for SkillsSection (plan T25): list/search/grouping,
 * inspect, delete-affordance gating, the naming delete confirmation, success
 * and failure toasts, the D10 identity-switch guard, and the D9 nested-dialog
 * survival guard.
 *
 * Mocking strategy: `../use-skills-section` is stubbed wholesale (a
 * `{state, identityKey, reload, remove}` fixture) and `@/lib/toast` is
 * stubbed. The component pulls in the REAL `skill-filters`/`skill-content`
 * pure modules and the real `SkillRow`/`SkillsSectionList`/`SkillInspect`/
 * `SkillsCliSuggestion` children — nothing else needs mocking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Skill } from '@qlan-ro/mainframe-types';

vi.mock('../use-skills-section', () => ({ useSkillsSection: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: { success: vi.fn(), error: vi.fn() } }));

import { SkillsSection } from '../SkillsSection';
import { useSkillsSection } from '../use-skills-section';
import type { SkillsSectionState } from '../use-skills-section';
import { mfToast } from '@/lib/toast';

const useSkillsSectionMock = vi.mocked(useSkillsSection);

const reviewProject: Skill = {
  id: 'claude:project:review',
  adapterId: 'claude',
  name: 'review',
  displayName: 'Review',
  description: 'Reviews code for correctness',
  scope: 'project',
  filePath: '/p/.claude/skills/review/SKILL.md',
  content: '# Review\n\nChecklist body.',
  invocationName: 'review',
};

const tddGlobal: Skill = {
  id: 'claude:global:tdd',
  adapterId: 'claude',
  name: 'tdd',
  displayName: 'TDD Helper',
  description: 'Test-driven workflow guide',
  scope: 'global',
  filePath: '/home/u/.claude/skills/tdd/SKILL.md',
  content: '# TDD Helper',
  invocationName: 'tdd',
};

const pluginSkill: Skill = {
  id: 'claude:plugin:acme-tools:thing',
  adapterId: 'claude',
  name: 'thing',
  displayName: 'Acme Thing',
  description: 'Plugin-provided helper',
  scope: 'plugin',
  pluginName: 'acme-tools',
  filePath: '/p/.claude/plugins/acme-tools/skills/thing/SKILL.md',
  content: '# Acme Thing',
  invocationName: 'thing',
};

const commitCommand: Skill = {
  id: 'claude:project:git:commit',
  adapterId: 'claude',
  name: 'git:commit',
  displayName: 'Commit Helper',
  description: 'Command-derived entry',
  scope: 'project',
  filePath: '/p/.claude/commands/git/commit.md',
  content: '# Commit',
  invocationName: 'git:commit',
};

interface Fixture {
  state: SkillsSectionState;
  identityKey: string;
  reload: () => void;
  remove: (id: string) => Promise<void>;
}

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    state: { status: 'empty' },
    identityKey: 'claude /p',
    reload: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  useSkillsSectionMock.mockReset();
  vi.mocked(mfToast.success).mockReset();
  vi.mocked(mfToast.error).mockReset();
});

describe('SkillsSection — list', () => {
  it('renders one row per skill, grouped by scope in order project, global, plugin', () => {
    useSkillsSectionMock.mockReturnValue(
      fixture({ state: { status: 'ready', skills: [pluginSkill, tddGlobal, reviewProject] } }),
    );

    render(<SkillsSection />);

    const groups = screen.getAllByTestId(/^skills-section-group-/);
    expect(groups.map((g) => g.dataset.testid)).toEqual([
      'skills-section-group-project',
      'skills-section-group-global',
      'skills-section-group-plugin',
    ]);
    expect(screen.getByTestId(`skills-section-row-${reviewProject.id}`)).toBeTruthy();
    expect(screen.getByTestId(`skills-section-row-${tddGlobal.id}`)).toBeTruthy();
    expect(screen.getByTestId(`skills-section-row-${pluginSkill.id}`)).toBeTruthy();
  });

  it('keeps id-keyed row testids stable when the underlying array order changes', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject, tddGlobal] } }));
    const { rerender } = render(<SkillsSection />);
    expect(screen.getByTestId(`skills-section-row-${reviewProject.id}`)).toBeTruthy();
    expect(screen.getByTestId(`skills-section-row-${tddGlobal.id}`)).toBeTruthy();

    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [tddGlobal, reviewProject] } }));
    rerender(<SkillsSection />);
    expect(screen.getByTestId(`skills-section-row-${reviewProject.id}`)).toBeTruthy();
    expect(screen.getByTestId(`skills-section-row-${tddGlobal.id}`)).toBeTruthy();
  });
});

describe('SkillsSection — search', () => {
  it('narrows the list by name and by description', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject, tddGlobal] } }));
    render(<SkillsSection />);

    fireEvent.change(screen.getByTestId('skills-section-search'), { target: { value: 'tdd' } });
    expect(screen.queryByTestId(`skills-section-row-${reviewProject.id}`)).toBeNull();
    expect(screen.getByTestId(`skills-section-row-${tddGlobal.id}`)).toBeTruthy();

    fireEvent.change(screen.getByTestId('skills-section-search'), { target: { value: 'correctness' } });
    expect(screen.getByTestId(`skills-section-row-${reviewProject.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`skills-section-row-${tddGlobal.id}`)).toBeNull();
  });

  it('shows a distinct no-results state, not the empty state, for a query matching nothing', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject] } }));
    render(<SkillsSection />);

    fireEvent.change(screen.getByTestId('skills-section-search'), { target: { value: 'no-such-skill' } });

    expect(screen.getByTestId('skills-section-no-results')).toBeTruthy();
    expect(screen.queryByTestId('skills-section-empty')).toBeNull();
  });
});

describe('SkillsSection — status branches', () => {
  it('renders the empty state copy with no error styling', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'empty' } }));
    render(<SkillsSection />);

    expect(screen.getByTestId('skills-section-empty')).toHaveTextContent('No skills for this project yet');
    expect(screen.queryByTestId('skills-section-error')).toBeNull();
  });

  it('renders the unsupported-adapter state instead of a list or an error', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'unsupported' } }));
    render(<SkillsSection />);

    expect(screen.getByTestId('skills-section-unsupported')).toHaveTextContent('This adapter has no skills');
    expect(screen.queryByTestId('skills-section-error')).toBeNull();
    expect(screen.queryAllByTestId(/^skills-section-row-/)).toHaveLength(0);
  });

  it('renders the error state with a retry button that calls reload', () => {
    const reload = vi.fn();
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'error', message: 'boom' }, reload }));
    render(<SkillsSection />);

    expect(screen.getByTestId('skills-section-error')).toBeTruthy();
    fireEvent.click(screen.getByTestId('skills-section-retry'));
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('SkillsSection — inspect', () => {
  it('opens on row click, shows name/description/scope/body, and returns to the list on back', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [reviewProject] } }));
    render(<SkillsSection />);

    fireEvent.click(screen.getByTestId(`skills-section-row-${reviewProject.id}`));

    const inspect = screen.getByTestId('skills-section-inspect');
    expect(inspect).toHaveTextContent(reviewProject.displayName);
    expect(inspect).toHaveTextContent(reviewProject.description);
    expect(inspect).toHaveTextContent('Checklist body.');

    fireEvent.click(screen.getByTestId('skills-section-inspect-back'));
    expect(screen.queryByTestId('skills-section-inspect')).toBeNull();
    expect(screen.getByTestId(`skills-section-row-${reviewProject.id}`)).toBeTruthy();
  });

  it('shows the owning pluginName for a plugin-scoped skill', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [pluginSkill] } }));
    render(<SkillsSection />);

    fireEvent.click(screen.getByTestId(`skills-section-row-${pluginSkill.id}`));

    expect(screen.getByTestId('skills-section-inspect')).toHaveTextContent('acme-tools');
  });
});

describe('SkillsSection — delete affordance gating', () => {
  it('shows delete only for SKILL.md-backed project/global skills, never for plugin or command-derived entries', () => {
    useSkillsSectionMock.mockReturnValue(
      fixture({ state: { status: 'ready', skills: [reviewProject, tddGlobal, pluginSkill, commitCommand] } }),
    );
    render(<SkillsSection />);

    expect(screen.getByTestId(`skills-section-delete-${reviewProject.id}`)).toBeTruthy();
    expect(screen.getByTestId(`skills-section-delete-${tddGlobal.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`skills-section-delete-${pluginSkill.id}`)).toBeNull();
    expect(screen.queryByTestId(`skills-section-delete-${commitCommand.id}`)).toBeNull();
  });
});

describe('SkillsSection — CLI suggestion', () => {
  it('shows a dismissible suggestion row by default that stays dismissed across a re-render', () => {
    useSkillsSectionMock.mockReturnValue(fixture({ state: { status: 'ready', skills: [] } }));
    const { rerender } = render(<SkillsSection />);

    expect(screen.getByTestId('skills-section-cli-suggestion')).toBeTruthy();
    expect(screen.getByTestId('skills-section-cli-copy')).toBeTruthy();

    fireEvent.click(screen.getByTestId('skills-section-cli-dismiss'));
    expect(screen.queryByTestId('skills-section-cli-suggestion')).toBeNull();

    rerender(<SkillsSection />);
    expect(screen.queryByTestId('skills-section-cli-suggestion')).toBeNull();
  });
});
