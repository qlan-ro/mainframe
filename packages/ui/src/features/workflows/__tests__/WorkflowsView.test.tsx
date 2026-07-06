import { it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WorkflowsView } from '@/features/workflows/WorkflowsView';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';

it('renders nav and switches section; shows the pending badge', () => {
  useWorkflowsStore.setState({ interactions: [{ id: 'i1' } as never] });
  useWorkflowsModal.setState({ section: 'needs', selectedRunId: null });
  render(<WorkflowsView port={31415} />);
  const navNeeds = screen.getByTestId('workflows-nav-needs');
  expect(navNeeds).toBeInTheDocument();
  // Badge is scoped inside the nav button to avoid ambiguity with the inbox header.
  expect(within(navNeeds).getByText('1')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('workflows-nav-runs'));
  expect(useWorkflowsModal.getState().section).toBe('runs');
});

it('renders the title count chip and a close button', () => {
  useWorkflowsStore.setState({
    interactions: [{ id: 'i1' } as never],
    runs: [{ id: 'r1', status: 'running' } as never, { id: 'r2', status: 'waiting' } as never],
  });
  useWorkflowsModal.setState({ section: 'needs', selectedRunId: null, open: true });
  render(<WorkflowsView port={31415} />);
  expect(screen.getByTestId('workflows-title-count')).toBeInTheDocument();
  expect(screen.getByTestId('workflows-title-count').textContent).toMatch(/2 active/);
  expect(screen.getByTestId('workflows-title-count').textContent).toMatch(/1 need you/);
  expect(screen.getByTestId('workflows-close')).toBeInTheDocument();
});

it('close button calls close()', () => {
  useWorkflowsStore.setState({ interactions: [], runs: [] });
  useWorkflowsModal.setState({ section: 'needs', selectedRunId: null, open: true });
  render(<WorkflowsView port={31415} />);
  fireEvent.click(screen.getByTestId('workflows-close'));
  expect(useWorkflowsModal.getState().open).toBe(false);
});
