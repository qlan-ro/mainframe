/**
 * SetupAdvisorSheet.test.tsx
 *
 * Presentational sheet, driven entirely by props (spec AC 10, 11, 14, 15, 16, 17;
 * plan T25). Copy / copy-failure cases live in SetupAdvisorSheet.copy.test.tsx —
 * split out because they need a per-test clipboard mock the rest of this suite
 * has no reason to carry.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SetupAdvisorReport, AutomationRecommendation } from '@qlan-ro/mainframe-types';
import { SetupAdvisorSheet } from '../SetupAdvisorSheet';

const EM_DASH = '—';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRec(overrides: Partial<AutomationRecommendation> & { id: string }): AutomationRecommendation {
  return {
    category: 'mcp',
    title: 'Default title',
    signal: 'default signal',
    why: 'default why',
    command: 'default-command',
    adapters: ['*'],
    provenance: 'vendor-official',
    ...overrides,
  };
}

function makeFingerprint(signals: string[]) {
  return {
    languages: ['typescript'],
    frameworks: ['react'],
    databases: [],
    externalApis: [],
    testing: [],
    tooling: [],
    gitHost: null,
    hasClaudeConfig: false,
    hasEnvFiles: false,
    hasLockFiles: false,
    dirs: [],
    fileCount: 3,
    signals,
  };
}

const REC_MCP_1 = makeRec({
  id: 'mcp-supabase',
  category: 'mcp',
  title: 'Add the Supabase MCP server',
  signal: '@supabase/supabase-js in package.json',
  why: 'Query your database from Claude Code.',
  command: 'claude mcp add supabase npx @supabase/mcp-server\nclaude mcp list',
});
const REC_MCP_2 = makeRec({ id: 'mcp-github', category: 'mcp', title: 'Add the GitHub MCP server' });
const REC_SKILLS = makeRec({ id: 'skills-storybook', category: 'skills', title: 'Add the Storybook skill' });
const REC_PLUGINS = makeRec({ id: 'plugins-frontend-design', category: 'plugins', title: 'Install frontend-design' });

// The two file payloads: a hooks JSON snippet and a subagent Markdown body.
// Their first lines ("{" and "---") are exactly the meaningless glyphs the row
// must not render, which is what makes them the right fixtures here.
const REC_HOOKS = makeRec({
  id: 'hooks-block-edits',
  category: 'hooks',
  title: 'Block edits to secrets and lockfiles',
  command: '{\n  "hooks": {\n    "PreToolUse": []\n  }\n}',
  targetPath: '.claude/settings.json',
  provenance: 'first-party',
});
const REC_SUBAGENTS = makeRec({
  id: 'subagents-security-reviewer',
  category: 'subagents',
  title: 'security-reviewer',
  command: '---\nname: security-reviewer\n---\n\nYou review this project.',
  targetPath: '.claude/agents/security-reviewer.md',
  provenance: 'first-party',
});
// A SKILL.md scaffold — the reason payload kind is derived per recommendation
// and not per category: `skills` holds both this and `npx skills add` commands.
const REC_SKILLS_SCAFFOLD = makeRec({
  id: 'skills-project-conventions',
  category: 'skills',
  title: 'Project conventions skill',
  command: '---\nname: project-conventions\n---\n',
  targetPath: '.claude/skills/project-conventions/SKILL.md',
  provenance: 'first-party',
});

// Deliberately not in canonical category order — plugins first — so tab-order
// assertions prove the component sorts, rather than mirroring input order.
const REPORT_RICH: SetupAdvisorReport = {
  fingerprint: makeFingerprint(['TypeScript', 'React', 'PostgreSQL']),
  recommendations: [REC_PLUGINS, REC_MCP_1, REC_MCP_2, REC_SKILLS],
};

/** Every payload kind at once: shell commands, a Claude Code command, and three file payloads. */
const REPORT_ALL_KINDS: SetupAdvisorReport = {
  fingerprint: makeFingerprint(['TypeScript', 'React', 'PostgreSQL']),
  recommendations: [REC_MCP_1, REC_SKILLS, REC_SKILLS_SCAFFOLD, REC_HOOKS, REC_SUBAGENTS, REC_PLUGINS],
};

