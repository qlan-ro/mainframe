// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useUnattendedConfirm } from '../use-unattended-confirm';

// The set of confirmed chats lives at module level for the life of the app, so
// each case uses a chat id of its own.

describe('useUnattendedConfirm (C13)', () => {
  it('applies a mode other than Unattended straight away', () => {
    const setMode = vi.fn();
    const { result } = renderHook(() => useUnattendedConfirm('chat-plain', 'default', setMode));

    act(() => result.current.request('acceptEdits'));

    expect(setMode).toHaveBeenCalledExactlyOnceWith('acceptEdits');
    expect(result.current.open).toBe(false);
  });

  it('asks before turning Unattended on, and does not apply it yet', () => {
    const setMode = vi.fn();
    const { result } = renderHook(() => useUnattendedConfirm('chat-ask', 'default', setMode));

    act(() => result.current.request('yolo'));

    expect(result.current.open).toBe(true);
    expect(setMode).not.toHaveBeenCalled();
  });

  it('applies Unattended and closes once confirmed', () => {
    const setMode = vi.fn();
    const { result } = renderHook(() => useUnattendedConfirm('chat-confirm', 'default', setMode));
    act(() => result.current.request('yolo'));

    act(() => result.current.confirm());

    expect(setMode).toHaveBeenCalledExactlyOnceWith('yolo');
    expect(result.current.open).toBe(false);
  });

  it('closes without applying when cancelled, and asks again next time', () => {
    const setMode = vi.fn();
    const { result } = renderHook(() => useUnattendedConfirm('chat-cancel', 'default', setMode));
    act(() => result.current.request('yolo'));

    act(() => result.current.cancel());

    expect(result.current.open).toBe(false);
    expect(setMode).not.toHaveBeenCalled();

    act(() => result.current.request('yolo'));
    expect(result.current.open).toBe(true);
  });

  it('asks only once per chat: after confirming, the next Unattended applies at once', () => {
    const setMode = vi.fn();
    const { result } = renderHook(() => useUnattendedConfirm('chat-once', 'default', setMode));
    act(() => result.current.request('yolo'));
    act(() => result.current.confirm());
    setMode.mockClear();

    act(() => result.current.request('yolo'));

    expect(setMode).toHaveBeenCalledExactlyOnceWith('yolo');
    expect(result.current.open).toBe(false);
  });

  it('asks again in a different chat', () => {
    const first = renderHook(() => useUnattendedConfirm('chat-one', 'default', vi.fn()));
    act(() => first.result.current.request('yolo'));
    act(() => first.result.current.confirm());

    const second = renderHook(() => useUnattendedConfirm('chat-two', 'default', vi.fn()));
    act(() => second.result.current.request('yolo'));

    expect(second.result.current.open).toBe(true);
  });

  it('does not ask when the chat is already Unattended', () => {
    const setMode = vi.fn();
    const { result } = renderHook(() => useUnattendedConfirm('chat-already', 'yolo', setMode));

    act(() => result.current.request('yolo'));

    expect(setMode).toHaveBeenCalledExactlyOnceWith('yolo');
  });

  it('does not ask without a chat to remember it for', () => {
    const setMode = vi.fn();
    const { result } = renderHook(() => useUnattendedConfirm(null, 'default', setMode));

    act(() => result.current.request('yolo'));

    expect(setMode).toHaveBeenCalledExactlyOnceWith('yolo');
  });
});
