// @vitest-environment jsdom
/**
 * PairGlyph.test.tsx
 *
 * Red-phase test for the row/card trailing-glyph-slot component (`../PairGlyph`,
 * not yet created — task 39 of the plan implements it against this file, per the
 * spec's "Pair state on the board" table.
 *
 * Props contract assumed (not frozen elsewhere, chosen to match the frozen testid
 * inventory which lists both `tasks-list-row-*` and `tasks-card-*` variants):
 * `<PairGlyph todo={todo} surface="list" | "card" />`, reading the pair from the
 * store by `todo.id`.
 *
 * Behaviors covered (the five states from the spec table):
 *  1. unpaired (no entry in store.pairs) -> renders the publish button
 *     (`${surface}-publish-${number}`); clicking it opens the publish dialog with
 *     this todo.
 *  2. paired, clean -> renders `${surface}-pair-${number}` showing `#{issueNumber}`,
 *     not amber.
 *  3. paired, overwritten in the last run -> same testid, amber, and clicking it
 *     opens the report.
 *  4. errored -> same testid, amber.
 *  5. remotely-unlinked -> same testid, amber.
 *  6. Amber is exclusive to overwritten/errored/remotely-unlinked (never clean or unpaired).
 *
 * "Amber" is asserted via a semantic `data-amber` attribute rather than a Tailwind
 * class string, per the suite's no-styling-pin convention.
 */
import { TooltipProvider } from '@/components/ui/tooltip';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Todo } from '@/lib/api/todos';
import type { Pair } from '@/lib/api/todos-github';

const TODO: Todo = {
  id: 'todo-a',
  number: 285,
  project_id: 'proj-abc',
  title: 'Fix the login bug',
  body: 'Steps to reproduce...',
  status: 'open',
  type: 'bug',
  priority: 'medium',
  labels: [],
  assignees: [],
  dependencies: [],
  order_index: 0,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const PAIR_FIXTURE = (overrides: Partial<Pair>): Pair => ({
  todoId: TODO.id,
  todoNumber: TODO.number,
  issueNumber: 219,
  issueUrl: 'https://github.com/qlan-ro/mainframe/issues/219',
  pairState: 'clean',
  stateReason: null,
  ...overrides,
});

const openDialog = vi.fn();

let pairs: Record<string, Pair>;

vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ pairs, openDialog }),
}));

const { PairGlyph } = await import('../PairGlyph');

beforeEach(() => {
  vi.clearAllMocks();
  pairs = {};
});

describe('PairGlyph — unpaired', () => {
  it('renders the publish button, not the pair testid', () => {
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('tasks-list-row-publish-285')).toBeTruthy();
    expect(screen.queryByTestId('tasks-list-row-pair-285')).toBeNull();
  });

  it('opens the publish dialog for this todo when clicked', async () => {
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-list-row-publish-285'));
    expect(openDialog).toHaveBeenCalledWith({ kind: 'publish', todo: TODO });
  });

  it('is never amber', () => {
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('tasks-list-row-publish-285').getAttribute('data-amber')).not.toBe('true');
  });

  it('uses the card surface prefix when surface="card"', () => {
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="card" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('tasks-card-publish-285')).toBeTruthy();
  });
});

describe('PairGlyph — paired, clean', () => {
  beforeEach(() => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'clean' }) };
  });

  it('renders #{issueNumber} and is not amber', () => {
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    const glyph = screen.getByTestId('tasks-list-row-pair-285');
    expect(glyph.textContent).toContain('219');
    expect(glyph.getAttribute('data-amber')).not.toBe('true');
  });
});

describe('PairGlyph — paired, overwritten in the last run', () => {
  beforeEach(() => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'overwritten' }) };
  });

  it('is amber', () => {
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('tasks-list-row-pair-285').getAttribute('data-amber')).toBe('true');
  });

  it('opens the report when clicked', async () => {
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-list-row-pair-285'));
    expect(openDialog).toHaveBeenCalledWith({ kind: 'report' });
  });
});

describe('PairGlyph — errored', () => {
  it('is amber', () => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'errored', stateReason: 'issue fetch failed: 502' }) };
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('tasks-list-row-pair-285').getAttribute('data-amber')).toBe('true');
  });
});

describe('PairGlyph — remotely-unlinked', () => {
  it('is amber', () => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'remotely-unlinked', stateReason: 'issue not found' }) };
    render(
      <TooltipProvider>
        <PairGlyph todo={TODO} surface="list" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('tasks-list-row-pair-285').getAttribute('data-amber')).toBe('true');
  });
});
