/**
 * SearchPalette — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - paletteOpen=false → search-palette-input absent.
 *  - paletteOpen=true  → search-palette-input present.
 *  - Session rows render from mocked thread items.
 *  - Clicking a session row calls switchToThread with its remoteId and closes.
 *  - Typing ≥2 chars renders search-palette-file-row-* rows.
 *  - Clicking a file row emits open-file intent with path and closes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOverlaysStore } from '@/store/overlays';

// ---------------------------------------------------------------------------
// Mock searchFiles — we control results per-test
// ---------------------------------------------------------------------------

const mockSearchFiles = vi.fn();
vi.mock('@/lib/api/files', () => ({
  searchFiles: (...args: unknown[]) => mockSearchFiles(...args),
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
// Mock useAssistantRuntime to expose threads.switchToThread
// ---------------------------------------------------------------------------

const mockSwitch = vi.fn();
vi.mock('@assistant-ui/react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@assistant-ui/react')>();
  return {
    ...original,
    useAssistantRuntime: () => ({ threads: { switchToThread: mockSwitch } }),
    useAuiState: (selector: (s: unknown) => unknown) => {
      // Return the thread items for the sessions selector
      const mockState = {
        threads: {
          threadItems: [
            {
              id: 'chat-1',
              remoteId: 'chat-1',
              title: 'Session One',
              status: 'regular',
              custom: {
                projectId: 'proj-1',
                adapterId: 'claude',
                tags: [],
                pinned: false,
                status: 'idle',
                displayStatus: 'idle',
                hasPending: false,
                detectedPrs: [],
                worktreeMissing: false,
                updatedAt: Date.now(),
              },
            },
          ],
        },
      };
      return selector(mockState);
    },
  };
});

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
const { SearchPalette } = await import('../SearchPalette');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openPalette(): void {
  act(() => {
    useOverlaysStore.getState().setPaletteOpen(true);
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSearchFiles.mockReset();
  mockEmit.mockReset();
  mockSwitch.mockReset();
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
// 1. paletteOpen=false — input not rendered
// ---------------------------------------------------------------------------

describe('SearchPalette — closed renders nothing', () => {
  it('search-palette-input is absent when paletteOpen is false', () => {
    render(<SearchPalette />);
    expect(screen.queryByTestId('search-palette-input')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. paletteOpen=true — input present
// ---------------------------------------------------------------------------

describe('SearchPalette — open renders input', () => {
  it('renders search-palette-input when paletteOpen is true', async () => {
    render(<SearchPalette />);
    openPalette();
    await waitFor(() => {
      expect(screen.queryByTestId('search-palette-input')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Session rows render from thread items
// ---------------------------------------------------------------------------

describe('SearchPalette — session rows', () => {
  it('renders search-palette-session-row-chat-1 from mocked thread items', async () => {
    render(<SearchPalette />);
    openPalette();
    await waitFor(() => {
      expect(screen.queryByTestId('search-palette-session-row-chat-1')).not.toBeNull();
    });
  });

  it('switches to the SAME id the session row testid keys on (remoteId)', async () => {
    render(<SearchPalette />);
    openPalette();
    await waitFor(() => {
      expect(screen.queryByTestId('search-palette-session-row-chat-1')).not.toBeNull();
    });
    const row = screen.getByTestId('search-palette-session-row-chat-1');
    await userEvent.click(row);
    // Proves remoteId is the switch arg: the testid key and the switchToThread arg agree.
    expect(mockSwitch).toHaveBeenCalledWith('chat-1');
    expect(useOverlaysStore.getState().paletteOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. File rows render from searchFiles results
// ---------------------------------------------------------------------------

describe('SearchPalette — file search rows', () => {
  it('renders file rows after typing ≥2 chars', async () => {
    mockSearchFiles.mockResolvedValue([{ name: 'a.ts', path: 'src/a.ts', type: 'file', exact: false }]);

    render(<SearchPalette />);
    openPalette();
    await waitFor(() => {
      expect(screen.queryByTestId('search-palette-input')).not.toBeNull();
    });

    const input = screen.getByTestId('search-palette-input');
    await userEvent.type(input, 'aa');

    await waitFor(() => {
      expect(screen.queryByTestId('search-palette-file-row-src/a.ts')).not.toBeNull();
    });
  });

  it('emits open-file on file row click and closes', async () => {
    mockSearchFiles.mockResolvedValue([{ name: 'a.ts', path: 'src/a.ts', type: 'file', exact: false }]);

    render(<SearchPalette />);
    openPalette();
    await waitFor(() => {
      expect(screen.queryByTestId('search-palette-input')).not.toBeNull();
    });

    const input = screen.getByTestId('search-palette-input');
    await userEvent.type(input, 'aa');

    await waitFor(() => {
      expect(screen.queryByTestId('search-palette-file-row-src/a.ts')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('search-palette-file-row-src/a.ts'));

    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts' });
    expect(useOverlaysStore.getState().paletteOpen).toBe(false);
  });
});
