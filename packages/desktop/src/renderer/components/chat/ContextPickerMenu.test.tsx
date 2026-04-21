import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({
  searchFiles: vi.fn().mockResolvedValue([]),
  getFileTree: vi.fn().mockResolvedValue([]),
  addMention: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../store', () => ({
  useSkillsStore: () => ({ agents: [], skills: [], commands: [] }),
  useChatsStore: (sel: any) => sel({ activeChatId: 'chat-1' }),
}));

vi.mock('../../hooks/useActiveProjectId.js', () => ({
  useActiveProjectId: () => 'proj-1',
}));

vi.mock('../../lib/focus', () => ({
  focusComposerInput: vi.fn(),
}));

let composerText = '';
const composerSubscribers = new Set<() => void>();
const mockComposerRuntime = {
  getState: () => ({ text: composerText }),
  setText: (t: string) => {
    composerText = t;
    composerSubscribers.forEach((cb) => cb());
  },
  subscribe: (cb: () => void) => {
    composerSubscribers.add(cb);
    return () => composerSubscribers.delete(cb);
  },
};

vi.mock('@assistant-ui/react', () => ({
  useComposerRuntime: () => mockComposerRuntime,
}));

import { ContextPickerMenu } from './ContextPickerMenu';
import { searchFiles, getFileTree, addMention } from '../../lib/api';
import { TooltipProvider } from '../ui/tooltip';

beforeEach(() => {
  composerText = '';
  composerSubscribers.clear();
  vi.mocked(searchFiles).mockClear();
  vi.mocked(getFileTree).mockClear();
  vi.mocked(addMention).mockClear();
});

describe('ContextPickerMenu: fuzzy mode preserved', () => {
  it('calls searchFiles (not getFileTree) when token has no slash', async () => {
    render(<ContextPickerMenu forceOpen={false} onClose={vi.fn()} />);
    act(() => mockComposerRuntime.setText('@foo'));
    await new Promise((r) => setTimeout(r, 200));
    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(getFileTree).not.toHaveBeenCalled();
  });
});

describe('ContextPickerMenu: autocomplete mode', () => {
  it('calls getFileTree for the typed dir, renders filtered entries', async () => {
    vi.mocked(getFileTree).mockResolvedValueOnce([
      { name: 'components', type: 'directory', path: 'src/components' },
      { name: 'core', type: 'directory', path: 'src/core' },
      { name: 'app.ts', type: 'file', path: 'src/app.ts' },
    ]);

    render(
      <TooltipProvider>
        <ContextPickerMenu forceOpen={false} onClose={vi.fn()} />
      </TooltipProvider>,
    );
    act(() => mockComposerRuntime.setText('@src/co'));
    await new Promise((r) => setTimeout(r, 200));

    expect(getFileTree).toHaveBeenCalledWith('proj-1', 'src', 'chat-1');
    // Prefix filter on leaf 'co' — matches 'components' and 'core'; excludes 'app.ts'.
    expect(await screen.findByText('components/')).toBeInTheDocument();
    expect(await screen.findByText('core/')).toBeInTheDocument();
    expect(screen.queryByText('app.ts')).toBeNull();
  });

  it('caches tree results — second keystroke in same dir does not re-fetch', async () => {
    vi.mocked(getFileTree).mockResolvedValue([
      { name: 'alpha.ts', type: 'file', path: 'src/alpha.ts' },
      { name: 'beta.ts', type: 'file', path: 'src/beta.ts' },
    ]);

    render(
      <TooltipProvider>
        <ContextPickerMenu forceOpen={false} onClose={vi.fn()} />
      </TooltipProvider>,
    );
    act(() => mockComposerRuntime.setText('@src/a'));
    await new Promise((r) => setTimeout(r, 200));
    expect(getFileTree).toHaveBeenCalledTimes(1);

    act(() => mockComposerRuntime.setText('@src/al'));
    await new Promise((r) => setTimeout(r, 200));
    // Same dir 'src' → cache hit, still 1 call.
    expect(getFileTree).toHaveBeenCalledTimes(1);
  });
});

describe('ContextPickerMenu: autocomplete selection', () => {
  it('Enter on directory rewrites text with trailing slash, keeps picker open, re-fetches', async () => {
    vi.mocked(getFileTree)
      .mockResolvedValueOnce([{ name: 'components', type: 'directory', path: 'src/components' }])
      .mockResolvedValueOnce([{ name: 'Button.tsx', type: 'file', path: 'src/components/Button.tsx' }]);

    const onClose = vi.fn();
    render(
      <TooltipProvider>
        <ContextPickerMenu forceOpen={false} onClose={onClose} />
      </TooltipProvider>,
    );
    act(() => mockComposerRuntime.setText('@src/co'));
    await new Promise((r) => setTimeout(r, 200));

    // Press Enter on the (only) matching item — 'components' directory.
    await userEvent.keyboard('{Enter}');

    expect(composerText).toBe('@src/components/');
    expect(onClose).not.toHaveBeenCalled();

    // Wait for the re-fetch effect; dir changed to 'src/components'.
    await new Promise((r) => setTimeout(r, 200));
    expect(getFileTree).toHaveBeenLastCalledWith('proj-1', 'src/components', 'chat-1');
  });

  it('Enter on file commits mention, closes picker', async () => {
    vi.mocked(getFileTree).mockResolvedValueOnce([{ name: 'app.ts', type: 'file', path: 'src/app.ts' }]);
    const onClose = vi.fn();
    render(
      <TooltipProvider>
        <ContextPickerMenu forceOpen={false} onClose={onClose} />
      </TooltipProvider>,
    );
    act(() => mockComposerRuntime.setText('@src/a'));
    await new Promise((r) => setTimeout(r, 200));

    await userEvent.keyboard('{Enter}');

    expect(composerText).toBe('@src/app.ts ');
    const { addMention } = await import('../../lib/api');
    expect(addMention).toHaveBeenCalledWith('chat-1', {
      kind: 'file',
      name: 'app.ts',
      path: 'src/app.ts',
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ContextPickerMenu: Tab key', () => {
  it('Tab on file completes the leaf but does NOT close picker or commit mention', async () => {
    vi.mocked(getFileTree).mockResolvedValueOnce([{ name: 'Button.tsx', type: 'file', path: 'src/Button.tsx' }]);
    const onClose = vi.fn();
    render(
      <TooltipProvider>
        <ContextPickerMenu forceOpen={false} onClose={onClose} />
      </TooltipProvider>,
    );
    act(() => mockComposerRuntime.setText('@src/But'));
    await new Promise((r) => setTimeout(r, 200));

    await userEvent.keyboard('{Tab}');

    expect(composerText).toBe('@src/Button.tsx');
    expect(onClose).not.toHaveBeenCalled();
    expect(addMention).not.toHaveBeenCalled();
  });

  it('Tab on directory drills in (same as Enter)', async () => {
    vi.mocked(getFileTree)
      .mockResolvedValueOnce([{ name: 'components', type: 'directory', path: 'src/components' }])
      .mockResolvedValueOnce([]);

    render(
      <TooltipProvider>
        <ContextPickerMenu forceOpen={false} onClose={vi.fn()} />
      </TooltipProvider>,
    );
    act(() => mockComposerRuntime.setText('@src/co'));
    await new Promise((r) => setTimeout(r, 200));

    await userEvent.keyboard('{Tab}');

    expect(composerText).toBe('@src/components/');
  });
});
