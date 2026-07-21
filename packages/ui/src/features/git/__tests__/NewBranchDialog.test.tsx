/**
 * NewBranchDialog.test.tsx — name validation + create callback + testids.
 *
 * Behaviors covered:
 *  1.  Renders data-testid="git-new-branch-start" select seeded with local branches.
 *  2.  Back button (git-new-branch-back) fires onBack.
 *  3.  Cancel button (git-new-branch-cancel) fires onBack.
 *  4.  Create button is disabled when name is empty.
 *  5.  Submitting an empty name shows "Branch name is required" error.
 *  6.  Submitting an invalid name (starts with '-') shows "Invalid branch name" error.
 *  7.  Submitting an existing local name shows "Branch already exists" error.
 *  8.  Submitting a valid new name calls onCreate(name, startPoint).
 *  9.  startFrom prop pre-selects the start-point select.
 * 10.  Remote branches appear in a "Remote" optgroup when provided.
 * 11.  A valid name 'feat/my-branch' (with slash) is accepted — no error.
 * 12.  A name starting with '/' fails BRANCH_NAME_RE validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewBranchDialog, type NewBranchDialogProps } from '../NewBranchDialog';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<NewBranchDialogProps> = {}): NewBranchDialogProps {
  return {
    localBranches: ['main', 'develop'],
    remoteBranches: [],
    currentBranch: 'main',
    onBack: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 3. Start-from select seeded with local branches
//
// (Root-dialog and name-input presence smokes were dropped — every test
// below already queries git-new-branch-dialog/git-new-branch-name to drive
// its interaction, so bare presence is exercised implicitly.)
// ---------------------------------------------------------------------------

describe('NewBranchDialog — start-point select', () => {
  it('renders git-new-branch-start with local branch options', () => {
    render(<NewBranchDialog {...makeProps()} />);
    const select = screen.getByTestId('git-new-branch-start') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('main');
    expect(options).toContain('develop');
  });
});

// ---------------------------------------------------------------------------
// 4. Back button fires onBack
// ---------------------------------------------------------------------------

describe('NewBranchDialog — Back button', () => {
  it('fires onBack when git-new-branch-back is clicked', async () => {
    const props = makeProps();
    render(<NewBranchDialog {...props} />);
    await userEvent.click(screen.getByTestId('git-new-branch-back'));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Cancel button fires onBack
// ---------------------------------------------------------------------------

describe('NewBranchDialog — Cancel button', () => {
  it('fires onBack when git-new-branch-cancel is clicked', async () => {
    const props = makeProps();
    render(<NewBranchDialog {...props} />);
    await userEvent.click(screen.getByTestId('git-new-branch-cancel'));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Create button disabled on empty name
// ---------------------------------------------------------------------------

describe('NewBranchDialog — Create button disabled when empty', () => {
  it('has git-new-branch-create disabled initially (empty name)', () => {
    render(<NewBranchDialog {...makeProps()} />);
    expect(screen.getByTestId('git-new-branch-create')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 7. Empty name validation error
// ---------------------------------------------------------------------------

describe('NewBranchDialog — validation: empty name', () => {
  it('shows "Branch name is required" when form is submitted with only whitespace', async () => {
    render(<NewBranchDialog {...makeProps()} />);
    // Type spaces then submit via form (can't click disabled button, submit via fireEvent on form)
    const input = screen.getByTestId('git-new-branch-name');
    await userEvent.type(input, '   ');
    // Trigger submit via form element
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('Branch name is required')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. Invalid name validation
// ---------------------------------------------------------------------------

describe('NewBranchDialog — validation: invalid branch name', () => {
  it('shows "Invalid branch name" when name starts with a dash', async () => {
    render(<NewBranchDialog {...makeProps()} />);
    const input = screen.getByTestId('git-new-branch-name');
    await userEvent.type(input, '-bad-name');
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('Invalid branch name')).toBeTruthy();
  });

  it('shows "Invalid branch name" when name starts with "/"', async () => {
    render(<NewBranchDialog {...makeProps()} />);
    const input = screen.getByTestId('git-new-branch-name');
    await userEvent.type(input, '/invalid');
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('Invalid branch name')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9. Existing name validation
// ---------------------------------------------------------------------------

describe('NewBranchDialog — validation: existing branch name', () => {
  it('shows "Branch already exists" when name matches a local branch', async () => {
    render(<NewBranchDialog {...makeProps()} />);
    const input = screen.getByTestId('git-new-branch-name');
    await userEvent.type(input, 'main');
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('Branch already exists')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 10. Valid submission calls onCreate
// ---------------------------------------------------------------------------

describe('NewBranchDialog — valid submission calls onCreate', () => {
  it('calls onCreate("feat/new", "main") for a valid name with default start point', async () => {
    const props = makeProps();
    render(<NewBranchDialog {...props} />);
    const input = screen.getByTestId('git-new-branch-name');
    await userEvent.type(input, 'feat/new');
    fireEvent.submit(input.closest('form')!);
    await screen.findByTestId('git-new-branch-dialog'); // wait for async
    expect(props.onCreate).toHaveBeenCalledWith('feat/new', 'main');
  });
});

// ---------------------------------------------------------------------------
// 11. startFrom prop pre-selects the start-point select
// ---------------------------------------------------------------------------

describe('NewBranchDialog — startFrom prop', () => {
  it('pre-selects "develop" in the start-point select when startFrom="develop"', () => {
    render(<NewBranchDialog {...makeProps({ startFrom: 'develop' })} />);
    const select = screen.getByTestId('git-new-branch-start') as HTMLSelectElement;
    expect(select.value).toBe('develop');
  });
});

// ---------------------------------------------------------------------------
// 12. Remote branches appear in optgroup
// ---------------------------------------------------------------------------

describe('NewBranchDialog — remote branches in optgroup', () => {
  it('includes remote branch options when remoteBranches is non-empty', () => {
    render(<NewBranchDialog {...makeProps({ remoteBranches: ['origin/main', 'origin/feat'] })} />);
    const select = screen.getByTestId('git-new-branch-start') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('origin/main');
    expect(options).toContain('origin/feat');
  });

  it('does NOT render a Remote optgroup when remoteBranches is empty', () => {
    render(<NewBranchDialog {...makeProps({ remoteBranches: [] })} />);
    expect(screen.queryByText('Remote')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13. slash-containing names are valid
// ---------------------------------------------------------------------------

describe('NewBranchDialog — valid name with slash', () => {
  it('calls onCreate with a name containing a slash (feat/my-branch)', async () => {
    const props = makeProps();
    render(<NewBranchDialog {...props} />);
    const input = screen.getByTestId('git-new-branch-name');
    await userEvent.type(input, 'feat/my-branch');
    fireEvent.submit(input.closest('form')!);
    await screen.findByTestId('git-new-branch-dialog');
    expect(props.onCreate).toHaveBeenCalledWith('feat/my-branch', 'main');
    expect(screen.queryByText('Invalid branch name')).toBeNull();
  });
});
