// @vitest-environment jsdom
/**
 * PairGlyph.test.tsx
 *
 * `../PairGlyph` is the card's trailing glyph slot — board-only since the
 * 2026-10 redesign (the list view's row variant is gone, and with it the
 * `surface` prop/`tasks-list-row-*` prefix choice; the component is always
 * `tasks-card-*` now).
 *
 * Behaviors covered (the five states from the spec table):
 *  1. unpaired (no entry in store.pairs) -> renders the publish button
 *     (`tasks-card-publish-${number}`); clicking it opens the publish dialog with
 *     this todo.
 *  2. paired, clean -> renders `tasks-card-pair-${number}` showing `#{issueNumber}`,
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

function renderGlyph() {
  render(
    <TooltipProvider>
      <PairGlyph todo={TODO} />
    </TooltipProvider>,
  );
}

describe('PairGlyph — unpaired', () => {
  it('renders the publish button, not the pair testid', () => {
    renderGlyph();
    expect(screen.getByTestId('tasks-card-publish-285')).toBeTruthy();
    expect(screen.queryByTestId('tasks-card-pair-285')).toBeNull();
  });

  it('opens the publish dialog for this todo when clicked', async () => {
    renderGlyph();
    await userEvent.click(screen.getByTestId('tasks-card-publish-285'));
    expect(openDialog).toHaveBeenCalledWith({ kind: 'publish', todo: TODO });
  });

  it('is never amber', () => {
    renderGlyph();
    expect(screen.getByTestId('tasks-card-publish-285').getAttribute('data-amber')).not.toBe('true');
  });
});

describe('PairGlyph — paired, clean', () => {
  beforeEach(() => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'clean' }) };
  });

  it('renders #{issueNumber} and is not amber', () => {
    renderGlyph();
    const glyph = screen.getByTestId('tasks-card-pair-285');
    expect(glyph.textContent).toContain('219');
    expect(glyph.getAttribute('data-amber')).not.toBe('true');
  });
});

describe('PairGlyph — paired, overwritten in the last run', () => {
  beforeEach(() => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'overwritten' }) };
  });

  it('is amber', () => {
    renderGlyph();
    expect(screen.getByTestId('tasks-card-pair-285').getAttribute('data-amber')).toBe('true');
  });

  it('opens the report when clicked', async () => {
    renderGlyph();
    await userEvent.click(screen.getByTestId('tasks-card-pair-285'));
    expect(openDialog).toHaveBeenCalledWith({ kind: 'report' });
  });
});

describe('PairGlyph — errored', () => {
  it('is amber', () => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'errored', stateReason: 'issue fetch failed: 502' }) };
    renderGlyph();
    expect(screen.getByTestId('tasks-card-pair-285').getAttribute('data-amber')).toBe('true');
  });
});

describe('PairGlyph — remotely-unlinked', () => {
  it('is amber', () => {
    pairs = { [TODO.id]: PAIR_FIXTURE({ pairState: 'remotely-unlinked', stateReason: 'issue not found' }) };
    renderGlyph();
    expect(screen.getByTestId('tasks-card-pair-285').getAttribute('data-amber')).toBe('true');
  });
});
