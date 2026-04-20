import { render, act } from '@testing-library/react';
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
