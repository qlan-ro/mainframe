/**
 * A chunk streamed into the last turn must not render the settled turns above
 * it. The model is rebuilt on every chunk, but its cache keeps settled turns and
 * messages identical, and consumers select their own slice.
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';

const { renders } = vi.hoisted(() => ({ renders: { boundary: 0, headers: new Map<string, number>() } }));

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({ listBackgroundTasks: vi.fn().mockResolvedValue([]) }));
// Every assistant message renders through one boundary inside `AssistantSlice`.
vi.mock('../../MessageRenderBoundary', () => ({
  MessageRenderBoundary: ({ children }: { children: ReactNode }) => {
    renders.boundary += 1;
    return <>{children}</>;
  },
}));
vi.mock('../WorkHeader', () => ({
  workId: (key: string) => key,
  WorkHeader: ({ turn }: { turn: { key: string } }) => {
    renders.headers.set(turn.key, (renders.headers.get(turn.key) ?? 0) + 1);
    return <div data-testid="header" />;
  },
}));

import { TurnFixture, assistant, bash, text, user } from './fixtures';

const TURNS = 8;
const CHUNKS = 5;
const settled: ThreadMessage[] = Array.from({ length: TURNS }, (_, i) => [
  user(`Ask ${i}`, `u${i}`),
  assistant([bash(`b${i}`, 'ls'), text(`Answer ${i}`)], `a${i}`),
]).flat();
const tail = (value: string) => [user('Last', 'u-last'), assistant([text(value)], 'tail', { running: true })];
const flush = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));

beforeEach(() => {
  useUiPrefs.setState({ finishedWork: 'fold' });
  renders.boundary = 0;
  renders.headers.clear();
});

it('a streamed chunk renders neither settled slices nor settled work rows', async () => {
  const view = render(<TurnFixture rootId="isolation" messages={[...settled, ...tail('S')]} />);
  await flush();
  expect(screen.getAllByTestId('header')).toHaveLength(TURNS);
  renders.boundary = 0;
  renders.headers.clear();

  for (let i = 1; i <= CHUNKS; i++) {
    view.rerender(<TurnFixture rootId="isolation" messages={[...settled, ...tail(`S${'t'.repeat(i)}`)]} />);
    await flush();
  }

  // The tail's slice renders, and only it (plus dev-mode double-render slack).
  expect(renders.boundary).toBeGreaterThan(0);
  expect(renders.boundary / CHUNKS).toBeLessThanOrEqual(2);
  expect(renders.headers.size).toBe(0);
});
