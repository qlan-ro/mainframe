/**
 * FilePickerDialog — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - pickerOpen=false → dialog root is absent.
 *  - pickerOpen=true  → dialog root (file-picker-dialog) present + input autofocused.
 *  - Empty query → no results list rendered, hint state shown.
 *  - Typing → calls searchFiles; results rows render with file-picker-row-<path> testid.
 *  - No results → "No matching files" empty state.
 *  - Click row → emits open-file intent with the row's path and closes dialog.
 *  - Esc key   → closes dialog (pickerOpen becomes false).
 *  - useFilesStore pickerOpen open/close toggle.
 *
 * The files store is used directly (not mocked) for open/close state.
 * searchFiles is mocked so tests control results without a live daemon.
 * emitSurfaceIntent is mocked so intent emissions can be asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFilesStore } from '@/store/files';

// ---------------------------------------------------------------------------
// Mock searchFiles — we control results per-test
// ---------------------------------------------------------------------------

const mockSearchFiles = vi.fn();
vi.mock('@/lib/api/files', () => ({
  searchFiles: (...args: unknown[]) => mockSearchFiles(...args),
}));

// ---------------------------------------------------------------------------
// Mock emitSurfaceIntent so we can assert open-file emissions
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: (...args: unknown[]) => mockEmit(...args),
  onSurfaceIntent: vi.fn(() => () => {}),
}));

// ---------------------------------------------------------------------------
// Mock DaemonPortContext so FilePickerDialog can read a port
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

// ---------------------------------------------------------------------------
// Mock useActiveIdentity so FilePickerDialog can read projectId / chatId
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectId: 'proj-1',
    chatId: 'chat-1',
    projectName: 'Test Project',
  }),
}));

// Import component AFTER mocks are registered
const { FilePickerDialog } = await import('../FilePickerDialog');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openPicker(): void {
  act(() => {
    useFilesStore.getState().setPickerOpen(true);
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSearchFiles.mockReset();
  mockEmit.mockReset();
  // Always start closed
  act(() => {
    useFilesStore.setState({ pickerOpen: false });
  });
});

afterEach(() => {
  // Ensure picker is closed after each test
  act(() => {
    useFilesStore.setState({ pickerOpen: false });
  });
});

// ---------------------------------------------------------------------------
// 1. pickerOpen=false — nothing renders
// ---------------------------------------------------------------------------

describe('FilePickerDialog — closed renders nothing', () => {
  it('file-picker-dialog is absent when pickerOpen is false', () => {
    render(<FilePickerDialog />);
    expect(screen.queryByTestId('file-picker-dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. pickerOpen=true — dialog root and input present
// ---------------------------------------------------------------------------

describe('FilePickerDialog — open renders dialog root', () => {
  it('renders file-picker-dialog and file-picker-input when pickerOpen is true', async () => {
    render(<FilePickerDialog />);
    openPicker();

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull();
    });
    expect(screen.queryByTestId('file-picker-input')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Empty query — hint state, no rows rendered
// ---------------------------------------------------------------------------

describe('FilePickerDialog — empty query shows hint, not rows', () => {
  it('shows a hint message and no file rows when query is empty', async () => {
    render(<FilePickerDialog />);
    openPicker();

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull();
    });

    // No rows from empty query (searchFiles should not be called with empty string)
    expect(screen.queryByText(/No matching files/i)).toBeNull();
    // Hint text visible
    expect(screen.getByText(/Type to search files/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Typing → results rows render
// ---------------------------------------------------------------------------

describe('FilePickerDialog — typing triggers search and renders rows', () => {
  it('renders file-picker-row-<path> for each result after debounce', async () => {
    mockSearchFiles.mockResolvedValue([
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file', exact: false },
      { name: 'AppShell.tsx', path: 'src/app/AppShell.tsx', type: 'file', exact: false },
    ]);

    render(<FilePickerDialog />);
    openPicker();

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull();
    });

    const input = screen.getByTestId('file-picker-input');
    await userEvent.type(input, 'App');

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-row-src/App.tsx')).not.toBeNull();
      expect(screen.queryByTestId('file-picker-row-src/app/AppShell.tsx')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. No results → empty state message
// ---------------------------------------------------------------------------

describe('FilePickerDialog — no results shows empty state', () => {
  it('shows "No matching files" when search returns empty array', async () => {
    mockSearchFiles.mockResolvedValue([]);

    render(<FilePickerDialog />);
    openPicker();

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull();
    });

    const input = screen.getByTestId('file-picker-input');
    await userEvent.type(input, 'zzznotfound');

    await waitFor(() => {
      expect(screen.getByText(/No matching files/i)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Click row → emits open-file intent + closes dialog
// ---------------------------------------------------------------------------

describe('FilePickerDialog — clicking a result row emits open-file and closes', () => {
  it('emits emitSurfaceIntent({ type: "open-file", path }) and sets pickerOpen false', async () => {
    mockSearchFiles.mockResolvedValue([{ name: 'App.tsx', path: 'src/App.tsx', type: 'file', exact: false }]);

    render(<FilePickerDialog />);
    openPicker();

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull();
    });

    const input = screen.getByTestId('file-picker-input');
    await userEvent.type(input, 'App');

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-row-src/App.tsx')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('file-picker-row-src/App.tsx'));

    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-file', path: 'src/App.tsx' });
    expect(useFilesStore.getState().pickerOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Esc closes the dialog
// ---------------------------------------------------------------------------

describe('FilePickerDialog — Escape closes dialog', () => {
  it('sets pickerOpen to false when Escape is pressed', async () => {
    render(<FilePickerDialog />);
    openPicker();

    await waitFor(() => {
      expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull();
    });

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(useFilesStore.getState().pickerOpen).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Store open/close toggle unit tests
// ---------------------------------------------------------------------------

describe('useFilesStore — pickerOpen', () => {
  beforeEach(() => {
    act(() => {
      useFilesStore.setState({ pickerOpen: false });
    });
  });

  it('starts with pickerOpen false', () => {
    expect(useFilesStore.getState().pickerOpen).toBe(false);
  });

  it('setPickerOpen(true) sets pickerOpen to true', () => {
    act(() => {
      useFilesStore.getState().setPickerOpen(true);
    });
    expect(useFilesStore.getState().pickerOpen).toBe(true);
  });

  it('setPickerOpen(false) sets pickerOpen to false', () => {
    act(() => {
      useFilesStore.getState().setPickerOpen(true);
    });
    act(() => {
      useFilesStore.getState().setPickerOpen(false);
    });
    expect(useFilesStore.getState().pickerOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Arrow key navigation — active-row highlight moves through results
// ---------------------------------------------------------------------------

describe('FilePickerDialog — keyboard navigation', () => {
  const RESULTS = [
    { name: 'App.tsx', path: 'src/App.tsx', type: 'file' as const, exact: false },
    { name: 'Button.tsx', path: 'src/Button.tsx', type: 'file' as const, exact: false },
    { name: 'Card.tsx', path: 'src/Card.tsx', type: 'file' as const, exact: false },
  ];

  beforeEach(() => {
    mockSearchFiles.mockResolvedValue(RESULTS);
  });

  async function openAndSearch(query = 'A'): Promise<HTMLElement> {
    render(<FilePickerDialog />);
    openPicker();
    await waitFor(() => expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull());
    const input = screen.getByTestId('file-picker-input');
    await userEvent.type(input, query);
    await waitFor(() => expect(screen.queryByTestId('file-picker-row-src/App.tsx')).not.toBeNull());
    return input;
  }

  it('first row is active (aria-selected + data-active) when results first appear', async () => {
    await openAndSearch();
    const firstRow = screen.getByTestId('file-picker-row-src/App.tsx');
    expect(firstRow.getAttribute('aria-selected')).toBe('true');
    expect(firstRow.getAttribute('data-active')).toBe('true');
    expect(firstRow.getAttribute('role')).toBe('option');
  });

  it('ArrowDown moves active index from 0 to 1', async () => {
    const input = await openAndSearch();
    await userEvent.keyboard('{ArrowDown}');
    const secondRow = screen.getByTestId('file-picker-row-src/Button.tsx');
    expect(secondRow.getAttribute('aria-selected')).toBe('true');
    expect(secondRow.getAttribute('data-active')).toBe('true');
    // First row should no longer be active
    const firstRow = screen.getByTestId('file-picker-row-src/App.tsx');
    expect(firstRow.getAttribute('aria-selected')).toBe('false');
    // suppress unused var warning
    void input;
  });

  it('ArrowDown clamps at last result (no wrap)', async () => {
    const input = await openAndSearch();
    // move past end
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    const lastRow = screen.getByTestId('file-picker-row-src/Card.tsx');
    expect(lastRow.getAttribute('aria-selected')).toBe('true');
    void input;
  });

  it('ArrowUp clamps at first result (no wrap)', async () => {
    const input = await openAndSearch();
    await userEvent.keyboard('{ArrowUp}');
    const firstRow = screen.getByTestId('file-picker-row-src/App.tsx');
    expect(firstRow.getAttribute('aria-selected')).toBe('true');
    void input;
  });

  it('ArrowDown then ArrowUp returns to first row', async () => {
    const input = await openAndSearch();
    await userEvent.keyboard('{ArrowDown}{ArrowUp}');
    const firstRow = screen.getByTestId('file-picker-row-src/App.tsx');
    expect(firstRow.getAttribute('aria-selected')).toBe('true');
    void input;
  });

  it('Enter on active row emits open-file and closes dialog', async () => {
    const input = await openAndSearch();
    // First row (index 0) is active by default
    await userEvent.keyboard('{Enter}');
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-file', path: 'src/App.tsx' });
    await waitFor(() => expect(useFilesStore.getState().pickerOpen).toBe(false));
    void input;
  });

  it('Enter after ArrowDown selects second row', async () => {
    const input = await openAndSearch();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-file', path: 'src/Button.tsx' });
    void input;
  });

  it('active index resets to 0 when results change', async () => {
    // Start with App results
    const input = await openAndSearch('App');
    await userEvent.keyboard('{ArrowDown}');
    // Second row active now

    // Now clear and type new query — results will re-render (same mock returns same list for simplicity)
    mockSearchFiles.mockResolvedValue([{ name: 'Zap.tsx', path: 'src/Zap.tsx', type: 'file' as const, exact: false }]);
    // clear the input and type new query to trigger new results
    await userEvent.clear(input);
    await userEvent.type(input, 'Zap');

    await waitFor(() => {
      const newRow = screen.queryByTestId('file-picker-row-src/Zap.tsx');
      expect(newRow).not.toBeNull();
      expect(newRow?.getAttribute('aria-selected')).toBe('true');
    });
  });

  it('Enter with no results is a no-op (no emit)', async () => {
    mockSearchFiles.mockResolvedValue([]);
    render(<FilePickerDialog />);
    openPicker();
    await waitFor(() => expect(screen.queryByTestId('file-picker-dialog')).not.toBeNull());
    const input = screen.getByTestId('file-picker-input');
    await userEvent.type(input, 'nomatch');
    await waitFor(() => expect(screen.getByText(/No matching files/i)).toBeTruthy());
    await userEvent.keyboard('{Enter}');
    expect(mockEmit).not.toHaveBeenCalled();
    // dialog stays open
    expect(useFilesStore.getState().pickerOpen).toBe(true);
  });

  it('rows have role="option"', async () => {
    await openAndSearch();
    const rows = screen.getAllByRole('option');
    expect(rows.length).toBe(3);
  });
});
