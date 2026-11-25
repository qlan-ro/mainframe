/** ChatThread hands its own chat's composer to everything in it, whichever chat the column shows. */
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    thread: { composer: () => ({ name: 'own' }) },
    threads: { thread: () => ({ composer: () => ({ name: 'column' }) }) },
  }),
  useAuiState: () => false,
  ThreadPrimitive: { Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}));
vi.mock('../ChatThreadViewport', async () => {
  const { useThreadComposer } = await import('../../composer/thread-composer');
  return {
    ChatThreadViewport: () => {
      const composer = useThreadComposer();
      return <output>{(composer() as unknown as { name: string }).name}</output>;
    },
  };
});
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../find/DaemonFind', () => ({ DaemonFind: () => null }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../messages/compact/transcript-scope', () => ({
  RootTranscriptScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../tools/register-cards', () => ({}));

import { ChatThread } from '../ChatThread';

it('provides its own', () => {
  render(<ChatThread />);
  expect(screen.getByRole('status')).toHaveTextContent('own');
});
