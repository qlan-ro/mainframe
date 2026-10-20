import { createContext, useContext, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const Focus = createContext('one');
const Scope = createContext('one');
vi.mock('@assistant-ui/react', () => ({
  ThreadPrimitive: { Root: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  useAuiState: (select: (state: unknown) => unknown) =>
    select({ threads: { mainThreadId: useContext(Focus) }, threadListItem: { id: useContext(Scope) } }),
}));
vi.mock('../ChatThreadViewport', () => ({ ChatThreadViewport: () => null }));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../messages/compact/transcript-scope', () => ({
  RootTranscriptScope: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => <div data-testid="find-bar">{useContext(Scope)}</div> }));
vi.mock('../../find/DaemonFind', () => ({
  DaemonFind: () => <div data-testid="search-owner">{useContext(Scope)}</div>,
}));
import { ChatThread } from '../ChatThread';

function Split({ focused }: { focused: string }) {
  return (
    <Focus.Provider value={focused}>
      <Scope.Provider value="one">
        <ChatThread />
      </Scope.Provider>
      <Scope.Provider value="two">
        <ChatThread />
        <ChatThread variant="side" />
      </Scope.Provider>
    </Focus.Provider>
  );
}

it('gives search and navigation to only the focused main chat across split focus changes', () => {
  const view = render(<Split focused="one" />);
  expect(view.getAllByTestId('find-bar')).toHaveLength(1);
  expect(view.getByTestId('search-owner').textContent).toBe('one');
  view.rerender(<Split focused="two" />);
  expect(view.getAllByTestId('find-bar')).toHaveLength(1);
  expect(view.getByTestId('search-owner').textContent).toBe('two');
});
