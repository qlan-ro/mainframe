/**
 * UserMessage — behavior tests for H5 (send-failure visibility), H6
 * (message id + content), T10 (skill chip), and the metadata-dispatch
 * tests for captures / attachments.
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` so `useAuiState` receives a synthetic
 *    MessageState-shaped object we control per test. The selector is called
 *    with `{ message: <fixture> }` and returns whatever the selector picks.
 *  - `MessagePrimitive.Root` is stubbed to a plain `<div>` so the component
 *    tree renders without a full AssistantRuntime.
 *  - `ReadMoreBubble` and `QueuedUserTurn` render their children unchanged.
 *  - Child component `UserAttachments` is mocked to a simple marker div so
 *    these tests verify dispatch (conditional rendering) only — not the
 *    child's internals.
 *  - All assertions are against hardcoded values; no component logic is
 *    recomputed here.
 *
 * Behaviors covered:
 *  H5 — a message whose `metadata.custom.mainframe.error` is set renders
 *        `[data-testid="chat-user-message-send-failed"]` with "Failed to send".
 *  H5 — a normal message (no error) does NOT render that element.
 *  H6 — message id and content are read correctly (renders expected text).
 *  MD — captures array (length > 0) → capture context renders; no crash.
 *  MD — plain message (no captures) → no capture row; UserAttachments always
 *       present.
 *  PB — a clear-context "Implement the following plan:" message renders the
 *       shared PlanBubble instead of the plain cool-card body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Controllable retry spy for the chat-extras seam (hoisted for vi.mock).
const { retryMessageSpy } = vi.hoisted(() => ({ retryMessageSpy: vi.fn() }));
// Mutable queued-refs fixture for the FIFO position/total dispatch tests (7.2).
let __queuedFixture: import('@qlan-ro/mainframe-types').QueuedMessageRef[] = [];
vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ retryMessage: retryMessageSpy }),
  useChatQueuedMessages: () => __queuedFixture,
}));

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

interface SyntheticMainframeMeta {
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
  captures?: Array<{
    label: string;
    imageName: string;
    selector?: string;
    annotation?: string;
  }>;
  attachmentPreviews?: Array<{
    name: string;
    kind: 'image' | 'file';
    sizeBytes?: number;
  }>;
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

// ---------------------------------------------------------------------------
// Mock child components — verify dispatch only, not their internals.
// The test file is in messages/__tests__/, so paths are ../ComponentName.
// ---------------------------------------------------------------------------

vi.mock('../UserAttachments', () => ({
  UserAttachments: () => <div data-testid="chat-user-attachments" />,
}));

// QueuedUserTurn renders for real children + the extrasSlot, so a no-body
// queued send still mounts its attachments/captures. position/total render
// as data attributes so the FIFO dispatch tests (7.2) can assert on them.
vi.mock('../QueuedUserTurn', () => ({
  QueuedUserTurn: ({
    children,
    extrasSlot,
    position,
    total,
  }: {
    children?: React.ReactNode;
    extrasSlot?: React.ReactNode;
    position?: number;
    total?: number;
  }) => (
    <div data-testid="chat-queued-message" data-position={position} data-total={total}>
      {children}
      {extrasSlot}
    </div>
  ),
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

  it('renders a Retry button on send failure that calls retryMessage with the clientId', () => {
    __messageFixture = makeFixture({
      mainframe: { pending: true, clientId: 'c-1', error: 'Network timeout' },
    });
    renderUserMessage();
    fireEvent.click(screen.getByTestId('chat-user-message-retry'));
    expect(retryMessageSpy).toHaveBeenCalledWith('c-1');
  });

  it('does NOT render a Retry button for a normal (non-error) message', () => {
    __messageFixture = makeFixture({ mainframe: undefined });
    renderUserMessage();
    expect(screen.queryByTestId('chat-user-message-retry')).not.toBeInTheDocument();
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

  it('carries a 16px bottom margin to the next message (7.7 — pb-6)', () => {
    __messageFixture = makeFixture();
    renderUserMessage();
    expect(screen.getByTestId('chat-user-message').className).toContain('pb-6');
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
// Tests — MT: @mention renders as plain accent text, no boxed chip (7.1)
// ---------------------------------------------------------------------------

describe('UserMessage — MT: @mention renders as plain text, not a chip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the @mention token with no directive-text-chip wrapper', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'see @Layout.tsx here' }],
    });
    renderUserMessage();
    const mention = screen.getByText('@Layout.tsx');
    expect(mention.closest('[data-slot="directive-text-chip"]')).toBeNull();
  });

  it('applies the accent + semibold classes to the plain @mention span', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'see @Layout.tsx here' }],
    });
    renderUserMessage();
    const mention = screen.getByText('@Layout.tsx');
    expect(mention.className).toContain('text-primary');
    expect(mention.className).toContain('font-semibold');
  });
});

// ---------------------------------------------------------------------------
// Tests — SP: SlashPill spacing matches the design (7.5)
// ---------------------------------------------------------------------------

describe('UserMessage — SP: SlashPill spacing (mr-4, gap-[5px], pr-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __skillsFixture = [];
  });

  it('renders the pill wrapper with mr-4 (8px), gap-[5px], pl-1.5 (6px), pr-4 (8px)', () => {
    __messageFixture = makeFixture({
      mainframe: { command: { name: 'debug', source: 'commands', userText: 'run this' } },
    });
    renderUserMessage();
    const pillLabel = screen.getByText('/debug');
    const pill = pillLabel.closest('span')?.parentElement;
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain('mr-4');
    expect(pill!.className).toContain('gap-[5px]');
    expect(pill!.className).toContain('pl-1.5');
    expect(pill!.className).toContain('pr-4');
  });

  // 7.12: command pill uses the purpose-built ~8% accent tint token, mirroring
  // the skill pill's own dedicated `bg-mf-directive-skill-tint` treatment,
  // instead of reusing the coarser text-selection `bg-mf-selection` token.
  it('uses the bg-mf-directive-command-tint token for the command pill background', () => {
    __messageFixture = makeFixture({
      mainframe: { command: { name: 'debug', source: 'commands', userText: 'run this' } },
    });
    renderUserMessage();
    const pillLabel = screen.getByText('/debug');
    const pill = pillLabel.closest('span')?.parentElement;
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain('bg-mf-directive-command-tint');
    expect(pill!.className).not.toContain('bg-mf-selection');
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

// ---------------------------------------------------------------------------
// Tests — MD: metadata-driven child dispatch
// ---------------------------------------------------------------------------

describe('UserMessage — MD: metadata-driven child dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __skillsFixture = [];
    __queuedFixture = [];
  });

  it('renders the bubble text of a capture message (captures themselves ride the attachment row)', () => {
    // Captures now project into message.attachments + render via UserAttachments
    // (mocked here to a marker); the bubble carries only the rest text.
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'fix it' }],
      mainframe: {
        captures: [{ label: 'element1', imageName: 'element1.png', selector: '.x' }],
      },
    });
    renderUserMessage();
    expect(screen.getByText('fix it')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-attachments')).toBeInTheDocument();
  });

  it('renders a capture message with no bubble text without crashing', () => {
    __messageFixture = makeFixture({
      content: [],
      mainframe: {
        captures: [{ label: 'element1', imageName: 'element1.png' }],
      },
    });
    renderUserMessage();
    expect(screen.getByTestId('chat-user-attachments')).toBeInTheDocument();
  });

  it('renders neither CaptureContextRow nor capture-row for a plain message, but always renders UserAttachments', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'hello' }],
      mainframe: undefined,
    });
    renderUserMessage();
    expect(screen.queryByTestId('chat-user-capture-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-user-attachments')).toBeInTheDocument();
  });

  it('mounts the queued shell + extras for an image-only queued send (no text body)', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }],
      mainframe: { queued: true },
    });
    renderUserMessage();
    // The queued shell renders even with no text body, and the extras
    // (UserAttachments) mount inside its slot — the codex-flagged edge.
    expect(screen.getByTestId('chat-queued-message')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-attachments')).toBeInTheDocument();
  });

  it('renders nothing-bearing queued message as empty (no body, no extras → no shell)', () => {
    __messageFixture = makeFixture({
      content: [],
      mainframe: { queued: true },
    });
    renderUserMessage();
    expect(screen.queryByTestId('chat-queued-message')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // FIFO position/total dispatch (7.2) — sourced from useChatQueuedMessages()
  // -------------------------------------------------------------------------

  it('passes position=1, total=1 to QueuedUserTurn when the queue holds only this message', () => {
    __messageFixture = makeFixture({
      id: 'm1',
      content: [{ type: 'text', text: 'go' }],
      mainframe: { queued: true },
    });
    __queuedFixture = [{ messageId: 'm1', chatId: 'c1', uuid: 'u1', content: 'go', timestamp: '2026-07-02T10:00:00.000Z' }];
    renderUserMessage();
    const shell = screen.getByTestId('chat-queued-message');
    expect(shell).toHaveAttribute('data-position', '1');
    expect(shell).toHaveAttribute('data-total', '1');
  });

  it('passes position=2, total=3 to QueuedUserTurn for the second-earliest of three queued messages', () => {
    __messageFixture = makeFixture({
      id: 'm2',
      content: [{ type: 'text', text: 'second' }],
      mainframe: { queued: true },
    });
    __queuedFixture = [
      { messageId: 'm1', chatId: 'c1', uuid: 'u1', content: 'first', timestamp: '2026-07-02T10:00:00.000Z' },
      { messageId: 'm2', chatId: 'c1', uuid: 'u2', content: 'second', timestamp: '2026-07-02T10:00:01.000Z' },
      { messageId: 'm3', chatId: 'c1', uuid: 'u3', content: 'third', timestamp: '2026-07-02T10:00:02.000Z' },
    ];
    renderUserMessage();
    const shell = screen.getByTestId('chat-queued-message');
    expect(shell).toHaveAttribute('data-position', '2');
    expect(shell).toHaveAttribute('data-total', '3');
  });
});

describe('UserMessage — find DOM hook', () => {
  it('sets data-message-id on the message root', () => {
    __messageFixture = makeFixture({ mainframe: undefined });
    renderUserMessage();
    expect(screen.getByTestId('chat-user-message')).toHaveAttribute('data-message-id', 'msg-test');
  });
});

// ---------------------------------------------------------------------------
// Tests — PB: clear-context plan message renders the shared PlanBubble
// ---------------------------------------------------------------------------

describe('UserMessage — PB: clear-context plan message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __skillsFixture = [];
  });

  it('renders the PlanBubble for a plan-prefixed message', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'Implement the following plan:\n\n# Dummy Plan\nSome body' }],
      mainframe: undefined,
    });
    renderUserMessage();
    expect(screen.getByTestId('chat-plan-bubble')).toBeInTheDocument();
    expect(screen.getByText('Implementing plan')).toBeInTheDocument();
    expect(screen.getByText('Dummy Plan')).toBeInTheDocument();
  });

  it('does not render the plain cool-card body for a plan-prefixed message', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'Implement the following plan:\n\n# Dummy Plan\nSome body' }],
      mainframe: undefined,
    });
    renderUserMessage();
    expect(screen.queryByText('Implement the following plan:')).not.toBeInTheDocument();
  });

  it('renders the plain cool-card body (not the PlanBubble) for a normal message', () => {
    __messageFixture = makeFixture({
      content: [{ type: 'text', text: 'Just a regular message' }],
      mainframe: undefined,
    });
    renderUserMessage();
    expect(screen.getByText('Just a regular message')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-plan-bubble')).not.toBeInTheDocument();
  });
});
