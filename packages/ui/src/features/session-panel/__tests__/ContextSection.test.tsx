/**
 * ContextSection — unit tests.
 *
 * Behaviors covered:
 *  - memory files render per scope with a `global`/`project` badge and an
 *    estimated token size, and open on click
 *  - in-session file mentions render as their own sub-group, badged (D14)
 *  - the Skills sub-group lists the skills THIS session invoked, never the
 *    available-skills catalog, and never re-lists them under Session
 *  - Manage renders even with no skills — the only route to the Setup Advisor's
 *    skills sheet, which owns the catalog
 *  - agents are gone from the product surface (D15)
 *  - the attachments grid mounts only when the session has attachments
 *
 * Replaces the retired bottom panel's `{ContextSection,SkillsList,SkillsList.manage-link}.test.tsx`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@v2/components/ui/tooltip';

let mockContext: SessionContext | null = null;
vi.mock('@/features/sessions/use-session-context', () => ({
  useSessionContext: () => ({ context: mockContext, chatId: 'chat-9' }),
}));

const openSheet = vi.fn();
vi.mock('@/features/setup-advisor/use-setup-advisor', () => ({
  useSetupAdvisor: (selector: (s: { openSheet: typeof openSheet }) => unknown) => selector({ openSheet }),
}));

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => emitSurfaceIntent(...a) }));

const getAttachment = vi.fn().mockResolvedValue({
  name: 'shot.png',
  mediaType: 'image/png',
  sizeBytes: 1,
  kind: 'image',
  data: 'QUJD',
});
vi.mock('@/lib/api/attachments', () => ({ getAttachment: (...a: unknown[]) => getAttachment(...a) }));

const { ContextSection } = await import('../ContextSection');

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}
const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: Wrapper });

const emptyContext: SessionContext = {
  globalFiles: [],
  projectFiles: [],
  mentions: [],
  attachments: [],
  modifiedFiles: [],
  skillFiles: [],
};

const onToggle = vi.fn();
const section = () => <ContextSection port={31415} open onToggle={onToggle} />;

beforeEach(() => {
  mockContext = emptyContext;
  openSheet.mockReset();
  emitSurfaceIntent.mockReset();
  getAttachment.mockClear();
  onToggle.mockReset();
});

describe('ContextSection — memory files', () => {
  beforeEach(() => {
    mockContext = {
      ...emptyContext,
      globalFiles: [{ path: '/Users/dev/.claude/CLAUDE.md', content: 'x'.repeat(12_800), source: 'global' }],
      projectFiles: [{ path: 'CLAUDE.md', content: 'y'.repeat(4000), source: 'project' }],
    };
  });

  it('renders a row per file with its scope and an estimated size', () => {
    render(section());
    const global = screen.getByTestId('session-panel-context-file-/Users/dev/.claude/CLAUDE.md');
    expect(global).toHaveTextContent('CLAUDE.md');
    expect(global).toHaveTextContent('global');
    expect(global).toHaveTextContent('~3.2k');

    const project = screen.getByTestId('session-panel-context-file-CLAUDE.md');
    expect(project).toHaveTextContent('project');
    expect(project).toHaveTextContent('~1k');
  });

  it('opens a file on click', () => {
    render(section());
    fireEvent.click(screen.getByTestId('session-panel-context-file-CLAUDE.md'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'CLAUDE.md' });
  });
});

describe('ContextSection — session items (D14)', () => {
  it('renders in-session file mentions with their badges', () => {
    mockContext = {
      ...emptyContext,
      mentions: [
        {
          id: 'm-1',
          kind: 'file',
          name: 'app.ts',
          path: 'src/app.ts',
          source: 'user',
          timestamp: '2026-08-06T10:00:00Z',
        },
      ],
      modifiedFiles: ['src/edited.ts'],
      skillFiles: [{ path: '/skills/review/SKILL.md', displayName: 'review' }],
    };
    render(section());

    expect(screen.getByTestId('session-panel-session-item-src/app.ts')).toHaveTextContent('@');
    expect(screen.getByTestId('session-panel-session-item-src/edited.ts')).toHaveTextContent('plan');
    // The invoked skill belongs to the Skills sub-group and is not re-listed here.
    expect(screen.queryByTestId('session-panel-session-item-/skills/review/SKILL.md')).toBeNull();
  });

  it('renders no session sub-group when nothing was touched', () => {
    render(section());
    expect(screen.queryByTestId('session-panel-session-item-src/app.ts')).toBeNull();
  });
});

describe('ContextSection — skills', () => {
  const withSkills: SessionContext = {
    ...emptyContext,
    skillFiles: [
      { path: '/skills/review/SKILL.md', displayName: 'Review' },
      { path: '/skills/deploy/SKILL.md', displayName: 'Deploy' },
    ],
  };

  it('renders a row per skill this session invoked, named and path-titled', () => {
    mockContext = withSkills;
    render(section());
    const row = screen.getByTestId('session-panel-skill-/skills/review/SKILL.md');
    expect(row).toHaveTextContent('Review');
    expect(row).toHaveAttribute('aria-label', '/skills/review/SKILL.md');
    expect(screen.getByTestId('session-panel-skill-/skills/deploy/SKILL.md')).toHaveTextContent('Deploy');
  });

  it('opens a skill file on click', () => {
    mockContext = withSkills;
    render(section());
    fireEvent.click(screen.getByTestId('session-panel-skill-/skills/review/SKILL.md'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: '/skills/review/SKILL.md' });
  });

  it('lists no available-skills catalog — only what the session invoked', () => {
    mockContext = withSkills;
    render(section());
    expect(screen.getAllByTestId(/^session-panel-skill-/)).toHaveLength(2);
    expect(screen.queryByTestId('session-panel-skills-empty')).toBeNull();
  });

  it('keeps Manage with no skills — the only route to the advisor skills sheet', () => {
    render(section());
    expect(screen.getByTestId('session-panel-skills-empty')).toHaveTextContent('No skills used');
    fireEvent.click(screen.getByTestId('session-panel-skills-manage'));
    expect(openSheet).toHaveBeenCalledWith('skills');
  });

  it('renders no agent rows — agents left the product surface (D15)', () => {
    mockContext = withSkills;
    render(section());
    expect(screen.queryByTestId('sidebar-agent-item-a-1')).toBeNull();
    expect(screen.queryByText('Agents')).toBeNull();
  });
});

describe('ContextSection — attachments', () => {
  it('mounts the grid only when the session has attachments', () => {
    render(section());
    expect(screen.queryByTestId('session-panel-attachment-grid')).toBeNull();

    mockContext = {
      ...emptyContext,
      attachments: [{ id: 'att-1', name: 'shot.png', mediaType: 'image/png', sizeBytes: 10, kind: 'image' }],
    };
    render(section());
    expect(screen.getByTestId('session-panel-attachment-grid')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-attachment-att-1')).toBeInTheDocument();
  });
});

describe('ContextSection — section count', () => {
  it('counts every item across the four sub-groups', () => {
    mockContext = {
      ...emptyContext,
      projectFiles: [{ path: 'CLAUDE.md', content: 'x', source: 'project' }],
      mentions: [
        {
          id: 'm-1',
          kind: 'file',
          name: 'app.ts',
          path: 'src/app.ts',
          source: 'user',
          timestamp: '2026-08-06T10:00:00Z',
        },
      ],
      attachments: [{ id: 'att-1', name: 'shot.png', mediaType: 'image/png', sizeBytes: 10, kind: 'image' }],
      skillFiles: [{ path: '/skills/review/SKILL.md', displayName: 'Review' }],
    };
    render(section());
    expect(screen.getByTestId('session-panel-section-toggle-context')).toHaveTextContent('4');
  });
});
