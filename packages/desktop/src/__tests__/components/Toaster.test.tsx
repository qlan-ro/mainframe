import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '../../renderer/components/Toaster';
import { useToastStore } from '../../renderer/store/toasts';

describe('Toaster', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('renders a success toast', () => {
    useToastStore.getState().add('success', 'It worked');
    render(<Toaster />);
    expect(screen.getByText('It worked')).toBeInTheDocument();
  });

  it('renders an error toast', () => {
    useToastStore.getState().add('error', 'Something broke');
    render(<Toaster />);
    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });

  it('dismisses on click', async () => {
    useToastStore.getState().add('info', 'Click me');
    render(<Toaster />);
    await userEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Click me')).not.toBeInTheDocument();
  });

  it('limits to 5 visible toasts', () => {
    const store = useToastStore.getState();
    for (let i = 0; i < 7; i++) store.add('info', `Toast ${i}`);
    render(<Toaster />);
    const toasts = screen.getAllByRole('alert');
    expect(toasts.length).toBeLessThanOrEqual(5);
  });
});
