// @vitest-environment jsdom

/**
 * SessionMetaCard — the fork-lineage hover-card lines (todo #343, AC 15):
 * `sessions-meta-card-forked-from` on a fork, `sessions-meta-card-fork-count`
 * on a parent with listed forks, and neither on a chat with no lineage.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionMetaCard } from '../SessionMetaCard';

const BASE_PROPS = {
  title: 'My Chat',
  worktreeMissing: false,
  transcriptMissing: false,
  detectedPrs: [],
  tags: [],
};

describe('SessionMetaCard — fork lineage lines', () => {
  it('shows neither line on a chat with no forks and no parent', () => {
    render(<SessionMetaCard {...BASE_PROPS} />);

    expect(screen.queryByTestId('sessions-meta-card-forked-from')).toBeNull();
    expect(screen.queryByTestId('sessions-meta-card-fork-count')).toBeNull();
  });

  it('shows the forked-from line with the parent title on a fork', () => {
    render(<SessionMetaCard {...BASE_PROPS} parentState={{ kind: 'linked', title: 'Parent Chat' }} />);

    expect(screen.getByTestId('sessions-meta-card-forked-from')).toHaveTextContent('"Parent Chat"');
  });

  it('carries the same archived/deleted wording as the fallback glyph', () => {
    const { rerender } = render(
      <SessionMetaCard {...BASE_PROPS} parentState={{ kind: 'archived', title: 'Parent Chat' }} />,
    );
    expect(screen.getByTestId('sessions-meta-card-forked-from')).toHaveTextContent('"Parent Chat" (archived)');

    rerender(<SessionMetaCard {...BASE_PROPS} parentState={{ kind: 'deleted' }} />);
    expect(screen.getByTestId('sessions-meta-card-forked-from')).toHaveTextContent('a deleted chat');
  });

  it('shows "2x" for a parent with two listed forks', () => {
    render(<SessionMetaCard {...BASE_PROPS} forkCount={2} />);

    expect(screen.getByTestId('sessions-meta-card-fork-count')).toHaveTextContent('2x');
  });

  it('omits the fork-count line at zero', () => {
    render(<SessionMetaCard {...BASE_PROPS} forkCount={0} />);

    expect(screen.queryByTestId('sessions-meta-card-fork-count')).toBeNull();
  });

  it('shows both lines together for a fork that itself has forks', () => {
    render(<SessionMetaCard {...BASE_PROPS} parentState={{ kind: 'linked', title: 'Root' }} forkCount={1} />);

    expect(screen.getByTestId('sessions-meta-card-forked-from')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-meta-card-fork-count')).toHaveTextContent('1x');
  });
});
