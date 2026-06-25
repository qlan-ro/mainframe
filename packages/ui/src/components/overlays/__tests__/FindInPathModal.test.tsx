/**
 * FindInPathModal — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - findInPath=null → find-in-path-input absent.
 *  - findInPath set → find-in-path-input present.
 *  - Query length 1 → shows hint, does NOT call searchContent.
 *  - Query ≥2 → calls searchContent and renders find-in-path-result-* rows.
 *  - Clicking a result → emits open-file with { path, line, character }.
 *  - find-in-path-include-ignored renders only when scopeType === 'directory'.
 *  - Error from searchContent → renders inline error (no silent catch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOverlaysStore } from '@/store/overlays';

// ---------------------------------------------------------------------------
// Mock searchContent — we control results per-test
// ---------------------------------------------------------------------------

const mockSearchContent = vi.fn();
vi.mock('@/lib/api/files', () => ({
  searchContent: (...args: unknown[]) => mockSearchContent(...args),
}));

// ---------------------------------------------------------------------------
// Mock emitSurfaceIntent so we can assert intent emissions
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: (...args: unknown[]) => mockEmit(...args),
  onSurfaceIntent: vi.fn(() => () => {}),
}));

// ---------------------------------------------------------------------------
// Mock DaemonPortContext
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

// ---------------------------------------------------------------------------
// Mock useActiveIdentity
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectId: 'proj-1',
    chatId: 'chat-1',
    projectName: 'Test Project',
  }),
}));

// Import component AFTER mocks are registered
const { FindInPathModal } = await import('../FindInPathModal');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openModal(scopeType: 'file' | 'directory' = 'directory'): void {
  act(() => {
    useOverlaysStore.getState().setFindInPath({ scopePath: 'src', scopeType });
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSearchContent.mockReset();
  mockEmit.mockReset();
  act(() => {
    useOverlaysStore.setState({ paletteOpen: false, findInPath: null, reviewOpen: false });
  });
});

afterEach(() => {
  act(() => {
    useOverlaysStore.setState({ paletteOpen: false, findInPath: null, reviewOpen: false });
  });
});

// ---------------------------------------------------------------------------
// 1. findInPath=null — nothing renders
// ---------------------------------------------------------------------------

describe('FindInPathModal — closed renders nothing', () => {
  it('find-in-path-input is absent when findInPath is null', () => {
    render(<FindInPathModal />);
    expect(screen.queryByTestId('find-in-path-input')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. findInPath set — input present
// ---------------------------------------------------------------------------

describe('FindInPathModal — open renders input', () => {
  it('renders find-in-path-input when findInPath is non-null', async () => {
    render(<FindInPathModal />);
    openModal();
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Single-char query — hint, no searchContent call
// ---------------------------------------------------------------------------

describe('FindInPathModal — single char shows hint and no search', () => {
  it('does not search for a single-character query', async () => {
    render(<FindInPathModal />);
    openModal();
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });

    const input = screen.getByTestId('find-in-path-input');
    await userEvent.type(input, 'f');

    // Wait briefly to confirm searchContent is never called (debounce = 300ms)
    await new Promise((r) => setTimeout(r, 350));

    expect(screen.getByText(/at least 2 characters/i)).toBeTruthy();
    expect(mockSearchContent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Query ≥2 → calls searchContent, renders results
// ---------------------------------------------------------------------------

describe('FindInPathModal — query ≥2 calls searchContent and shows rows', () => {
  it('renders find-in-path-result rows after typing ≥2 chars', async () => {
    mockSearchContent.mockResolvedValue([{ file: 'src/a.ts', line: 10, column: 4, text: 'foo' }]);

    render(<FindInPathModal />);
    openModal();
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });

    const input = screen.getByTestId('find-in-path-input');
    await userEvent.type(input, 'fo');

    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-result-src/a.ts:10:4')).not.toBeNull();
    });

    expect(mockSearchContent).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Click result → emits open-file with line and character
// ---------------------------------------------------------------------------

describe('FindInPathModal — clicking a result emits open-file with line and character', () => {
  it('emits open-file with line and character on result click', async () => {
    mockSearchContent.mockResolvedValue([{ file: 'src/a.ts', line: 10, column: 4, text: 'foo' }]);

    render(<FindInPathModal />);
    openModal();
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });

    const input = screen.getByTestId('find-in-path-input');
    await userEvent.type(input, 'fo');

    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-result-src/a.ts:10:4')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('find-in-path-result-src/a.ts:10:4'));

    expect(mockEmit).toHaveBeenCalledWith({
      type: 'open-file',
      path: 'src/a.ts',
      line: 10,
      character: 4,
    });
    // Modal closes
    expect(useOverlaysStore.getState().findInPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. include-ignored checkbox renders only for directory scope
// ---------------------------------------------------------------------------

describe('FindInPathModal — include-ignored checkbox only in directory scope', () => {
  it('renders find-in-path-include-ignored for directory scope', async () => {
    render(<FindInPathModal />);
    openModal('directory');
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });
    expect(screen.queryByTestId('find-in-path-include-ignored')).not.toBeNull();
  });

  it('does NOT render find-in-path-include-ignored for file scope', async () => {
    render(<FindInPathModal />);
    openModal('file');
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });
    expect(screen.queryByTestId('find-in-path-include-ignored')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Stale-results race: clearing query after an in-flight request must not
//    let the late response overwrite the cleared state (Finding A).
// ---------------------------------------------------------------------------

describe('FindInPathModal — stale searchContent response is ignored after query drops below 2 chars', () => {
  it('does not populate results when a stale response resolves after the query is cleared', async () => {
    let resolveLate!: (v: { file: string; line: number; column: number; text: string }[]) => void;
    const deferred = new Promise<{ file: string; line: number; column: number; text: string }[]>((r) => {
      resolveLate = r;
    });
    mockSearchContent.mockReturnValueOnce(deferred);

    render(<FindInPathModal />);
    openModal();
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });

    const input = screen.getByTestId('find-in-path-input');
    // Type ≥2 chars to trigger the in-flight request
    await userEvent.type(input, 'fo');
    await waitFor(() => expect(mockSearchContent).toHaveBeenCalledTimes(1));

    // Clear the query to drop below 2 chars
    await userEvent.clear(input);

    // Wait for the debounce to propagate the empty value so the effect
    // re-runs, bumps reqIdRef, and invalidates the in-flight request.
    await new Promise((r) => setTimeout(r, 350));

    // Resolve the now-stale request — it must not land
    act(() => resolveLate([{ file: 'src/a.ts', line: 10, column: 4, text: 'foo' }]));
    await new Promise((r) => setTimeout(r, 50));

    // The stale result must NOT appear
    expect(screen.queryByTestId('find-in-path-result-src/a.ts:10:4')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Error from searchContent renders inline error
// ---------------------------------------------------------------------------

describe('FindInPathModal — searchContent error renders error row', () => {
  it('shows an error message when searchContent rejects', async () => {
    mockSearchContent.mockRejectedValue(new Error('daemon error'));

    render(<FindInPathModal />);
    openModal();
    await waitFor(() => {
      expect(screen.queryByTestId('find-in-path-input')).not.toBeNull();
    });

    const input = screen.getByTestId('find-in-path-input');
    await userEvent.type(input, 'fo');

    await waitFor(() => {
      expect(screen.queryByText(/search failed/i)).not.toBeNull();
    });
  });
});
