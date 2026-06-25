import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useFindHotkey } from '../use-find-hotkey';
import { useFindInChatStore } from '../find-in-chat-store';

function Harness() {
  useFindHotkey();
  return null;
}

function dispatchCmdF(target: EventTarget) {
  const e = new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'target', { value: target });
  window.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  useFindInChatStore.setState({ isOpen: false, query: '', matches: [], activeIndex: 0 });
  document.body.innerHTML = '';
});

describe('useFindHotkey', () => {
  it('opens the store on Cmd+F outside a .cm-editor and prevents default', () => {
    render(<Harness />);
    const div = document.createElement('div');
    document.body.appendChild(div);
    let e!: KeyboardEvent;
    act(() => {
      e = dispatchCmdF(div);
    });
    expect(useFindInChatStore.getState().isOpen).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('does NOT open the store when the target is inside a .cm-editor', () => {
    render(<Harness />);
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const inner = document.createElement('span');
    editor.appendChild(inner);
    document.body.appendChild(editor);
    act(() => {
      dispatchCmdF(inner);
    });
    expect(useFindInChatStore.getState().isOpen).toBe(false);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = render(<Harness />);
    unmount();
    const div = document.createElement('div');
    document.body.appendChild(div);
    act(() => {
      dispatchCmdF(div);
    });
    expect(useFindInChatStore.getState().isOpen).toBe(false);
  });
});
