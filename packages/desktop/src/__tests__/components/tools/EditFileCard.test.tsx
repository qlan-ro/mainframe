import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../renderer/store/tabs.js', () => {
  const state = { openInlineDiffTab: vi.fn(), openEditorTab: vi.fn(), revealFileInTree: vi.fn() };
  const useTabsStore: any = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  useTabsStore.getState = vi.fn().mockReturnValue(state);
  return { useTabsStore };
});

// useProjectsStore and useUIStore are imported transitively through tabs.ts
// The mock above replaces the module before those imports are resolved.

import { EditFileCard } from '../../../renderer/components/chat/assistant-ui/parts/tools/EditFileCard.js';
import { useTabsStore } from '../../../renderer/store/tabs.js';
import { TooltipProvider } from '../../../renderer/components/ui/tooltip.js';

describe('EditFileCard', () => {
  beforeEach(() => {
    vi.mocked(useTabsStore.getState).mockReturnValue({
      openInlineDiffTab: vi.fn(),
      openEditorTab: vi.fn(),
      revealFileInTree: vi.fn(),
    });
  });

  it('renders shortened filename (last 2 path segments)', () => {
    render(
      <TooltipProvider>
        <EditFileCard
          args={{ file_path: '/home/user/project/src/index.ts', old_string: 'old', new_string: 'new' }}
          result={undefined}
          isError={undefined}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
  });

  it('renders short path as-is when fewer than 3 segments', () => {
    render(
      <TooltipProvider>
        <EditFileCard
          args={{ file_path: 'README.md', old_string: '', new_string: '# Hello' }}
          result={undefined}
          isError={undefined}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('shows pulsing dot when result is undefined (running)', () => {
    const { container } = render(
      <TooltipProvider>
        <EditFileCard
          args={{ file_path: '/a/b/c.ts', old_string: 'old', new_string: 'new' }}
          result={undefined}
          isError={undefined}
        />
      </TooltipProvider>,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does not show pulsing dot when result is provided', () => {
    const { container } = render(
      <TooltipProvider>
        <EditFileCard
          args={{ file_path: '/a/b/c.ts', old_string: 'old', new_string: 'new' }}
          result="1 change applied"
          isError={false}
        />
      </TooltipProvider>,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('renders "Open in diff editor" button in the header area', () => {
    render(
      <TooltipProvider>
        <EditFileCard
          args={{ file_path: '/a/b/c.ts', old_string: 'old', new_string: 'new' }}
          result="done"
          isError={false}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Open in diff editor' })).toBeInTheDocument();
  });

  it('calls openInlineDiffTab when "Open in diff editor" is clicked', async () => {
    const openInlineDiffTab = vi.fn();
    vi.mocked(useTabsStore.getState).mockReturnValue({ openInlineDiffTab });

    render(
      <TooltipProvider>
        <EditFileCard
          args={{ file_path: '/a/b/c.ts', old_string: 'foo', new_string: 'bar' }}
          result="1 change"
          isError={false}
        />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open in diff editor' }));
    expect(openInlineDiffTab).toHaveBeenCalledWith('/a/b/c.ts', expect.any(String), expect.any(String), undefined);
  });
});
