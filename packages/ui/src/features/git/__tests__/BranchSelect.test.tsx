/**
 * BranchSelect — shared existing-branch picker (extracted from
 * WorktreeNewForm so AgentConfig's worktree base-branch field can reuse it).
 * TDD: test written first, extraction verified against it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BranchSelect } from '../BranchSelect';

describe('BranchSelect', () => {
  it('shows a placeholder when no branch is selected yet', () => {
    render(<BranchSelect value="" options={['main', 'dev']} currentBranch="main" onChange={vi.fn()} testId="bs" />);
    expect(screen.getByTestId('bs')).toHaveTextContent('Select…');
  });

  it('marks the current branch in its label', () => {
    render(<BranchSelect value="main" options={['main', 'dev']} currentBranch="main" onChange={vi.fn()} testId="bs" />);
    expect(screen.getByTestId('bs')).toHaveTextContent('main (current)');
  });

  it('opens a list of every option and calls onChange when one is picked', () => {
    const onChange = vi.fn();
    render(
      <BranchSelect value="main" options={['main', 'dev']} currentBranch="main" onChange={onChange} testId="bs" />,
    );
    fireEvent.click(screen.getByTestId('bs'));
    expect(screen.getByTestId('bs-option-main')).toBeInTheDocument();
    expect(screen.getByTestId('bs-option-dev')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bs-option-dev'));
    expect(onChange).toHaveBeenCalledWith('dev');
  });
});
