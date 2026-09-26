import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const addProject = vi.fn();
const selectProject = vi.fn();
vi.mock('../../use-projects', () => ({ useProjects: () => ({ reloadProjects: vi.fn() }) }));
vi.mock('../../use-add-project', () => ({ useAddProject: () => addProject }));
vi.mock('../use-select-draft-project', () => ({ useSelectDraftProject: () => selectProject }));

import { FirstRunState } from '../FirstRunState';

describe('FirstRunState', () => {
  it('renders the welcome hero and the Add project CTA', () => {
    render(<FirstRunState />);
    expect(screen.getByTestId('sessions-firstrun')).toHaveTextContent('Welcome to Mainframe');
    expect(screen.getByTestId('sessions-firstrun-add-project')).toHaveTextContent('Add project');
  });

  it('invokes add-project on CTA click', () => {
    render(<FirstRunState />);
    fireEvent.click(screen.getByTestId('sessions-firstrun-add-project'));
    expect(addProject).toHaveBeenCalledTimes(1);
  });

  it('renders the "Start with no project" CTA next to Add project (todo #346)', () => {
    render(<FirstRunState />);
    expect(screen.getByTestId('sessions-firstrun-no-project')).toHaveTextContent('Start with no project');
  });

  it('scopes the draft to "No project" on click', () => {
    render(<FirstRunState />);
    fireEvent.click(screen.getByTestId('sessions-firstrun-no-project'));
    expect(selectProject).toHaveBeenCalledExactlyOnceWith(null);
  });
});
