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

describe('ContextNotPreservedNotice — compact + testIdKey (todo #344)', () => {
  it('keys the compact not-preserved line by testIdKey, not the chat id', () => {
    __chatConfig = chat({ contextLostAt: '2026-09-24T00:00:00.000Z' });
    render(<ContextNotPreservedNotice compact kind="not-preserved" testIdKey="parent-7" />);

    expect(screen.queryByTestId('chat-context-not-preserved-chat-9')).toBeNull();
    const notice = screen.getByTestId('chat-context-not-preserved-parent-7');
    expect(notice).toHaveTextContent('Earlier context was not preserved');
  });

  it('dismisses by the underlying chat id even though the test id is keyed by the parent', () => {
    __chatConfig = chat({ contextLostAt: '2026-09-24T00:00:00.000Z' });
    const { unmount } = render(<ContextNotPreservedNotice compact kind="not-preserved" testIdKey="parent-7" />);
    fireEvent.click(screen.getByTestId('chat-context-not-preserved-dismiss-parent-7'));
    expect(screen.queryByTestId('chat-context-not-preserved-parent-7')).toBeNull();
    unmount();

    // Survives a remount for the SAME contextLostAt (dismissal keyed by chat-9).
    render(<ContextNotPreservedNotice compact kind="not-preserved" testIdKey="parent-7" />);
    expect(screen.queryByTestId('chat-context-not-preserved-parent-7')).toBeNull();
  });
});

describe('ContextNotPreservedNotice — kind="provider-transcript" (todo #344)', () => {
  it('renders nothing when there is no chat', () => {
    render(<ContextNotPreservedNotice compact kind="provider-transcript" testIdKey="parent-7" />);
    expect(screen.queryByTestId('chat-provider-keeps-transcript-parent-7')).toBeNull();
  });

  it('renders the provider-transcript note when the adapter has no noPersistence capability, with no dismiss control', () => {
    __chatConfig = chat({ contextLostAt: null, adapterId: 'claude' });
    render(<ContextNotPreservedNotice compact kind="provider-transcript" testIdKey="parent-7" />);

    const notice = screen.getByTestId('chat-provider-keeps-transcript-parent-7');
    expect(notice).toHaveTextContent('This provider keeps its own transcript for this chat.');
    expect(notice.textContent).not.toMatch(/not saved|nothing was saved/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never renders together with the not-preserved line for the same chat', () => {
    // A capability-off chat never stamps contextLostAt (only a no-persistence
    // spawn does) — the two are mutually exclusive by construction.
    __chatConfig = chat({ contextLostAt: null, adapterId: 'claude' });
    render(
      <>
        <ContextNotPreservedNotice compact kind="not-preserved" testIdKey="parent-7" />
        <ContextNotPreservedNotice compact kind="provider-transcript" testIdKey="parent-7" />
      </>,
    );

    expect(screen.queryByTestId('chat-context-not-preserved-parent-7')).toBeNull();
    expect(screen.getByTestId('chat-provider-keeps-transcript-parent-7')).toBeInTheDocument();
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
