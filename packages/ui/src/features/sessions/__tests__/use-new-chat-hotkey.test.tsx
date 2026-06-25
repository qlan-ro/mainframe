import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useNewChatHotkey } from '../use-new-chat-hotkey';

function Harness({ onNewChat }: { onNewChat: () => void }) {
  useNewChatHotkey(onNewChat);
  return null;
}

function dispatchKey(key: string, opts: { meta?: boolean; shift?: boolean } = {}) {
  const e = new KeyboardEvent('keydown', {
    key,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('useNewChatHotkey', () => {
  it('calls onNewChat and prevents default on Cmd+N', () => {
    const onNewChat = vi.fn();
    render(<Harness onNewChat={onNewChat} />);
    let e!: KeyboardEvent;
    act(() => {
      e = dispatchKey('n', { meta: true });
    });
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores Cmd+Shift+N', () => {
    const onNewChat = vi.fn();
    render(<Harness onNewChat={onNewChat} />);
    act(() => {
      dispatchKey('n', { meta: true, shift: true });
    });
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('ignores plain N (no modifier)', () => {
    const onNewChat = vi.fn();
    render(<Harness onNewChat={onNewChat} />);
    act(() => {
      dispatchKey('n');
    });
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const onNewChat = vi.fn();
    const { unmount } = render(<Harness onNewChat={onNewChat} />);
    unmount();
    act(() => {
      dispatchKey('n', { meta: true });
    });
    expect(onNewChat).not.toHaveBeenCalled();
  });
});
