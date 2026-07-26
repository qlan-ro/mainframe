/**
 * SetupAdvisorSheet.copy.test.tsx
 *
 * Copy / copy-failure behavior (spec AC 12; plan T25). Split from
 * SetupAdvisorSheet.test.tsx so the manual per-test clipboard mock stays
 * isolated (`Object.defineProperty(navigator, 'clipboard', ...)`, the pattern
 * at features/shared/__tests__/ErrorState.test.tsx:44-53). Deliberately never
 * calls userEvent.setup() — it installs its own clipboard stub that silently
 * overrides a manually-installed one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SetupAdvisorReport, AutomationRecommendation } from '@qlan-ro/mainframe-types';
import { SetupAdvisorSheet } from '../SetupAdvisorSheet';

function makeRec(overrides: Partial<AutomationRecommendation> & { id: string }): AutomationRecommendation {
  return {
    category: 'mcp',
    title: 'Add the Supabase MCP server',
    signal: '@supabase/supabase-js in package.json',
    why: 'Query your database from Claude Code.',
    command: 'claude mcp add supabase npx @supabase/mcp-server\nclaude mcp list',
    adapters: ['*'],
    provenance: 'vendor-official',
    ...overrides,
  };
}

const REC = makeRec({ id: 'mcp-supabase' });

const REPORT: SetupAdvisorReport = {
  fingerprint: {
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
    signals: ['TypeScript', 'React', 'PostgreSQL'],
  },
  recommendations: [REC],
};

function baseProps() {
  return {
    report: REPORT,
    loading: false,
    error: null as string | null,
    copiedIds: new Set<string>() as ReadonlySet<string>,
    copiedCount: 0,
    onCopy: vi.fn(),
    onRetry: vi.fn(),
  };
}

let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

describe('SetupAdvisorSheet — copy', () => {
  // The sheet holds no copy state of its own: it writes the clipboard, reports
  // the id, and renders whatever the container feeds back. The rerender below
  // stands in for SetupAdvisorHost's markCopied → store → props round trip.
  it('writes the full multi-line command to the clipboard, reports the id, and renders the fed-back copy state', async () => {
    const onCopy = vi.fn();
    const { rerender } = render(<SetupAdvisorSheet {...baseProps()} onCopy={onCopy} />);

    expect(screen.getByText('0 of 1 copied')).toBeTruthy();

    fireEvent.click(screen.getByTestId('automation-recommender-copy-mcp-supabase'));

    expect(writeTextMock).toHaveBeenCalledWith('claude mcp add supabase npx @supabase/mcp-server\nclaude mcp list');
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('mcp-supabase'));

    rerender(
      <SetupAdvisorSheet {...baseProps()} onCopy={onCopy} copiedIds={new Set(['mcp-supabase'])} copiedCount={1} />,
    );

    expect(screen.getByTestId('automation-recommender-copy-mcp-supabase').textContent).toContain('Copied');
    expect(screen.getByText('1 of 1 copied')).toBeTruthy();
  });

  it('initializes a row as already-copied when its id is in the copiedIds prop', () => {
    render(<SetupAdvisorSheet {...baseProps()} copiedIds={new Set(['mcp-supabase'])} copiedCount={1} />);

    expect(screen.getByTestId('automation-recommender-copy-mcp-supabase').textContent).toContain('Copied');
    expect(screen.getByText('1 of 1 copied')).toBeTruthy();
  });
});

describe('SetupAdvisorSheet — copy failure', () => {
  // Not reporting the id is what keeps the counter still: the container only
  // ever bumps it in response to onCopy.
  it('shows Copy failed, reverts, and never reports the id, when writeText rejects', async () => {
    writeTextMock.mockRejectedValue(new Error('denied'));
    const onCopy = vi.fn();
    render(<SetupAdvisorSheet {...baseProps()} onCopy={onCopy} />);

    fireEvent.click(screen.getByTestId('automation-recommender-copy-mcp-supabase'));

    await waitFor(() => {
      expect(screen.getByTestId('automation-recommender-copy-mcp-supabase').textContent).toContain('Copy failed');
    });

    await waitFor(
      () => {
        expect(screen.getByTestId('automation-recommender-copy-mcp-supabase').textContent).not.toContain('Copy failed');
      },
      { timeout: 3000 },
    );

    expect(onCopy).not.toHaveBeenCalled();
  });
});
