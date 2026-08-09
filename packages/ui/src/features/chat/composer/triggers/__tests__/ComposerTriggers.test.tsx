/**
 * ComposerTriggers — real assistant-ui integration tests.
 *
 * Unlike Composer.test.tsx (which stubs `@assistant-ui/react` entirely), these
 * tests mount the REAL `Unstable_TriggerPopover` machinery against a real
 * `useExternalStoreRuntime`, because both bugs under test are about the
 * library's actual open/close + text-insertion behavior, not our own pure
 * logic (which is already covered by directive-formatter.test.ts /
 * mention-adapter.test.ts).
 *
 * Only our own hooks are mocked: useChatExtras, useDraftConfig, useChatSkills/
 * useChatAgents, and the `@/lib/api/files` REST wrappers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssistantRuntimeProvider, ComposerPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessage } from '@assistant-ui/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({
    port: 31415,
    state: { chatId: 'chat-1', chatConfig: { projectId: 'proj-1', adapterId: 'claude' } },
  }),
}));

vi.mock('@/features/sessions/runtime/draft-config', () => ({
  useDraftConfig: () => undefined,
}));

let __skills: { name: string; displayName: string; description: string; invocationName?: string }[] = [];
vi.mock('@/features/skills/use-chat-skills', () => ({
  useChatSkills: () => ({ skills: __skills, agents: [], loading: false }),
  useChatAgents: () => [],
}));

const getFileTreeMock = vi.fn();
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn().mockResolvedValue([]),
  getFileTree: (...args: unknown[]) => getFileTreeMock(...args),
  browseFilesystem: vi.fn().mockResolvedValue([]),
}));

let __sessionItems: { id: string; type: string; label: string }[] = [];
let __sessionPaths = new Map<string, string>();
const refreshSessionsMock = vi.fn();
vi.mock('../../sessions/use-session-mention-source', () => ({
  useSessionMentionSource: () => ({
    items: __sessionItems,
    pathByChatId: __sessionPaths,
    refresh: refreshSessionsMock,
  }),
}));

import { ComposerTriggers } from '../ComposerTriggers';
import { useSessionReferences } from '../../sessions/session-reference-store';

// ---------------------------------------------------------------------------
// Harness — a real external-store runtime + real trigger popovers.
// ---------------------------------------------------------------------------

function Harness() {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerPrimitive.Root>
        <ComposerTriggers>
          <ComposerPrimitive.Input data-testid="composer-input" />
        </ComposerTriggers>
      </ComposerPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function typeInto(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
}

// ---------------------------------------------------------------------------
// Bug 1 — trigger popover must close after picking a skill or a file.
// ---------------------------------------------------------------------------

describe('ComposerTriggers — popover closes after picking a skill', () => {
  beforeEach(() => {
    __skills = [{ name: 'my-skill', displayName: 'My Skill', description: 'desc', invocationName: 'my-skill' }];
    getFileTreeMock.mockReset().mockResolvedValue([]);
  });

  it('closes composer-trigger-popover after clicking a skill item', async () => {
    render(<Harness />);
    const input = screen.getByTestId('composer-input');

    typeInto(input, '/');
    expect(await screen.findByTestId('composer-skill-item-my-skill')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('composer-skill-item-my-skill'));

    await waitFor(() => {
      expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument();
    });
  });

  it('inserts the literal skill text with exactly one trailing space', async () => {
    render(<Harness />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;

    typeInto(input, '/');
    fireEvent.click(await screen.findByTestId('composer-skill-item-my-skill'));

    await waitFor(() => {
      expect(input.value).toBe('/my-skill ');
    });
  });
});

// ---------------------------------------------------------------------------
// The list is an overlay now, so the composer counts as "outside" to Radix's
// dismiss layer. The anchor guard is what keeps a caret click from closing it.
// ---------------------------------------------------------------------------

describe('ComposerTriggers — a caret press in the composer does not dismiss the list', () => {
  beforeEach(() => {
    __skills = [{ name: 'my-skill', displayName: 'My Skill', description: 'desc', invocationName: 'my-skill' }];
    getFileTreeMock.mockReset().mockResolvedValue([]);
  });

  it('keeps the popover open when the composer input is pressed', async () => {
    render(<Harness />);
    const input = screen.getByTestId('composer-input');

    typeInto(input, '/');
    expect(await screen.findByTestId('composer-trigger-popover')).toBeInTheDocument();
    expect(input.closest('[data-slot="popover-anchor"]')).not.toBeNull();

    fireEvent.pointerDown(input);

    expect(screen.getByTestId('composer-trigger-popover')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — directory pick must keep the token open with NO trailing space.
// ---------------------------------------------------------------------------

describe('ComposerTriggers — directory pick keeps the @ token open, no trailing space', () => {
  beforeEach(() => {
    __skills = [];
    getFileTreeMock.mockReset().mockResolvedValue([{ name: 'sub', path: 'x/sub', type: 'directory' }]);
  });

  it('keeps the popover open and drops the trailing space after a directory pick', async () => {
    render(<Harness />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;

    typeInto(input, '@x/');
    fireEvent.click(await screen.findByTestId('composer-file-item-x/sub'));

    await waitFor(() => {
      expect(input.value).toBe('@x/sub/');
    });
    expect(screen.getByTestId('composer-trigger-popover')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Session mentions (#240) — the row inserts a `@session[label]` token and binds
// that label to the session's transcript path for the send composition.
// ---------------------------------------------------------------------------

describe('ComposerTriggers — session mention rows', () => {
  beforeEach(() => {
    __skills = [];
    getFileTreeMock.mockReset().mockResolvedValue([]);
    refreshSessionsMock.mockReset();
    __sessionItems = [{ id: 'chat-2', type: 'session', label: 'Foo refactor' }];
    __sessionPaths = new Map([['chat-2', '/tmp/transcripts/chat-2.jsonl']]);
    useSessionReferences.setState({ byThread: {} });
  });

  it('lists a session row under its chat-id test id and refreshes on open', async () => {
    render(<Harness />);
    typeInto(screen.getByTestId('composer-input'), '@');

    expect(await screen.findByTestId('composer-mention-session-chat-2')).toHaveTextContent('Foo refactor');
    await waitFor(() => expect(refreshSessionsMock).toHaveBeenCalled());
  });

  it('inserts the bare @label mention and records label → transcript path', async () => {
    render(<Harness />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;

    typeInto(input, '@');
    fireEvent.click(await screen.findByTestId('composer-mention-session-chat-2'));

    // The draft spelling — submit rewrites it to `@session[Foo refactor]`.
    await waitFor(() => {
      expect(input.value).toBe('@Foo refactor ');
    });
    const recorded = Object.values(useSessionReferences.getState().byThread);
    expect(recorded).toContainEqual({ 'Foo refactor': '/tmp/transcripts/chat-2.jsonl' });
  });
});
