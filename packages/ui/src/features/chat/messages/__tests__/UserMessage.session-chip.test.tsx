/**
 * UserMessage — session-chip rendering behavior (todo #240). AC 10-14, 16, 24.
 *
 * The core dispatch (strip + one chip, command-path strip, mixed markdown) is
 * already pinned in UserMessage.test.tsx's "SR" describe block; this file
 * covers the remaining edge cases the plan calls out separately: optimistic
 * vs confirmed identity, duplicate labels, a markdown-syntax title, a
 * metadata-less replay, and the untouched-plain-text guarantee.
 *
 * Same mocking strategy as UserMessage.test.tsx (which owns the base test
 * file) — copied here rather than shared, since this is a new, independent
 * test file per the lane's group boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ retryMessage: vi.fn() }),
  useChatQueuedMessages: () => [],
}));

interface SyntheticMainframeMeta {
  cleanText?: string;
  command?: {
    name: string;
    userText?: string;
    source?: 'commands' | (string & {});
  };
}

interface SyntheticMessageState {
  id: string;
  content: Array<{ type: string; text?: string; image?: string }>;
  metadata: {
    custom: {
      mainframe?: SyntheticMainframeMeta;
    };
  };
}

let __messageFixture: SyntheticMessageState = {
  id: 'msg-1',
  content: [{ type: 'text', text: 'Hello world' }],
  metadata: { custom: {} },
};

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { message: SyntheticMessageState }) => unknown) =>
    selector({ message: __messageFixture }),
  MessagePrimitive: {
    Root: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
  },
}));

vi.mock('../UserAttachments', () => ({
  UserAttachments: () => <div data-testid="chat-user-attachments" />,
}));

vi.mock('../QueuedUserTurn', () => ({
  QueuedUserTurn: ({ children, extrasSlot }: { children?: React.ReactNode; extrasSlot?: React.ReactNode }) => (
    <div data-testid="chat-queued-message">
      {children}
      {extrasSlot}
    </div>
  ),
}));

vi.mock('@/features/skills/use-chat-skills', async (importActual) => {
  const actual = await importActual<typeof import('@/features/skills/use-chat-skills')>();
  return { ...actual, useChatSkills: () => ({ skills: [], loading: false }) };
});

import { UserMessage } from '../UserMessage';

function renderUserMessage() {
  return render(<UserMessage />);
}

function makeFixture(
  overrides: Partial<SyntheticMessageState> & { mainframe?: SyntheticMainframeMeta } = {},
): SyntheticMessageState {
  const { mainframe, ...rest } = overrides;
  return {
    id: 'msg-test',
    content: [{ type: 'text', text: 'Hello' }],
    metadata: { custom: { mainframe } },
    ...rest,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserMessage session chip — optimistic vs confirmed identity (AC 13)', () => {
  it('renders identical markup for the optimistic echo (no cleanText) and the confirmed echo (same cleanText)', () => {
    const rawBody = 'Referenced session @session[Foo refactor]: /repo/a\n\nlook at @session[Foo refactor] please';

    __messageFixture = makeFixture({ content: [{ type: 'text', text: rawBody }], mainframe: undefined });
    const optimistic = renderUserMessage();
    const optimisticHtml = optimistic.container.innerHTML;
    optimistic.unmount();

    __messageFixture = makeFixture({
      content: [{ type: 'text', text: rawBody }],
      mainframe: { cleanText: rawBody },
    });
    const confirmed = renderUserMessage();
    const confirmedHtml = confirmed.container.innerHTML;

    expect(confirmedHtml).toBe(optimisticHtml);
    expect(screen.getByTestId('chat-message-session-chip-foo-refactor')).toBeInTheDocument();
    expect(screen.queryByText(/Referenced session/)).not.toBeInTheDocument();
  });
});

describe('UserMessage session chip — duplicate references (AC 7)', () => {
  it('renders two chips for two tokens sharing the same label', () => {
    __messageFixture = makeFixture({
      content: [
        {
          type: 'text',
          text: 'Referenced session @session[Foo]: /repo/a\n\n@session[Foo] and again @session[Foo]',
        },
      ],
      mainframe: undefined,
    });
    renderUserMessage();

    expect(screen.getAllByTestId('chat-message-session-chip-foo')).toHaveLength(2);
  });
});

describe('UserMessage session chip — markdown-syntax title (AC 12)', () => {
  it('renders exactly one chip, no <code> element, and no raw @session[ fragment', () => {
    __messageFixture = makeFixture({
      content: [
        {
          type: 'text',
          text:
            'Referenced session @session[Why does useEffect fire twice]: /repo/a\n\n' +
            'see @session[Why does useEffect fire twice] for context',
        },
      ],
      mainframe: undefined,
    });
    const { container } = renderUserMessage();

    expect(screen.getAllByTestId('chat-message-session-chip-why-does-useeffect-fire-twice')).toHaveLength(1);
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).not.toContain('@session[');
  });
});

describe('UserMessage session chip — replayed message (AC 14)', () => {
  it('reproduces the chip from body text alone, with no metadata', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'Referenced session @session[Foo]: /repo/a\n\ncompare with @session[Foo] now' }],
      mainframe: undefined,
    });
    renderUserMessage();

    expect(screen.getByTestId('chat-message-session-chip-foo')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-session-chip-foo')).toHaveTextContent('Foo');
  });
});

describe('UserMessage session chip — command message (decision D1)', () => {
  it('renders the SlashPill and the remaining text, with no leaked reference line or path', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: '/review\nReferenced session @session[Foo]: /repo/a\n\nlook at this' }],
      mainframe: {
        command: {
          name: 'review',
          source: 'commands',
          userText: 'Referenced session @session[Foo]: /repo/a\n\nlook at this',
        },
      },
    });
    const { container } = renderUserMessage();

    expect(screen.getByText('/review')).toBeInTheDocument();
    expect(screen.getByText(/look at this/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('Referenced session');
    expect(container.textContent).not.toContain('/repo/a');
  });
});

describe('UserMessage session chip — plain text unaffected (AC 16)', () => {
  it('renders a plain markdown message byte-identically to a chip-less baseline', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'Just **regular** markdown, nothing special.' }],
      mainframe: undefined,
    });
    const { container } = renderUserMessage();

    expect(container.querySelector('strong')).toHaveTextContent('regular');
    expect(screen.queryByTestId(/chat-message-session-chip-/)).not.toBeInTheDocument();
    expect(container.textContent).toBe('Just regular markdown, nothing special.');
  });

  it('renders a plain @file mention message byte-identically to a chip-less baseline', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'see @Layout.tsx for details' }],
      mainframe: undefined,
    });
    const { container } = renderUserMessage();

    expect(screen.getByText('@Layout.tsx')).toBeInTheDocument();
    expect(screen.queryByTestId(/chat-message-session-chip-/)).not.toBeInTheDocument();
    expect(container.textContent).toBe('see @Layout.tsx for details');
  });
});

describe('UserMessage session chip — test-id slug (AC 24)', () => {
  it('slugs a label with spaces and a parenthesized suffix', () => {
    __messageFixture = makeFixture({
      content: [
        {
          type: 'text',
          text: 'Referenced session @session[Foo Bar (2)]: /repo/a\n\nsee @session[Foo Bar (2)] please',
        },
      ],
      mainframe: undefined,
    });
    renderUserMessage();

    const chip = screen.getByTestId('chat-message-session-chip-foo-bar-2');
    expect(chip).toHaveTextContent('Foo Bar (2)');
  });
});
