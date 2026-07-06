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

import { ComposerTriggers } from '../ComposerTriggers';

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
