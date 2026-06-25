import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindBar } from '../FindBar';
import { useFindInChatStore } from '../find-in-chat-store';

function mountThread(html: string) {
  const root = document.createElement('div');
  root.setAttribute('data-mf-chat-thread', '');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

let thread: HTMLElement | null = null;

beforeEach(() => {
  vi.useRealTimers();
  useFindInChatStore.setState({ isOpen: false, query: '', matches: [], activeIndex: 0 });
});

afterEach(() => {
  thread?.remove();
  thread = null;
});

describe('FindBar', () => {
  it('renders nothing when closed', () => {
    render(<FindBar />);
    expect(screen.queryByTestId('find-bar')).toBeNull();
  });

  it('renders and autofocuses the input when open', async () => {
    act(() => {
      useFindInChatStore.getState().open();
    });
    render(<FindBar />);
    const input = await screen.findByTestId('thread-find-input');
    expect(input).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('typing a query runs the debounced search and updates the count', async () => {
    thread = mountThread(`<div data-message-id="m1"><div data-text-part>hello hello</div></div>`);
    act(() => {
      useFindInChatStore.getState().open();
    });
    render(<FindBar />);
    const input = await screen.findByTestId('thread-find-input');
    await userEvent.type(input, 'hello');
    await waitFor(() => expect(useFindInChatStore.getState().matches).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('find-bar').textContent).toContain('1/2'));
  });

  it('next/prev move the active index', async () => {
    act(() => {
      useFindInChatStore.setState({
        isOpen: true,
        query: 'x',
        matches: [
          { messageId: 'm1', partIndex: 0, charStart: 0, charEnd: 1 },
          { messageId: 'm1', partIndex: 0, charStart: 2, charEnd: 3 },
        ],
        activeIndex: 0,
      });
    });
    render(<FindBar />);
    await userEvent.click(screen.getByTestId('thread-find-next'));
    expect(useFindInChatStore.getState().activeIndex).toBe(1);
    await userEvent.click(screen.getByTestId('thread-find-prev'));
    expect(useFindInChatStore.getState().activeIndex).toBe(0);
  });

  it('Escape closes the bar', async () => {
    act(() => {
      useFindInChatStore.getState().open();
    });
    render(<FindBar />);
    const input = await screen.findByTestId('thread-find-input');
    await userEvent.type(input, '{Escape}');
    expect(useFindInChatStore.getState().isOpen).toBe(false);
    expect(screen.queryByTestId('find-bar')).toBeNull();
  });
});
