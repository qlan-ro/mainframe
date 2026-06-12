/**
 * DiffTab tests — D2: path-only diff fetches HEAD-vs-working via getWorkingDiff.
 *
 * Strategy:
 *  - Mock getWorkingDiff from @/lib/api/git to return { original, modified }.
 *  - Mock CmDiffEditor to capture props (avoid mounting the real CM6 merge view).
 *  - Mock DiffHeader to avoid diff-nav singletons.
 *  - Render DiffTab with only a path (no pre-resolved sides): assert CmDiffEditor
 *    receives the mocked original/modified instead of the "Diff unavailable" state.
 *  - Cover the empty-both-sides → "Diff unavailable" path.
 *  - Cover the pre-resolved sides → CmDiffEditor receives them directly (no fetch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';

// ── Mock useDaemonPort ────────────────────────────────────────────────────────
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

// ── Mock useActiveIdentity ────────────────────────────────────────────────────
const activeIdentity = {
  projectId: 'proj-1' as string | undefined,
  chatId: 'chat-1' as string | undefined,
};
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => activeIdentity,
}));

// ── Mock getWorkingDiff ───────────────────────────────────────────────────────
vi.mock('@/lib/api/git', () => ({
  getWorkingDiff: vi.fn(),
}));

import { getWorkingDiff } from '@/lib/api/git';
const mockGetWorkingDiff = vi.mocked(getWorkingDiff);

// ── Mock CmDiffEditor (capture props) ────────────────────────────────────────
type CmDiffEditorProps = ComponentProps<typeof import('../CmDiffEditor').CmDiffEditor>;
const capturedDiffProps: CmDiffEditorProps[] = [];

vi.mock('../CmDiffEditor', () => ({
  CmDiffEditor: (props: CmDiffEditorProps) => {
    capturedDiffProps.push(props);
    return <div data-testid="cm-diff-editor-mock" />;
  },
}));

// ── Mock DiffHeader ───────────────────────────────────────────────────────────
vi.mock('../DiffHeader', () => ({
  DiffHeader: ({ fileName }: { fileName: string; changeCount: number; onPrev: () => void; onNext: () => void }) => (
    <div data-testid="diff-header-mock">{fileName}</div>
  ),
}));

// ── Mock diff-nav ─────────────────────────────────────────────────────────────
vi.mock('../diff-nav', () => ({
  nextChange: vi.fn(),
  prevChange: vi.fn(),
}));

// ── Import subject under test ─────────────────────────────────────────────────
import { DiffTab } from '../DiffTab';

beforeEach(() => {
  capturedDiffProps.length = 0;
  vi.clearAllMocks();
  activeIdentity.projectId = 'proj-1';
  activeIdentity.chatId = 'chat-1';
});

describe('DiffTab — path-only diff (D2)', () => {
  it('calls getWorkingDiff with port, projectId, path, and chatId when no pre-resolved sides', async () => {
    mockGetWorkingDiff.mockResolvedValue({
      original: 'before',
      modified: 'after',
      diff: '',
      source: 'git',
    });

    render(<DiffTab path="src/index.ts" />);

    await waitFor(() => {
      expect(mockGetWorkingDiff).toHaveBeenCalledWith(
        31415,
        'proj-1',
        'src/index.ts',
        expect.objectContaining({ chatId: 'chat-1' }),
      );
    });
  });

  it('passes the fetched original and modified into CmDiffEditor instead of showing "Diff unavailable"', async () => {
    mockGetWorkingDiff.mockResolvedValue({
      original: 'const x = 1;',
      modified: 'const x = 2;',
      diff: '',
      source: 'git',
    });

    render(<DiffTab path="src/index.ts" />);

    await waitFor(() => {
      const last = capturedDiffProps[capturedDiffProps.length - 1];
      expect(last).toBeDefined();
      expect(last?.original).toBe('const x = 1;');
      expect(last?.modified).toBe('const x = 2;');
    });

    expect(screen.queryByText(/No diff available/)).toBeNull();
  });

  it('shows "Diff unavailable" when getWorkingDiff returns empty strings for both sides', async () => {
    mockGetWorkingDiff.mockResolvedValue({
      original: '',
      modified: '',
      diff: '',
      source: 'git',
    });

    render(<DiffTab path="src/clean.ts" />);

    await screen.findByText(/No diff available/);
    expect(capturedDiffProps.length).toBe(0);
  });

  it('shows "Diff unavailable" when getWorkingDiff rejects', async () => {
    mockGetWorkingDiff.mockRejectedValue(new Error('network error'));

    render(<DiffTab path="src/broken.ts" />);

    await screen.findByText(/No diff available/);
    expect(capturedDiffProps.length).toBe(0);
  });
});

describe('DiffTab — pre-resolved sides (existing behaviour)', () => {
  it('renders CmDiffEditor with the supplied original/modified without fetching', async () => {
    render(<DiffTab path="src/index.ts" original="old" modified="new" />);

    await waitFor(() => {
      const last = capturedDiffProps[capturedDiffProps.length - 1];
      expect(last?.original).toBe('old');
      expect(last?.modified).toBe('new');
    });

    expect(mockGetWorkingDiff).not.toHaveBeenCalled();
    expect(screen.queryByText(/No diff available/)).toBeNull();
  });
});
