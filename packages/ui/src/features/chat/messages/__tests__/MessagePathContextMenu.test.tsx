/**
 * MessagePathContextMenu — right-click menu resolving the file path under the
 * cursor from `[data-file-path]` (spec 274-A1..A5, A9, A10).
 *
 * Mock strategy: seed the real useActiveBasesStore (zustand, not a module
 * mock) and stub navigator.clipboard.writeText + window.getSelection. Uses
 * fireEvent.contextMenu per the shipped precedent (markdown-text.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MessagePathContextMenu } from '../MessagePathContextMenu';
import { useActiveBasesStore } from '@/store/active-bases-store';

const writeText = vi.fn().mockResolvedValue(undefined);

function Fixture({ filePath }: { filePath: string }) {
  return (
    <MessagePathContextMenu>
      <span data-file-path={filePath}>
        <span>nested text</span>
      </span>
      <p>plain paragraph, no path</p>
    </MessagePathContextMenu>
  );
}

function stubSelection(text: string) {
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text } as unknown as Selection);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  writeText.mockClear();
  useActiveBasesStore.setState({ bases: { worktreePath: '/w', projectPath: '/p' }, scopeKey: null });
  stubSelection('');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MessagePathContextMenu — trigger element', () => {
  it('carries the chat-message-menu-trigger testid and flex classes', () => {
    render(<Fixture filePath="/w/src/a.ts" />);
    const trigger = screen.getByTestId('chat-message-menu-trigger');
    expect(trigger.className).toContain('flex');
    expect(trigger.className).toContain('flex-col');
    expect(trigger.className).toContain('gap-2');
  });
});

describe('MessagePathContextMenu — right-click on the path pill, no selection', () => {
  it('shows exactly the two copy items, in order, enabled', () => {
    render(<Fixture filePath="/w/src/a.ts" />);
    fireEvent.contextMenu(screen.getByText('nested text'));

    const absolute = screen.getByTestId('tool-card-path-copy-absolute');
    const relative = screen.getByTestId('tool-card-path-copy-relative');
    expect(absolute).not.toHaveAttribute('data-disabled');
    expect(relative).not.toHaveAttribute('data-disabled');
    expect(screen.queryByTestId('chat-menu-empty')).toBeNull();

    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toBe(absolute);
    expect(items[1]).toBe(relative);
  });

  it('resolves the same path when right-clicking a child node inside the pill (closest, not target)', () => {
    render(<Fixture filePath="/w/src/a.ts" />);
    fireEvent.contextMenu(screen.getByText('nested text'));

    fireEvent.click(screen.getByTestId('tool-card-path-copy-absolute'));
    expect(writeText).toHaveBeenCalledWith('/w/src/a.ts');
  });
});

describe('MessagePathContextMenu — copy targets', () => {
  it('absolute item writes the absolute string, relative item writes the base-relative string', () => {
    render(<Fixture filePath="/w/src/a.ts" />);

    fireEvent.contextMenu(screen.getByText('nested text'));
    fireEvent.click(screen.getByTestId('tool-card-path-copy-absolute'));
    expect(writeText).toHaveBeenLastCalledWith('/w/src/a.ts');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    fireEvent.contextMenu(screen.getByText('nested text'));
    fireEvent.click(screen.getByTestId('tool-card-path-copy-relative'));
    expect(writeText).toHaveBeenLastCalledWith('src/a.ts');
  });

  it('degraded case: a path outside every base writes the same string for both items', () => {
    render(<Fixture filePath="/outside/of/bases/file.ts" />);

    fireEvent.contextMenu(screen.getByText('nested text'));
    fireEvent.click(screen.getByTestId('tool-card-path-copy-absolute'));
    expect(writeText).toHaveBeenLastCalledWith('/outside/of/bases/file.ts');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    fireEvent.contextMenu(screen.getByText('nested text'));
    fireEvent.click(screen.getByTestId('tool-card-path-copy-relative'));
    expect(writeText).toHaveBeenLastCalledWith('/outside/of/bases/file.ts');
  });
});

describe('MessagePathContextMenu — copied feedback', () => {
  it('shows Check + Copied on only the clicked item, closes itself after ~900ms, and resets on reopen', () => {
    render(<Fixture filePath="/w/src/a.ts" />);

    fireEvent.contextMenu(screen.getByText('nested text'));
    fireEvent.click(screen.getByTestId('tool-card-path-copy-absolute'));

    const absoluteAfterClick = screen.getByTestId('tool-card-path-copy-absolute');
    expect(absoluteAfterClick.textContent).toContain('Copied');
    expect(absoluteAfterClick.querySelector('svg')).toHaveClass('text-mf-success');
    expect(screen.getByTestId('tool-card-path-copy-relative').textContent).toContain('Copy Relative Path');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('tool-card-path-copy-absolute')).toBeNull();

    fireEvent.contextMenu(screen.getByText('nested text'));
    expect(screen.getByTestId('tool-card-path-copy-absolute').textContent).toContain('Copy Absolute Path');
  });
});

describe('MessagePathContextMenu — non-empty selection wins over the path', () => {
  it('shows only the disabled chat-menu-empty item, no copy items', () => {
    stubSelection('some selected text');
    render(<Fixture filePath="/w/src/a.ts" />);
    fireEvent.contextMenu(screen.getByText('nested text'));

    expect(screen.getByTestId('chat-menu-empty')).toHaveAttribute('data-disabled');
    expect(screen.queryByTestId('tool-card-path-copy-absolute')).toBeNull();
    expect(screen.queryByTestId('tool-card-path-copy-relative')).toBeNull();
  });
});

describe('MessagePathContextMenu — right-click outside any pill', () => {
  it('shows only the disabled chat-menu-empty item', () => {
    render(<Fixture filePath="/w/src/a.ts" />);
    fireEvent.contextMenu(screen.getByText('plain paragraph, no path'));

    expect(screen.getByTestId('chat-menu-empty')).toHaveAttribute('data-disabled');
    expect(screen.queryByTestId('tool-card-path-copy-absolute')).toBeNull();
  });
});
