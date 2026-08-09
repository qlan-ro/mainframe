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
import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssistantRuntimeProvider, ComposerPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessage } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';

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
import { ComposerAddMention } from '../../attachments/ComposerAttachmentStrip';
import { useSessionReferences } from '../../sessions/session-reference-store';
import { useTriggerFieldAria } from '../trigger-field-aria-context';

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

/**
 * Harness for the add-mention BUTTON (todo #316), not typed input: the same
 * `ComposerPrimitive.Root` form and trigger wiring as `Harness`, plus a real
 * `textareaRef` shared between `ComposerPrimitive.Input` and
 * `ComposerAddMention` — the seam the button's click handler must drive — and
 * an `onNew` spy to prove a click never reaches the runtime as a submit.
 *
 * `Root` nests INSIDE `ComposerTriggers` the way Composer.tsx nests it: the
 * popover anchors onto its single child, so the input and the button have to
 * reach it as one element.
 */
function ButtonHarness({ onNew }: { onNew: () => Promise<void> }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew,
  });
  return (
    <TooltipProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerTriggers textareaRef={textareaRef}>
          <ComposerPrimitive.Root>
            <ComposerPrimitive.Input ref={textareaRef} data-testid="composer-input" />
            <ComposerAddMention textareaRef={textareaRef} />
          </ComposerPrimitive.Root>
        </ComposerTriggers>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}

/**
 * Mirrors Composer.tsx's own wiring: read the field's combobox ARIA off
 * `useTriggerFieldAria()` and spread it onto `ComposerPrimitive.Input`, the
 * same context consumption Composer.tsx does deep inside the `children` tree
 * `ComposerTriggers` wraps.
 */
function AriaInput() {
  const aria = useTriggerFieldAria();
  return <ComposerPrimitive.Input data-testid="composer-input" {...aria} />;
}

function HarnessWithAria() {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerPrimitive.Root>
        <ComposerTriggers>
          <AriaInput />
        </ComposerTriggers>
      </ComposerPrimitive.Root>
    </AssistantRuntimeProvider>
  );
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

// ---------------------------------------------------------------------------
// Add-mention BUTTON (todo #316) — clicking it must open the same picker
// typing "@" does, and must never submit the composer. Every describe block
// above (typing "@" by hand) is left untouched and must keep passing: it is
// the "typing still works" guard for this fix.
// ---------------------------------------------------------------------------

describe('ComposerAddMention — click opens the picker without submitting (todo #316)', () => {
  beforeEach(() => {
    __skills = [];
    getFileTreeMock.mockReset().mockResolvedValue([]);
    refreshSessionsMock.mockReset();
    __sessionItems = [{ id: 'chat-2', type: 'session', label: 'Foo refactor' }];
    __sessionPaths = new Map([['chat-2', '/tmp/transcripts/chat-2.jsonl']]);
    useSessionReferences.setState({ byThread: {} });
  });

  it('opens the picker with entries, focuses the textarea, and never submits, on an empty draft', async () => {
    const onNew = vi.fn(async () => {});
    render(<ButtonHarness onNew={onNew} />);

    fireEvent.click(screen.getByTestId('composer-add-mention'));

    expect(await screen.findByTestId('composer-trigger-popover')).toBeInTheDocument();
    expect(await screen.findByTestId('composer-mention-session-chat-2')).toBeInTheDocument();
    expect(onNew).not.toHaveBeenCalled();

    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    expect(input.value).toBe('@');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
  });

  it('appends "@" with a leading space on a pre-typed draft and still opens the picker', async () => {
    const onNew = vi.fn(async () => {});
    render(<ButtonHarness onNew={onNew} />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    typeInto(input, 'hello');

    fireEvent.click(screen.getByTestId('composer-add-mention'));

    await waitFor(() => expect(input.value).toBe('hello @'));
    expect(screen.getByTestId('composer-trigger-popover')).toBeInTheDocument();
    expect(input.selectionStart).toBe(7);
    expect(onNew).not.toHaveBeenCalled();
  });

  it('Escape closes the popover, leaves the draft and caret intact, and still never submits', async () => {
    const onNew = vi.fn(async () => {});
    render(<ButtonHarness onNew={onNew} />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;

    fireEvent.click(screen.getByTestId('composer-add-mention'));
    await screen.findByTestId('composer-trigger-popover');

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('composer-trigger-popover')).not.toBeInTheDocument());
    expect(input.value).toBe('@');
    expect(input.selectionStart).toBe(1);
    expect(onNew).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The combobox ARIA relationship (S8) — the input carries role/aria-expanded/
// aria-controls/aria-activedescendant, and aria-controls resolves to the
// portalled listbox even though it's outside the input's own DOM subtree.
// ---------------------------------------------------------------------------

describe('ComposerTriggers — combobox ARIA reaches the composer input', () => {
  beforeEach(() => {
    __skills = [{ name: 'my-skill', displayName: 'My Skill', description: 'desc', invocationName: 'my-skill' }];
    getFileTreeMock.mockReset().mockResolvedValue([]);
  });

  it('is a collapsed combobox before any trigger is typed', () => {
    render(<HarnessWithAria />);
    const input = screen.getByTestId('composer-input');

    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('points aria-controls at the portalled listbox and aria-activedescendant at the highlighted row', async () => {
    render(<HarnessWithAria />);
    const input = screen.getByTestId('composer-input');

    typeInto(input, '/');
    const item = await screen.findByTestId('composer-skill-item-my-skill');

    expect(input).toHaveAttribute('aria-expanded', 'true');
    const controlsId = input.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();

    const listbox = screen.getByRole('listbox');
    expect(listbox.id).toBe(controlsId);
    expect(input.getAttribute('aria-activedescendant')).toBe(item.id);
  });
});
