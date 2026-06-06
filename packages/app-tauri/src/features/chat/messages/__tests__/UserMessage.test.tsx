/**
 * UserMessage — behavior tests for H5 (send-failure visibility) and H6
 * (sound message hook path).
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` so `useAuiState` receives a synthetic
 *    MessageState-shaped object we control per test. The selector is called
 *    with `{ message: <fixture> }` and returns whatever the selector picks.
 *  - `MessagePrimitive.Root` is stubbed to a plain `<div>` so the component
 *    tree renders without a full AssistantRuntime.
 *  - `ReadMoreBubble` and `QueuedUserTurn` render their children unchanged.
 *  - All assertions are against hardcoded values; no component logic is
 *    recomputed here.
 *
 * Behaviors covered:
 *  H5 — a message whose `metadata.custom.mainframe.error` is set renders
 *        `[data-testid="chat-user-message-send-failed"]` with "Failed to send".
 *  H5 — a normal message (no error) does NOT render that element.
 *  H6 — message id and content are read correctly (renders expected text).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

// `useAuiState` in UserMessage is called with three different selectors for
// the same render:
//   1. useMainframeMeta:    (s) => s.message.metadata?.custom?.mainframe ?? {}
//   2. messageId:           (s) => s.message.id
//   3. rawText:             (s) => first text-part text or ''
//   4. content (images):    (s) => s.message.content
//
// We store a mutable `__messageFixture` so each test can set its own shape
// before rendering.

interface SyntheticMessageState {
  id: string;
  content: Array<{ type: string; text?: string; image?: string }>;
  metadata: {
    custom: {
      mainframe?: {
        pending?: boolean;
        clientId?: string;
        error?: string;
        queued?: boolean;
        cleanText?: string;
        command?: {
          name: string;
          userText?: string;
          source?: 'commands' | (string & {});
        };
      };
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

// ---------------------------------------------------------------------------
// Mock @/features/skills/use-chat-skills
// ---------------------------------------------------------------------------

// Mutable so tests can swap skills per scenario.
let __skillsFixture: import('@qlan-ro/mainframe-types').Skill[] = [];

vi.mock('@/features/skills/use-chat-skills', async (importActual) => {
  // Keep resolveSkillName from the real implementation (it's pure).
  const actual = await importActual<typeof import('@/features/skills/use-chat-skills')>();
  return {
    ...actual,
    useChatSkills: () => ({ skills: __skillsFixture, loading: false }),
  };
});

// ReadMoreBubble and QueuedUserTurn don't need mocking — they render children.

import { UserMessage } from '../UserMessage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderUserMessage() {
  return render(<UserMessage />);
}

function makeFixture(
  overrides: Partial<SyntheticMessageState> & {
    mainframe?: SyntheticMessageState['metadata']['custom']['mainframe'];
  } = {},
): SyntheticMessageState {
  const { mainframe, ...rest } = overrides;
  return {
    id: 'msg-test',
    content: [{ type: 'text', text: 'Hello' }],
    metadata: { custom: { mainframe } },
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Tests — H5: send failure visibility
// ---------------------------------------------------------------------------

describe('UserMessage — H5: send failure state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the send-failed indicator when meta.error is set', () => {
    __messageFixture = makeFixture({
      mainframe: { pending: true, clientId: 'c-1', error: 'Network timeout' },
    });
    renderUserMessage();
    expect(screen.getByTestId('chat-user-message-send-failed')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-message-send-failed')).toHaveTextContent('Failed to send');
  });

  it('does NOT render the send-failed indicator for a normal (non-error) message', () => {
    __messageFixture = makeFixture({ mainframe: undefined });
    renderUserMessage();
    expect(screen.queryByTestId('chat-user-message-send-failed')).not.toBeInTheDocument();
  });

  it('does NOT render the send-failed indicator when meta.pending is true but no error', () => {
    __messageFixture = makeFixture({ mainframe: { pending: true, clientId: 'c-2' } });
    renderUserMessage();
    expect(screen.queryByTestId('chat-user-message-send-failed')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — H6: id and content read correctly via the typed path
// ---------------------------------------------------------------------------

describe('UserMessage — H6: message id and content rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the message text content', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'Check this out' }],
    });
    renderUserMessage();
    expect(screen.getByText('Check this out')).toBeInTheDocument();
  });

  it('renders the root element with data-testid="chat-user-message"', () => {
    __messageFixture = makeFixture();
    renderUserMessage();
    expect(screen.getByTestId('chat-user-message')).toBeInTheDocument();
  });

  it('renders cleanText from metadata when present, ignoring raw text', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'raw text here' }],
      mainframe: { cleanText: 'cleaned text here' },
    });
    renderUserMessage();
    // cleanText takes priority over the raw content part
    expect(screen.getByText('cleaned text here')).toBeInTheDocument();
    expect(screen.queryByText('raw text here')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — T10: skill chip name resolution
// ---------------------------------------------------------------------------

describe('UserMessage — T10: skill chip name resolution', () => {
  const SKILL_FIXTURE: import('@qlan-ro/mainframe-types').Skill = {
    id: 'skill-1',
    adapterId: 'claude',
    name: 'my-skill',
    displayName: 'My Skill',
    invocationName: 'plugin:my-skill',
    description: 'A test skill',
    scope: 'plugin',
    filePath: '/path/to/my-skill.md',
    content: '# My Skill',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves skill chip to invocationName when skills are loaded', () => {
    // resolveSkillName('my-skill', [SKILL_FIXTURE]):
    //   exact match via s.name === 'my-skill' → returns s.invocationName = 'plugin:my-skill'
    __skillsFixture = [SKILL_FIXTURE];
    __messageFixture = makeFixture({
      mainframe: {
        command: { name: 'my-skill', source: 'skills', userText: 'do the thing' },
      },
    });
    renderUserMessage();
    // The SlashPill renders "/<name>" so expect "/plugin:my-skill" in the DOM.
    expect(screen.getByText('/plugin:my-skill')).toBeInTheDocument();
  });

  it('falls back to raw name when skills list is empty', () => {
    __skillsFixture = [];
    __messageFixture = makeFixture({
      mainframe: {
        command: { name: 'my-skill', source: 'skills', userText: 'do the thing' },
      },
    });
    renderUserMessage();
    // resolveSkillName('my-skill', []) → 'my-skill' (no match, returns raw name)
    expect(screen.getByText('/my-skill')).toBeInTheDocument();
  });

  it('keeps raw name for custom commands (source === commands), no resolution', () => {
    __skillsFixture = [SKILL_FIXTURE];
    __messageFixture = makeFixture({
      mainframe: {
        command: { name: 'my-skill', source: 'commands', userText: 'do the thing' },
      },
    });
    renderUserMessage();
    // Custom commands skip resolveSkillName — the raw name is used as-is.
    expect(screen.getByText('/my-skill')).toBeInTheDocument();
  });
});
