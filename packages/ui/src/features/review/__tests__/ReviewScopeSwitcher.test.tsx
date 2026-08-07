/**
 * ReviewScopeSwitcher tests.
 *
 * Radix `TabsTrigger` activates on mouse-down, not click, so the interactions
 * here are `fireEvent.mouseDown` — a `userEvent.click` selects nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { ReviewScopeSwitcher } = await import('../ReviewScopeSwitcher');

describe('ReviewScopeSwitcher', () => {
  it('renders one option per scope with its own testid', () => {
    render(<ReviewScopeSwitcher scope="uncommitted" onScopeChange={vi.fn()} />);
    expect(screen.getByTestId('review-scope-session').textContent).toBe('Session');
    expect(screen.getByTestId('review-scope-uncommitted').textContent).toBe('Uncommitted');
    expect(screen.getByTestId('review-scope-branch').textContent).toBe('Branch');
  });

  it('marks the active scope selected and the others not', () => {
    render(<ReviewScopeSwitcher scope="branch" onScopeChange={vi.fn()} />);
    expect(screen.getByTestId('review-scope-branch')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('review-scope-session')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('review-scope-uncommitted')).toHaveAttribute('aria-selected', 'false');
  });

  it('calls back with the chosen scope', () => {
    const onScopeChange = vi.fn();
    render(<ReviewScopeSwitcher scope="uncommitted" onScopeChange={onScopeChange} />);
    fireEvent.mouseDown(screen.getByTestId('review-scope-session'));
    expect(onScopeChange).toHaveBeenCalledWith('session');
  });

  it('carries an accessible name so the three unlabelled words have a subject', () => {
    render(<ReviewScopeSwitcher scope="uncommitted" onScopeChange={vi.fn()} />);
    expect(screen.getByRole('tablist', { name: 'Change scope' })).toBeInTheDocument();
  });
});
