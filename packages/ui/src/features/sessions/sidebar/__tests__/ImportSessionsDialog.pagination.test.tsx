/**
 * ImportSessionsDialog — pagination / infinite-scroll tests (TDD).
 *
 * Behaviors covered:
 *  1. Page 0 (nextOffset:2) renders 2 external-session-item rows + a
 *     sessions-import-load-more sentinel.
 *  2. After the IntersectionObserver fires (triggerScroll), page 1
 *     (nextOffset:null) is fetched and appended: 3 rows total, no sentinel;
 *     getExternalSessions is called exactly twice — first with offset:0,
 *     then with offset:2.
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` useAssistantRuntime (same pattern as SessionRow.test.tsx).
 *  - Mock `@/lib/api/external-sessions` getExternalSessions to return page0 then page1.
 *  - Mock globalThis.IntersectionObserver to capture the callback and let the
 *    test fire it via triggerScroll().
 *  - Export SessionList from ImportSessionsDialog so it can be rendered directly
 *    (avoids Dialog + project-picker step).
 *  - Use waitFor to let the useEffect + setState settle.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { ExternalSession, ExternalSessionPage } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// IntersectionObserver mock — capture callback, fire from test
// ---------------------------------------------------------------------------

let ioCb: IntersectionObserverCallback | null = null;

beforeEach(() => {
  ioCb = null;
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      ioCb = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function triggerScroll() {
  act(() => ioCb?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
}

// ---------------------------------------------------------------------------
// Spies
// ---------------------------------------------------------------------------

const reloadSpy = vi.fn();
const getExternalSessionsSpy = vi.fn();
const importExternalSessionSpy = vi.fn();

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({
    threads: {
      getState: () => ({ threadIds: [], threadItems: {} }),
      reload: reloadSpy,
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/api/external-sessions
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/external-sessions', () => ({
  getExternalSessions: (...args: unknown[]) => getExternalSessionsSpy(...args),
  importExternalSession: (...args: unknown[]) => importExternalSessionSpy(...args),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { SessionList } = await import('../ImportSessionsDialog');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;
const PROJECT_ID = 'proj-1';
const PROJECT_PATH = '/projects/mainframe';

function makeSession(id: string, firstPrompt: string): ExternalSession {
  return {
    sessionId: id,
    adapterId: 'claude',
    projectPath: PROJECT_PATH,
    cwd: PROJECT_PATH,
    firstPrompt,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-06-01T10:00:00.000Z',
  };
}

const SESSION_A = makeSession('ext-sess-001', 'Fix the parser');
const SESSION_B = makeSession('ext-sess-002', 'Add type safety');
const SESSION_C = makeSession('ext-sess-003', 'Write the tests');

const PAGE_0: ExternalSessionPage = {
  sessions: [SESSION_A, SESSION_B],
  total: 3,
  nextOffset: 2,
};

const PAGE_1: ExternalSessionPage = {
  sessions: [SESSION_C],
  total: 3,
  nextOffset: null,
};

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  reloadSpy.mockReset();
  reloadSpy.mockResolvedValue(undefined);
  getExternalSessionsSpy.mockReset();
  importExternalSessionSpy.mockReset();
  importExternalSessionSpy.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Helper — wrap in TooltipProvider for Radix compatibility
// ---------------------------------------------------------------------------

function renderSessionList() {
  render(
    <TooltipProvider>
      <SessionList port={PORT} projectId={PROJECT_ID} projectPath={PROJECT_PATH} onDone={vi.fn()} />
    </TooltipProvider>,
  );
}

it('renders 2 external-session-item rows and a sessions-import-load-more sentinel after mount', async () => {
  getExternalSessionsSpy.mockResolvedValueOnce(PAGE_0);

  renderSessionList();

  await waitFor(() => {
    expect(screen.getAllByTestId('external-session-item')).toHaveLength(2);
  });

  expect(screen.getByTestId('sessions-import-load-more')).toBeTruthy();
});

it('appends page 1 rows, removes the sentinel, and fetches with the correct offsets after triggerScroll', async () => {
  getExternalSessionsSpy.mockResolvedValueOnce(PAGE_0).mockResolvedValueOnce(PAGE_1);

  renderSessionList();

  // Wait for page 0
  await waitFor(() => {
    expect(screen.getAllByTestId('external-session-item')).toHaveLength(2);
  });

  // Trigger the IntersectionObserver callback (sentinel enters viewport)
  triggerScroll();

  // Wait for page 1 to append
  await waitFor(() => {
    expect(screen.getAllByTestId('external-session-item')).toHaveLength(3);
  });

  // Sentinel must be gone (nextOffset === null)
  expect(screen.queryByTestId('sessions-import-load-more')).toBeNull();

  expect(getExternalSessionsSpy).toHaveBeenCalledTimes(2);
  expect(getExternalSessionsSpy).toHaveBeenNthCalledWith(1, PORT, PROJECT_ID, { offset: 0, limit: 50 });
  expect(getExternalSessionsSpy).toHaveBeenNthCalledWith(2, PORT, PROJECT_ID, { offset: 2, limit: 50 });
});
