import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../NewSessionState', () => ({ NewSessionState: () => <div data-testid="welcome" /> }));
vi.mock('../FirstRunState', () => ({ FirstRunState: () => <div data-testid="firstrun" /> }));

import { ChatEmptyState } from '../ChatEmptyState';

describe('ChatEmptyState', () => {
  it('is the new session’s empty state for a draft', () => {
    render(<ChatEmptyState variant="welcome" />);
    expect(screen.getByTestId('welcome')).toBeInTheDocument();
  });

  it('is the first-run hero while there are no projects', () => {
    render(<ChatEmptyState variant="firstrun" />);
    expect(screen.getByTestId('firstrun')).toBeInTheDocument();
  });
});
