/**
 * ContextNotPreservedNotice — behavior tests (todo #346).
 *
 * Covered:
 *  - hidden when there is no chat, or no contextLostAt;
 *  - renders the chat-id-keyed notice when contextLostAt is set;
 *  - dismiss hides it immediately;
 *  - the dismissal survives a remount (a reload) for the SAME contextLostAt;
 *  - a NEW contextLostAt (a later loss) reopens it even after a dismiss.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Chat } from '@qlan-ro/mainframe-types';

let __chatConfig: Partial<Chat> | null = null;

vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => (__chatConfig === null ? undefined : { state: { chatConfig: __chatConfig } }),
}));

import { ContextNotPreservedNotice } from '../ContextNotPreservedNotice';

function chat(overrides: Partial<Chat>): Partial<Chat> {
  return { id: 'chat-9', ...overrides };
}

beforeEach(() => {
  __chatConfig = null;
  window.localStorage.clear();
});

describe('ContextNotPreservedNotice — visibility', () => {
  it('renders nothing when extras are unavailable', () => {
    render(<ContextNotPreservedNotice />);
    expect(screen.queryByTestId('chat-context-not-preserved-chat-9')).toBeNull();
  });

  it('renders nothing when contextLostAt is unset', () => {
    __chatConfig = chat({ contextLostAt: null });
    render(<ContextNotPreservedNotice />);
    expect(screen.queryByTestId('chat-context-not-preserved-chat-9')).toBeNull();
  });

  it('renders the chat-id-keyed notice when contextLostAt is set', () => {
    __chatConfig = chat({ contextLostAt: '2026-09-24T00:00:00.000Z' });
    render(<ContextNotPreservedNotice />);
    const notice = screen.getByTestId('chat-context-not-preserved-chat-9');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent('Earlier context was not preserved');
  });
});

describe('ContextNotPreservedNotice — dismiss', () => {
  it('hides immediately on dismiss', () => {
    __chatConfig = chat({ contextLostAt: '2026-09-24T00:00:00.000Z' });
    render(<ContextNotPreservedNotice />);
    fireEvent.click(screen.getByTestId('chat-context-not-preserved-dismiss-chat-9'));
    expect(screen.queryByTestId('chat-context-not-preserved-chat-9')).toBeNull();
  });

  it('stays hidden across a remount for the SAME contextLostAt (a reload)', () => {
    __chatConfig = chat({ contextLostAt: '2026-09-24T00:00:00.000Z' });
    const { unmount } = render(<ContextNotPreservedNotice />);
    fireEvent.click(screen.getByTestId('chat-context-not-preserved-dismiss-chat-9'));
    unmount();

    render(<ContextNotPreservedNotice />);
    expect(screen.queryByTestId('chat-context-not-preserved-chat-9')).toBeNull();
  });

  it('reappears when contextLostAt changes to a NEW value after a dismiss', () => {
    __chatConfig = chat({ contextLostAt: '2026-09-24T00:00:00.000Z' });
    const { rerender } = render(<ContextNotPreservedNotice />);
    fireEvent.click(screen.getByTestId('chat-context-not-preserved-dismiss-chat-9'));
    expect(screen.queryByTestId('chat-context-not-preserved-chat-9')).toBeNull();

    __chatConfig = chat({ contextLostAt: '2026-09-25T00:00:00.000Z' });
    rerender(<ContextNotPreservedNotice />);
    expect(screen.getByTestId('chat-context-not-preserved-chat-9')).toBeInTheDocument();
  });
});
