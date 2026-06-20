// packages/app-tauri/src/features/palette/__tests__/SpotlightPalette.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOverlaysStore } from '@/store/overlays';

const mockSearchFiles = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api/files', () => ({ searchFiles: (...a: unknown[]) => mockSearchFiles(...a) }));
vi.mock('@/lib/api/git', () => ({ getGitStatus: vi.fn().mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]) }));
const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a), onSurfaceIntent: vi.fn(() => () => {}) }));
const mockSwitch = vi.fn();
vi.mock('@assistant-ui/react', async (orig) => {
  const o = await orig<typeof import('@assistant-ui/react')>();
  return {
    ...o,
    useAssistantRuntime: () => ({ threads: { switchToThread: mockSwitch } }),
    useAuiState: (sel: (s: unknown) => unknown) =>
      sel({ threads: { threadItems: [{ id: 'c1', remoteId: 'c1', title: 'Build palette', status: 'regular', custom: { projectId: 'p' } }] } }),
  };
});
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'p', chatId: 'c1', projectPath: '/p', projectName: 'P' }),
}));

const { SpotlightPalette } = await import('../SpotlightPalette');

function open() {
  act(() => useOverlaysStore.getState().setPaletteOpen(true));
}
beforeEach(() => {
  mockEmit.mockReset();
  mockSwitch.mockReset();
  act(() => useOverlaysStore.setState({ paletteOpen: false }));
});
afterEach(() => act(() => useOverlaysStore.setState({ paletteOpen: false })));

describe('SpotlightPalette', () => {
  it('is absent when closed, present when open', async () => {
    render(<SpotlightPalette />);
    expect(screen.queryByTestId('search-palette-input')).toBeNull();
    open();
    await waitFor(() => expect(screen.queryByTestId('search-palette-input')).not.toBeNull());
  });

  it('shows the title-matching session and switches on click', async () => {
    render(<SpotlightPalette />);
    open();
    const row = await screen.findByTestId('search-palette-session-row-c1');
    await userEvent.click(row);
    expect(mockSwitch).toHaveBeenCalledWith('c1');
    expect(useOverlaysStore.getState().paletteOpen).toBe(false);
  });

  it('# mode shows a mode chip and a change row', async () => {
    render(<SpotlightPalette />);
    open();
    const input = await screen.findByTestId('search-palette-input');
    await userEvent.type(input, '#');
    expect(await screen.findByTestId('search-palette-mode-chip')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('search-palette-change-row-src/a.ts')).not.toBeNull());
  });
});
