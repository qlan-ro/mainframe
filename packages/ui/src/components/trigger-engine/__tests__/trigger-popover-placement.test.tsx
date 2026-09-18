/**
 * Red-phase placement contract (todo #304): the suggestion list must not be a
 * DOM descendant of the field it serves. The automations field renders it
 * inside `ThreadPrimitive`-free layout, but the composer mounts it inside the
 * thread's sticky `ViewportFooter`, whose measured height is the thread's
 * scroll inset — an in-flow popover there grows the composer and shoves
 * thread content upward on every open/close and every change in result
 * count. Asserting DOM containment (rather than a class name or `position`
 * value) pins the fix at the level that actually causes the bug: an overlay
 * portalled outside the field's own subtree cannot contribute layout height
 * to it, no matter what CSS it carries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssistantRuntimeProvider, ComposerPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { TokenDescriptor } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Automations-consumer mocks — mirrors TriggerTextField.test.tsx.
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/projects', () => ({ getProjects: vi.fn() }));
vi.mock('@/lib/api/skills', () => ({ getSkills: vi.fn() }));
vi.mock('@/lib/api/files', () => ({
  searchFiles: vi.fn(async () => []),
  getFileTree: vi.fn(async () => []),
  browseFilesystem: vi.fn(async () => []),
}));

import { resetAdapters } from '@/store/adapters';
import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { TriggerTextField, type TriggerTextFieldProps } from '@/features/automations/fields/TriggerTextField';

const SCOPE: TokenDescriptor[] = [
  {
    ref: { stepId: 'trigger', output: 'result' },
    label: 'Result',
    type: 'text',
    sourceKind: 'trigger',
    source: 'Trigger',
  },
];

function AutomationsField(props: Partial<TriggerTextFieldProps> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '');
  return <TriggerTextField value={value} onChange={setValue} testId="notify-message" scope={SCOPE} {...props} />;
}

// ---------------------------------------------------------------------------
// Composer-consumer mocks — duplicated from ComposerTriggers.test.tsx rather
// than shared, so this file stays free of any file Group 2 edits.
// ---------------------------------------------------------------------------

vi.mock('@/features/chat/runtime/chat-extras', () => ({
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
  useChatSkills: () => ({ skills: __skills, agents: [], commands: [], loading: false }),
  useChatAgents: () => [],
}));

vi.mock('@/features/chat/composer/sessions/use-session-mention-source', () => ({
  useSessionMentionSource: () => ({ items: [], pathByChatId: new Map(), refresh: vi.fn() }),
}));

import { ComposerTriggers } from '@/features/chat/composer/triggers/ComposerTriggers';

function ComposerHarness() {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: false,
    messages: [],
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerPrimitive.Root data-testid="composer-root">
        <ComposerTriggers>
          <ComposerPrimitive.Input data-testid="composer-input" />
        </ComposerTriggers>
      </ComposerPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAdapters();
  useAutomationsStore.setState({ scopeProjectId: null });
  __skills = [{ name: 'my-skill', displayName: 'My Skill', description: 'desc', invocationName: 'my-skill' }];
});

describe('suggestion list placement — not a DOM descendant of the field', () => {
  it('the automations field popover is not a descendant of its container', async () => {
    render(<AutomationsField />);
    const textarea = screen.getByTestId('notify-message');
    fireEvent.change(textarea, { target: { value: '$', selectionStart: 1, selectionEnd: 1 } });

    const popover = await screen.findByTestId('notify-message-trigger-popover');
    const container = screen.getByTestId('notify-message-container');
    expect(container.contains(popover)).toBe(false);
  });

  it('the composer popover is not a descendant of the composer root', async () => {
    render(<ComposerHarness />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });

    const popover = await screen.findByTestId('composer-trigger-popover');
    expect(screen.getByTestId('composer-root').contains(popover)).toBe(false);
  });
});
