import { render, screen, act } from '@testing-library/react';
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
import { searchFiles, getFileTree } from '../../lib/api';
import { TooltipProvider } from '../ui/tooltip';

beforeEach(() => {
  composerText = '';
  composerSubscribers.clear();
  vi.mocked(searchFiles).mockClear();
  vi.mocked(getFileTree).mockClear();
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
