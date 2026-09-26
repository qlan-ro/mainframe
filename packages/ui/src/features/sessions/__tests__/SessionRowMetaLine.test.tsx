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