function baseProps() {
  return {
    report: null as SetupAdvisorReport | null,
    loading: false,
    error: null as string | null,
    copiedIds: new Set<string>() as ReadonlySet<string>,
    copiedCount: 0,
    onCopy: vi.fn(),
    onRetry: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — loading', () => {
  it('shows the loading skeleton and no empty-state flash', () => {
    render(<SetupAdvisorSheet {...baseProps()} loading={true} report={null} />);

    expect(screen.getByTestId('automation-recommender-loading')).toBeTruthy();
    expect(screen.getByText('Fingerprinting your project…')).toBeTruthy();
    expect(screen.queryByText('No recommendations for this project yet.')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — tabs', () => {
  it('renders one tab per category present, in canonical order, each with a count badge', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    const mcpTab = screen.getByTestId('automation-recommender-tab-mcp');
    const skillsTab = screen.getByTestId('automation-recommender-tab-skills');
    const pluginsTab = screen.getByTestId('automation-recommender-tab-plugins');

    expect(mcpTab.textContent).toContain('2');
    expect(skillsTab.textContent).toContain('1');
    expect(pluginsTab.textContent).toContain('1');
    expect(screen.queryByTestId('automation-recommender-tab-hooks')).toBeNull();
    expect(screen.queryByTestId('automation-recommender-tab-subagents')).toBeNull();

    expect(mcpTab.compareDocumentPosition(skillsTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(skillsTab.compareDocumentPosition(pluginsTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the first category active on open and swaps rows on tab click', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('Add the Supabase MCP server')).toBeTruthy();
    expect(screen.queryByText('Add the Storybook skill')).toBeNull();

    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('automation-recommender-tab-skills'));

    expect(screen.getByText('Add the Storybook skill')).toBeTruthy();
    expect(screen.queryByText('Add the Supabase MCP server')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — rows', () => {
  it('renders title, the signal chip joined to the why by an em dash, and only the first command line', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('Add the Supabase MCP server')).toBeTruthy();
    expect(screen.getByText('@supabase/supabase-js in package.json')).toBeTruthy();
    expect(screen.getByText(`${EM_DASH} Query your database from Claude Code.`, { exact: false })).toBeTruthy();
    expect(screen.getByText('claude mcp add supabase npx @supabase/mcp-server')).toBeTruthy();
    expect(screen.queryByText('claude mcp list')).toBeNull();
  });

  it('says how many lines the truncated preview hides, so a two-line command cannot copy in silence', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('+1 more line')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// File payloads
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — file payloads', () => {
  it('names the destination file instead of the snippet’s first line, for hooks', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_ALL_KINDS} />);
    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('automation-recommender-tab-hooks'));

    expect(screen.getByText('.claude/settings.json')).toBeTruthy();
    expect(screen.getByText('Paste into', { exact: false })).toBeTruthy();
    expect(screen.queryByText('{')).toBeNull();
  });

  it('names the destination file instead of the frontmatter fence, for subagents', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_ALL_KINDS} />);
    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('automation-recommender-tab-subagents'));

    expect(screen.getByText('.claude/agents/security-reviewer.md')).toBeTruthy();
    expect(screen.queryByText('---')).toBeNull();
  });

  it('distinguishes a SKILL.md scaffold from an install command inside the one skills tab', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_ALL_KINDS} />);
    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('automation-recommender-tab-skills'));

    expect(screen.getByText('.claude/skills/project-conventions/SKILL.md')).toBeTruthy();
    expect(screen.getByText('default-command')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — footer', () => {
  it('reads the terminal copy on a tab of shell commands and the Claude Code copy on plugins', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('Read-only — nothing runs until you paste it in your terminal.')).toBeTruthy();

    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('automation-recommender-tab-plugins'));

    expect(screen.getByText('Read-only — nothing runs until you paste it into Claude Code.')).toBeTruthy();
    expect(screen.queryByText('Read-only — nothing runs until you paste it in your terminal.')).toBeNull();
  });

  // The bug this pins: hooks and subagents hand over file contents, and the
  // footer used to tell the user they were commands that run in a terminal.
  it('promises a write, not a run, on a tab whose payloads are file contents', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_ALL_KINDS} />);

    for (const tab of ['hooks', 'subagents']) {
      fireEvent.mouseDown(screen.getByTestId(`automation-recommender-tab-${tab}`));
      expect(screen.getByText('Read-only — nothing is written until you paste it into your project.')).toBeTruthy();
      expect(screen.queryByText('Read-only — nothing runs until you paste it in your terminal.')).toBeNull();
    }
  });

  it('falls back to the shared promise on a tab that mixes a command with a file payload', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_ALL_KINDS} />);
    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('automation-recommender-tab-skills'));

    expect(screen.getByText('Read-only — nothing is applied until you paste it.')).toBeTruthy();
  });

  it('counts every recommendation across all categories, not just the active tab', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('0 of 4 copied')).toBeTruthy();

    // Radix TabsTrigger activates on mouse-down, not click.
    fireEvent.mouseDown(screen.getByTestId('automation-recommender-tab-skills'));

    expect(screen.getByText('0 of 4 copied')).toBeTruthy();
  });

  it('renders the copied total its container supplies, not one derived from copiedIds', () => {
    render(
      <SetupAdvisorSheet
        {...baseProps()}
        report={REPORT_RICH}
        copiedIds={new Set(['mcp-supabase', 'skills-storybook'])}
        copiedCount={2}
      />,
    );

    expect(screen.getByText('2 of 4 copied')).toBeTruthy();
  });

  it('is hidden while loading and when there are no recommendations', () => {
    const { rerender } = render(<SetupAdvisorSheet {...baseProps()} loading={true} report={null} />);
    expect(screen.queryByText(/copied$/)).toBeNull();

    rerender(
      <SetupAdvisorSheet
        {...baseProps()}
        report={{ fingerprint: makeFingerprint(['TypeScript', 'React', 'PostgreSQL']), recommendations: [] }}
      />,
    );
    expect(screen.queryByText(/copied$/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Evidence disclosure
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — evidence disclosure', () => {
  it('is collapsed by default and expands to one chip per signal on click', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('What we detected (3)')).toBeTruthy();
    expect(screen.queryByText('PostgreSQL')).toBeNull();

    fireEvent.click(screen.getByTestId('automation-recommender-evidence-toggle'));

    expect(screen.getByText('TypeScript')).toBeTruthy();
    expect(screen.getByText('React')).toBeTruthy();
    expect(screen.getByText('PostgreSQL')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Thin
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — thin', () => {
  it('renders the sparse note when fewer than 3 signals were detected', () => {
    const report: SetupAdvisorReport = {
      fingerprint: makeFingerprint(['TypeScript']),
      recommendations: [REC_MCP_1],
    };
    render(<SetupAdvisorSheet {...baseProps()} report={report} />);

    expect(screen.getByText('We detected only a few signals here, so the list is short.')).toBeTruthy();
  });

  it('does not render the sparse note when 3 or more signals were detected', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.queryByText('We detected only a few signals here, so the list is short.')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — empty', () => {
  it('shows the empty message, no tab strip, and no footer counter when there are zero recommendations', () => {
    const report: SetupAdvisorReport = {
      fingerprint: makeFingerprint(['TypeScript', 'React', 'PostgreSQL']),
      recommendations: [],
    };
    render(<SetupAdvisorSheet {...baseProps()} report={report} />);

    expect(screen.getByText('No recommendations for this project yet.')).toBeTruthy();
    expect(screen.queryByTestId('automation-recommender-tab-mcp')).toBeNull();
    expect(screen.queryByText(/copied$/)).toBeNull();
  });

  it('shows both the empty message and the thin note when signals are also sparse', () => {
    const report: SetupAdvisorReport = {
      fingerprint: makeFingerprint(['TypeScript']),
      recommendations: [],
    };
    render(<SetupAdvisorSheet {...baseProps()} report={report} />);

    expect(screen.getByText('No recommendations for this project yet.')).toBeTruthy();
    expect(screen.getByText('We detected only a few signals here, so the list is short.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — error', () => {
  it('shows the error body and calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<SetupAdvisorSheet {...baseProps()} report={null} error="Network request failed" onRetry={onRetry} />);

    expect(screen.getByText("Couldn't analyze this project.")).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();

    fireEvent.click(screen.getByTestId('automation-recommender-retry'));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — accessibility', () => {
  it('renders the evidence toggle and category tabs as real buttons with an accessible name', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    for (const testid of ['automation-recommender-evidence-toggle', 'automation-recommender-tab-mcp']) {
      const el = screen.getByTestId(testid);
      expect(el.tagName).toBe('BUTTON');
      expect((el.getAttribute('aria-label') ?? el.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});
