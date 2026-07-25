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

// Deliberately not in canonical category order — plugins first — so tab-order
// assertions prove the component sorts, rather than mirroring input order.
const REPORT_RICH: SetupAdvisorReport = {
  fingerprint: makeFingerprint(['TypeScript', 'React', 'PostgreSQL']),
  recommendations: [REC_PLUGINS, REC_MCP_1, REC_MCP_2, REC_SKILLS],
};

function baseProps() {
  return {
    report: null as SetupAdvisorReport | null,
    loading: false,
    error: null as string | null,
    projectName: 'mainframe',
    copiedIds: new Set<string>(),
    onCopy: vi.fn(),
    onRetry: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — loading', () => {
  it('shows the loading skeleton and header, and no empty-state flash', () => {
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

    fireEvent.click(screen.getByTestId('automation-recommender-tab-skills'));

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
});

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — footer', () => {
  it('reads the terminal copy on mcp/skills/hooks/subagents and the Claude Code copy on plugins', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('Read-only — commands run in your terminal.')).toBeTruthy();

    fireEvent.click(screen.getByTestId('automation-recommender-tab-plugins'));

    expect(screen.getByText('Read-only — run this inside Claude Code.')).toBeTruthy();
    expect(screen.queryByText('Read-only — commands run in your terminal.')).toBeNull();
  });

  it('counts every recommendation across all categories, not just the active tab', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByText('0 of 4 copied')).toBeTruthy();

    fireEvent.click(screen.getByTestId('automation-recommender-tab-skills'));

    expect(screen.getByText('0 of 4 copied')).toBeTruthy();
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

    expect(
      screen.getByText(
        "Recommendations are sparse because little was detected — there's genuinely not much to automate yet.",
      ),
    ).toBeTruthy();
  });

  it('does not render the sparse note when 3 or more signals were detected', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.queryByText(/genuinely not much to automate yet/)).toBeNull();
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
    expect(
      screen.getByText(
        "Recommendations are sparse because little was detected — there's genuinely not much to automate yet.",
      ),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

describe('SetupAdvisorSheet — container', () => {
  it('carries the sheet container testid in the loaded case', () => {
    render(<SetupAdvisorSheet {...baseProps()} report={REPORT_RICH} />);

    expect(screen.getByTestId('automation-recommender-sheet')).toBeTruthy();
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
