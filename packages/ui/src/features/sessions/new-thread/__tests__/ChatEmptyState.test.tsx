import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../WelcomeState', () => ({
  WelcomeState: ({ projectId }: { projectId?: string }) => (
    <div data-testid="welcome" data-project={projectId ?? ''}>
      {projectId}
    </div>
  ),
}));
vi.mock('../FirstRunState', () => ({ FirstRunState: () => <div data-testid="firstrun" /> }));

import { ChatEmptyState } from '../ChatEmptyState';

describe('ChatEmptyState', () => {
  it('renders WelcomeState with the projectId for the welcome variant', () => {
    render(<ChatEmptyState variant="welcome" projectId="proj-a" />);
    expect(screen.getByTestId('welcome')).toHaveTextContent('proj-a');
  });

  it('renders WelcomeState in its choose-a-project form when the draft has no project', () => {
    render(<ChatEmptyState variant="welcome" />);
    const welcome = screen.getByTestId('welcome');
    expect(welcome).toBeInTheDocument();
    expect(welcome).toHaveAttribute('data-project', '');
  });

  it('renders FirstRunState for the firstrun variant', () => {
    render(<ChatEmptyState variant="firstrun" />);
    expect(screen.getByTestId('firstrun')).toBeInTheDocument();
  });
});
