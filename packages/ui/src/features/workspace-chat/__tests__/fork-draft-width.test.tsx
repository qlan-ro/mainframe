/**
 * A fork's unsent message at the widths where the split used to lose it: too
 * narrow for two chats, and wide enough only once the workspace made room. Real
 * composers, the real layout store and the real panel; the tab binds its thread
 * as `use-conversation-thread` does.
 */
import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ComposerPrimitive,
  ExternalThread,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { takeStash } from '@/features/chat/runtime/draft-stash';
import { useLayoutStore } from '@/store/layout';
import { DraftKeeper } from '../DraftKeeper';
import { openChatTab } from '../conversation-tabs';

const NO_MESSAGES: ThreadMessage[] = [];

function Fork({ chatId }: { chatId: string }) {
  const aui = useAui();
  const config = useMemo(
    () => AuiConfig({ thread: ExternalThread({ messages: NO_MESSAGES, isRunning: false, onNew: () => undefined }) }),
    [],
  );
  return (
    <AuiProvider extends={aui} config={config}>
      <DraftKeeper chatId={chatId} />
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input aria-label={`Message ${chatId}`} />
      </ComposerPrimitive.Root>
    </AuiProvider>
  );
}

vi.mock('@/features/sessions/new-thread/ChatSurface', () => ({ ChatSurface: () => null }));
vi.mock('@/layout/surfaces/WorkspaceSurface', () => ({
  WorkspaceSurface: () => {
    const tabs = useLayoutStore((s) => s.run)?.panes.flatMap((pane) => pane.tabs) ?? [];
    return tabs.map((tab) => (tab.kind === 'chat' ? <Fork key={tab.id} chatId={tab.chatId!} /> : null));
  },
}));

import { SurfaceHost } from '@/layout/SurfaceHost';

const FORK = { chatId: 'fork', role: 'fork', title: 'Fork' } as const;

function App() {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ messages: NO_MESSAGES, onNew: async () => undefined });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SurfaceHost />
    </AssistantRuntimeProvider>
  );
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>('Message fork');
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const resize = (width: number) =>
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'parent',
  });
});
afterEach(() => {
  cleanup(); // the unmount stashes what was typed
  takeStash('fork');
  vi.unstubAllGlobals();
});

it('NARROW — opens an empty fork and keeps what is typed while the window widens and the panel is resized', () => {
  resize(820);
  render(<App />);
  act(() => void openChatTab(FORK));
  expect(field().value).toBe('');
  type('edited before widening');
  const before = field();

  resize(1600);
  act(() => useLayoutStore.getState().setTopFrac(0.3));
  expect(field()).toBe(before);
  expect(field().value).toBe('edited before widening');
});

it('MID-WIDTH — opens an empty fork beside an open workspace, and keeps its message while the workspace is hidden', async () => {
  resize(1500);
  useLayoutStore.getState().addRunTab({ id: 'c1', kind: 'code', title: 'a.ts', path: 'a.ts' });
  render(<App />);
  act(() => void openChatTab(FORK));
  expect(field().value).toBe('');
  type('not sent yet');

  act(() => useLayoutStore.getState().toggleSurface('workspace'));
  await waitFor(() => expect(screen.queryByLabelText('Message fork')).toBeNull());
  act(() => useLayoutStore.getState().toggleSurface('workspace'));
  await waitFor(() => expect(field().value).toBe('not sent yet'));
});

it('MID-WIDTH — takes no draft meant for another chat', () => {
  render(<App />);
  act(() => void openChatTab(FORK));
  type('for the fork');
  act(() => void openChatTab({ chatId: 'other', role: 'session', title: 'Other' }));
  expect(screen.getByLabelText<HTMLTextAreaElement>('Message other').value).toBe('');
  expect(field().value).toBe('for the fork');
});
