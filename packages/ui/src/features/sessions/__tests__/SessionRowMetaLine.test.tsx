// @vitest-environment jsdom

/**
 * SessionRowMetaLine — the no-project slot and the temporary glyph (todo #346).
 *
 * Both are pure presentational additions: `noProject` swaps the project-name
 * slot for `NoProjectLabel` (never a name, never `ProjectAvatar`), and
 * `temporary` adds a `Timer` glyph to the trailing cluster, hinted with the
 * exact "deleted when closed" copy the design direction specifies. The row's
 * existing worktree/PR/tag behavior is covered elsewhere and is not re-tested
 * here.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SessionRowMetaLine } from '../SessionRowMetaLine';

describe('SessionRowMetaLine — no-project slot', () => {
  it('renders NoProjectLabel, not a project name, when noProject is true', () => {
    render(<SessionRowMetaLine noProject projectName="Should never show" detectedPrs={[]} tags={[]} />);
    expect(screen.getByTestId('sessions-row-no-project')).toHaveTextContent('No project');
    expect(screen.queryByTestId('sessions-row-project')).not.toBeInTheDocument();
    expect(screen.queryByText('Should never show')).not.toBeInTheDocument();
  });

  it('renders the project name when noProject is false', () => {
    render(<SessionRowMetaLine projectName="Mainframe" detectedPrs={[]} tags={[]} />);
    expect(screen.getByTestId('sessions-row-project')).toHaveTextContent('Mainframe');
    expect(screen.queryByTestId('sessions-row-no-project')).not.toBeInTheDocument();
  });

  it('renders the row for a no-project chat with no other content', () => {
    render(<SessionRowMetaLine noProject detectedPrs={[]} tags={[]} />);
    expect(screen.getByTestId('sessions-row-meta')).toBeInTheDocument();
  });
});

describe('SessionRowMetaLine — temporary glyph', () => {
  it('renders the Timer glyph when temporary is true', () => {
    render(<SessionRowMetaLine temporary detectedPrs={[]} tags={[]} />);
    expect(screen.getByTestId('sessions-row-temporary-glyph')).toBeInTheDocument();
  });

  it('omits the glyph when temporary is false', () => {
    render(<SessionRowMetaLine projectName="Mainframe" detectedPrs={[]} tags={[]} />);
    expect(screen.queryByTestId('sessions-row-temporary-glyph')).not.toBeInTheDocument();
  });

  it('hints the exact "deleted when closed" copy on hover', async () => {
    const user = userEvent.setup();
    render(<SessionRowMetaLine temporary detectedPrs={[]} tags={[]} />);
    await user.hover(screen.getByTestId('sessions-row-temporary-glyph'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Temporary — deleted when closed');
  });

  it('composes with the no-project slot on the same row', () => {
    render(<SessionRowMetaLine noProject temporary detectedPrs={[]} tags={[]} />);
    expect(screen.getByTestId('sessions-row-no-project')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-row-temporary-glyph')).toBeInTheDocument();
  });
});

describe('SessionRowMetaLine — waiting (D15: "your turn" takes the project slot)', () => {
  it('shows "your turn" instead of the project name while waiting', () => {
    render(<SessionRowMetaLine waiting projectName="Mainframe" detectedPrs={[]} tags={[]} />);
    expect(screen.getByTestId('sessions-row-your-turn')).toHaveTextContent('your turn');
    expect(screen.queryByTestId('sessions-row-project')).toBeNull();
    expect(screen.queryByText('Mainframe')).toBeNull();
  });

  it('shows "your turn" even over the no-project slot', () => {
    render(<SessionRowMetaLine waiting noProject detectedPrs={[]} tags={[]} />);
    expect(screen.getByTestId('sessions-row-your-turn')).toBeInTheDocument();
    expect(screen.queryByTestId('sessions-row-no-project')).toBeNull();
  });

  it('shows the project name again once waiting clears', () => {
    render(<SessionRowMetaLine waiting={false} projectName="Mainframe" detectedPrs={[]} tags={[]} />);
    expect(screen.queryByTestId('sessions-row-your-turn')).toBeNull();
    expect(screen.getByTestId('sessions-row-project')).toHaveTextContent('Mainframe');
  });
});

describe('SessionRowMetaLine — glyph cluster order (D15: provider mark ends the cluster)', () => {
  function glyphOrder(container: HTMLElement): (string | null)[] {
    return Array.from(
      container.querySelectorAll(
        '[data-testid="sessions-row-meta-tag-dots"],[data-testid="sessions-row-meta-worktree"],[data-testid="sessions-row-meta-pr"],[data-testid="sessions-row-temporary-glyph"],[data-testid="sessions-row-parent-link"],[data-testid="sessions-row-provider"]',
      ),
    ).map((el) => el.getAttribute('data-testid'));
  }

  it('places the provider mark after every other glyph — worktree, PR, temporary, fork', () => {
    const { container } = render(
      <SessionRowMetaLine
        projectName="Mainframe"
        adapterId="claude"
        worktreePath="/repo/wt"
        detectedPrs={[{ url: 'https://x/pull/1', owner: 'a', repo: 'b', number: 1, source: 'created' }]}
        temporary
        forkFallback={{ hint: 'Forked from main', relation: 'fork' }}
        tags={['bug']}
        colorOf={() => 'blue'}
      />,
    );
    const order = glyphOrder(container);
    expect(order[order.length - 1]).toBe('sessions-row-provider');
    expect(order).toEqual([
      'sessions-row-meta-tag-dots',
      'sessions-row-meta-worktree',
      'sessions-row-meta-pr',
      'sessions-row-temporary-glyph',
      'sessions-row-parent-link',
      'sessions-row-provider',
    ]);
  });

  it('omits the provider mark for a draft with no adapter yet', () => {
    render(<SessionRowMetaLine projectName="Mainframe" detectedPrs={[]} tags={[]} />);
    expect(screen.queryByTestId('sessions-row-provider')).toBeNull();
  });
});
