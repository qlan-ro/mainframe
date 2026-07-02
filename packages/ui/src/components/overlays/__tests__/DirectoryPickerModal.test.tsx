/**
 * DirectoryPickerModal — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - When pending is null, dialog does not render.
 *  - When pending is set, seeds browseFilesystem(port, '~', { includeFiles }) and
 *    renders directory-picker-row-* for each entry.
 *  - Selecting a directory enables directory-picker-confirm; clicking resolves the path.
 *  - Cancel (directory-picker-cancel) resolves null.
 *  - In mode:'file', confirm stays disabled until a file (not directory) is selected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDirectoryPicker } from '@/features/files/use-directory-picker';

// ---------------------------------------------------------------------------
// Mock browseFilesystem
// ---------------------------------------------------------------------------

const mockBrowse = vi.fn();
vi.mock('@/lib/api/files', () => ({
  browseFilesystem: (...args: unknown[]) => mockBrowse(...args),
}));

// ---------------------------------------------------------------------------
// Mock daemon port + identity
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectId: 'proj-1',
    chatId: 'chat-1',
    projectName: 'Test Project',
  }),
}));

// Import component AFTER mocks
const { DirectoryPickerModal } = await import('../DirectoryPickerModal');

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockBrowse.mockReset();
  useDirectoryPicker.setState({ pending: null });
});

afterEach(() => {
  useDirectoryPicker.getState().resolve(null);
  useDirectoryPicker.setState({ pending: null });
});

// ---------------------------------------------------------------------------
// 1. Nothing renders when pending is null
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — closed', () => {
  it('renders nothing when pending is null', () => {
    render(<DirectoryPickerModal />);
    expect(screen.queryByTestId('directory-picker-confirm')).toBeNull();
    expect(screen.queryByTestId('directory-picker-cancel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Seeds tree from home and renders rows
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — open renders tree rows', () => {
  it('seeds the tree from home and resolves the selected path', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);

    render(<DirectoryPickerModal />);

    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    // browseFilesystem called with '~' and includeFiles: false (directory mode)
    expect(mockBrowse).toHaveBeenCalledWith(31415, '~', { includeFiles: false });
  });

  it('confirm is disabled before any selection', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    expect(screen.getByTestId('directory-picker-confirm')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 2b. Empty directory → empty state, not a perpetual loader
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — empty directory', () => {
  it('shows an empty state (not "Loading…") when the browse returns no entries', async () => {
    mockBrowse.mockResolvedValue([]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-empty')).not.toBeNull();
    });
    // The stuck-loading bug: an empty result kept the loader visible forever.
    expect(screen.queryByTestId('directory-picker-loading')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Select a directory → confirm enabled → click resolves path
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — directory selection + confirm', () => {
  it('selecting a directory enables confirm; clicking it resolves with the path', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);

    render(<DirectoryPickerModal />);
    let picked: Promise<string | null>;
    act(() => {
      picked = useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/proj'));

    const confirmBtn = screen.getByTestId('directory-picker-confirm');
    expect(confirmBtn).not.toBeDisabled();

    await userEvent.click(confirmBtn);

    await expect(picked!).resolves.toBe('/Users/me/proj');
    // dialog closes after confirm
    expect(useDirectoryPicker.getState().pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Cancel resolves null
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — cancel', () => {
  it('clicking cancel resolves null and closes', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);

    render(<DirectoryPickerModal />);
    let picked: Promise<string | null>;
    act(() => {
      picked = useDirectoryPicker.getState().pickDirectory({});
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-cancel')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('directory-picker-cancel'));

    await expect(picked!).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. mode:'file' — confirm disabled until a file (not directory) is selected
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — file mode', () => {
  it('confirm stays disabled when only a directory is selected in file mode', async () => {
    // First call (root seed '~') returns both directory and file.
    // Subsequent calls (lazy-load of the directory) return empty list so the
    // file entry doesn't appear twice in the rendered tree.
    mockBrowse
      .mockResolvedValueOnce([
        { name: 'proj', path: '/Users/me/proj', type: 'directory' },
        { name: 'readme.md', path: '/Users/me/readme.md', type: 'file' },
      ])
      .mockResolvedValue([]);

    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'file' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    // browseFilesystem called with includeFiles: true in file mode
    expect(mockBrowse).toHaveBeenCalledWith(31415, '~', { includeFiles: true });

    // Select the directory — confirm should remain disabled
    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/proj'));
    expect(screen.getByTestId('directory-picker-confirm')).toBeDisabled();

    // Select the file — confirm should now be enabled
    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/readme.md'));
    expect(screen.getByTestId('directory-picker-confirm')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 6. Lazy-load error — shows a "Failed to load" row under the expanded node
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — lazy-load error', () => {
  it('shows a failed-to-load indicator when child browse rejects', async () => {
    // Root seed succeeds; child expand fails
    mockBrowse
      .mockResolvedValueOnce([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }])
      .mockRejectedValueOnce(new Error('network error'));

    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    // Expand the directory — its child browse will reject
    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/proj'));

    // A "Failed to load" message should appear under the expanded node
    await waitFor(() => {
      expect(screen.getByTestId('directory-picker-load-error-/Users/me/proj')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Title text — default titles match the artboard (area-3 parity, 3.2)
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — title text', () => {
  it('defaults to "Select Project Directory" in directory mode', async () => {
    mockBrowse.mockResolvedValue([]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByText('Select Project Directory')).not.toBeNull();
    });
  });

  it('defaults to "Select File" in file mode', async () => {
    mockBrowse.mockResolvedValue([]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'file' });
    });

    await waitFor(() => {
      expect(screen.queryByText('Select File')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Footer — Select label (not "Choose") + selected-path readout (3.6, 3.7)
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — footer parity', () => {
  it('confirm button always reads "Select", never "Choose"', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    expect(screen.getByTestId('directory-picker-confirm').textContent).toBe('Select');
  });

  it('renders the selected path in the footer once a row is picked', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/proj'));

    expect(screen.getByTestId('directory-picker-selected-path').textContent).toBe('/Users/me/proj');
  });
});

// ---------------------------------------------------------------------------
// 10. Home-crumb — fixed home label, not the live selection (3.3)
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — home crumb', () => {
  it('keeps showing "~" in the crumb after a row is selected', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/proj'));

    expect(screen.getByTestId('directory-picker-crumb').textContent).toBe('~');
  });
});

// ---------------------------------------------------------------------------
// 11. Per-node Empty + Loading rows (3.4, 3.5)
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — per-node tree states', () => {
  it('renders an inline "Empty" row under an expanded node with zero children', async () => {
    mockBrowse
      .mockResolvedValueOnce([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }])
      .mockResolvedValueOnce([]);

    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/proj'));

    await waitFor(() => {
      expect(screen.getByTestId('directory-picker-node-empty-/Users/me/proj')).toBeTruthy();
    });
  });

  it('renders an inline pulsing "Loading…" row while a node is expanding', async () => {
    let resolveChildren!: (v: { name: string; path: string; type: string }[]) => void;
    const childrenPromise = new Promise<{ name: string; path: string; type: string }[]>((res) => {
      resolveChildren = res;
    });

    mockBrowse.mockResolvedValueOnce([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);
    mockBrowse.mockReturnValueOnce(childrenPromise);

    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('directory-picker-row-/Users/me/proj'));

    await waitFor(() => {
      expect(screen.getByTestId('directory-picker-node-loading-/Users/me/proj')).toBeTruthy();
    });
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();

    act(() => {
      resolveChildren([]);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-node-loading-/Users/me/proj')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Stale-seed guard — second pickDirectory supersedes the first
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — stale-seed guard', () => {
  it('a stale root browse does not overwrite the current tree', async () => {
    let resolveFirst!: (v: { name: string; path: string; type: string }[]) => void;
    const firstBrowse = new Promise<{ name: string; path: string; type: string }[]>((res) => {
      resolveFirst = res;
    });

    // First call: hangs; second call returns a different set immediately
    mockBrowse
      .mockReturnValueOnce(firstBrowse)
      .mockResolvedValue([{ name: 'second', path: '/Users/me/second', type: 'directory' }]);

    render(<DirectoryPickerModal />);

    // Open once (hangs)
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    // Cancel and re-open immediately (second call will resolve right away)
    act(() => {
      useDirectoryPicker.getState().resolve(null);
      useDirectoryPicker.setState({ pending: null });
    });

    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    // Wait for the second tree to render
    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/second')).not.toBeNull();
    });

    // Now resolve the stale first browse with different data
    act(() => {
      resolveFirst([{ name: 'stale', path: '/Users/me/stale', type: 'directory' }]);
    });

    // The stale data must NOT appear; the current tree must remain intact
    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/stale')).toBeNull();
    });
    expect(screen.queryByTestId('directory-picker-row-/Users/me/second')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Header/footer horizontal padding + inline close button (3.1, 3.6, 3.10)
// ---------------------------------------------------------------------------

describe('DirectoryPickerModal — header/footer padding + inline close', () => {
  it('renders the header with 16px horizontal padding and justify-between layout', async () => {
    mockBrowse.mockResolvedValue([]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByText('Select Project Directory')).not.toBeNull();
    });

    const header = screen.getByText('Select Project Directory').closest('[class*="justify-between"]');
    expect(header).not.toBeNull();
    expect(header?.className).toContain('px-[16px]');
    expect(header?.className).toContain('justify-between');
  });

  it('renders the footer with 16px horizontal padding', async () => {
    mockBrowse.mockResolvedValue([{ name: 'proj', path: '/Users/me/proj', type: 'directory' }]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-row-/Users/me/proj')).not.toBeNull();
    });

    const footer = screen.getByTestId('directory-picker-selected-path').closest('[class*="justify-between"]');
    expect(footer).not.toBeNull();
    expect(footer?.className).toContain('px-[16px]');
  });

  it('renders an inline close button in the header row, not the base dialog close', async () => {
    mockBrowse.mockResolvedValue([]);
    render(<DirectoryPickerModal />);
    act(() => {
      void useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByText('Select Project Directory')).not.toBeNull();
    });

    // The base absolutely-positioned dialog close must be suppressed.
    expect(screen.queryByTestId('dialog-close')).toBeNull();

    const close = screen.getByTestId('directory-picker-close');
    expect(close.className).toContain('size-[26px]');
    expect(close.className).toContain('rounded-[7px]');
    expect(close.getAttribute('aria-label')).toBe('Close');

    const icon = close.querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('size-[14px]');
  });

  it('clicking the inline close button resolves null and closes the picker', async () => {
    mockBrowse.mockResolvedValue([]);
    render(<DirectoryPickerModal />);
    let picked: Promise<string | null>;
    act(() => {
      picked = useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('directory-picker-close')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('directory-picker-close'));

    await expect(picked!).resolves.toBeNull();
    expect(useDirectoryPicker.getState().pending).toBeNull();
  });
});
