// @vitest-environment jsdom

/**
 * Compact transcript render isolation: streaming a chunk into the tail turn
 * must not re-render the settled turns above it. The turn model is rebuilt on
 * every chunk, but its cache keeps settled turns and messages identical, and
 * consumers select their own slice — so neither the settled messages' slices
 * nor their turn disclosures render again.
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';

const { renders } = vi.hoisted(() => ({ renders: { boundary: 0, disclosure: new Map<string, number>() } }));

// Every assistant message renders through one boundary inside `AssistantSlice`.
vi.mock('../../MessageRenderBoundary', () => ({
  MessageRenderBoundary: ({ children }: { children: ReactNode }) => {
    renders.boundary += 1;
    return <>{children}</>;
  },
}));

// Rendered once per `CompactTurnDisclosure` render, keyed by its turn.
vi.mock('../CompactTurnElapsed', () => ({
  CompactTurnElapsed: ({ turn }: { turn: { key: string } }) => {
    renders.disclosure.set(turn.key, (renders.disclosure.get(turn.key) ?? 0) + 1);
    return <>Work details</>;
  },
}));

import { TurnFixture, turnMessage } from './turn-fixtures';

const TURNS = 8;
const CHUNKS = 5;

function settledTurns(): ThreadMessage[] {
  return Array.from({ length: TURNS }, (_, i) => [
    turnMessage(`work-${i}`, `Work ${i}`, { turnId: `turn-${i}` }),
    turnMessage(`final-${i}`, `Answer ${i}`, { turnId: `turn-${i}`, phase: 'final_answer', finalEligible: true }),
  ]).flat();
}

const tail = (text: string) =>
  turnMessage('tail', text, { turnId: 'turn-tail', phase: 'final_answer', finalEligible: true, state: 'running' });

const flush = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));

beforeEach(() => {
  useUiPrefs.getState().setTranscriptMode('compact');
  renders.boundary = 0;
  renders.disclosure.clear();
});

describe('compact transcript render isolation', () => {
  it('a streamed chunk re-renders neither settled slices nor settled turn disclosures', async () => {
    const settled = settledTurns();
    const view = render(<TurnFixture rootId="isolation" messages={[...settled, tail('S')]} />);
    await flush();
    expect(screen.getAllByRole('button', { name: 'Work details' })).toHaveLength(TURNS);
    expect(renders.disclosure.size).toBe(TURNS);
    renders.boundary = 0;
    renders.disclosure.clear();

    for (let i = 1; i <= CHUNKS; i++) {
      view.rerender(<TurnFixture rootId="isolation" messages={[...settled, tail(`S${'t'.repeat(i)}`)]} />);
      await flush();
    }

    // The tail's slice renders, and only it (plus dev-mode double-render slack).
    expect(renders.boundary).toBeGreaterThan(0);
    expect(renders.boundary / CHUNKS).toBeLessThanOrEqual(2);
    expect(renders.disclosure.size).toBe(0);
  });
});
