/** ⌘\\ — closing the chat tab in front must not strand a keyboard that was in it. */
import type { AssistantClient } from '@assistant-ui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';
import { useLayoutStore } from '@/store/layout';
import type { RunTab } from '@/store/run-pane';
import { useConversationShortcuts } from '../use-conversation-shortcuts';

const chat = (id: string): RunTab => ({ id: `chat-${id}`, kind: 'chat', title: id, chatId: id, role: 'fork' });
const file: RunTab = { id: 'c1', kind: 'code', title: 'a.ts', path: 'a.ts' };

/** The window's landmarks, as the app marks them. */
function App() {
  useShortcutDispatcher();
  useConversationShortcuts({} as AssistantClient);
  const { layout, run } = useLayoutStore();
  return (
    <>
      <button type="button" data-tut="workspace">
        Workspace
      </button>
      <div role="tablist" aria-label="Workspace tabs">
        {run?.panes.map((pane) =>
          pane.tabs.map((t) => (
            <div key={t.id} role="tab" tabIndex={0} aria-selected={t.id === pane.active}>
              {t.title}
            </div>
          )),
        )}
      </div>
      {layout.top.includes('chat') && <textarea data-mf-composer-input="" aria-label="column" />}
      {run?.panes.map((pane) =>
        pane.tabs
          .filter((t) => t.kind === 'chat')
          .map((t) => (
            <div key={t.id} data-conversation-tab={t.id === pane.active ? 'active' : 'hidden'}>
              <button type="button">{`Open ${t.chatId}`}</button>
              <textarea data-mf-composer-input="" aria-label={t.chatId} />
            </div>
          )),
      )}
    </>
  );
}

function show(top: ('chat' | 'workspace')[], tabs: RunTab[]) {
  useLayoutStore.setState({
    activeSessionId: 'main',
    layout: { top, topFlex: {} },
    run: { dir: 'v', flex: [1], panes: [{ id: 'p', tabs, active: tabs[tabs.length - 1]!.id }] },
  });
  render(<App />);
}
const close = () =>
  act(() => void fireEvent.keyDown(document.activeElement!, { code: 'Backslash', key: '\\', metaKey: true }));

beforeEach(() => useLayoutStore.setState({ sessions: new Map() }));
afterEach(() => vi.restoreAllMocks());

it.each(['composer', 'button'])('goes from its %s to the conversation’s composer', (from) => {
  show(['chat', 'workspace'], [chat('fork')]);
  (from === 'composer' ? screen.getByLabelText('fork') : screen.getByText('Open fork')).focus();
  close();
  expect(useLayoutStore.getState().run).toBeNull();
  expect(screen.getByLabelText('column')).toHaveFocus();
});

it('goes to the composer of the chat tab that comes in front', () => {
  show(['chat', 'workspace'], [chat('task'), chat('fork')]);
  screen.getByLabelText('fork').focus();
  close();
  expect(screen.getByLabelText('task')).toHaveFocus();
});

it('goes to the tab that comes in front when no chat is on screen', () => {
  show(['workspace'], [file, chat('fork')]);
  screen.getByLabelText('fork').focus();
  close();
  expect(screen.getByRole('tab', { name: 'a.ts' })).toHaveFocus();
});

it('leaves the keyboard alone when it was elsewhere', () => {
  show(['chat', 'workspace'], [file, chat('fork')]);
  screen.getByText('Workspace').focus();
  close();
  expect(screen.getByText('Workspace')).toHaveFocus();
});
