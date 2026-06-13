import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarFooterView } from '../SidebarFooter';

it('renders the connected pip and per-status counts', () => {
  render(
    <TooltipProvider>
      <SidebarFooterView
        connection={{ state: 'connected', daemonStatus: 'ok' }}
        counts={{ 'worktree-missing': 0, working: 2, waiting: 1, idle: 3 }}
      />
    </TooltipProvider>,
  );
  expect(screen.getByTestId('sidebar-footer-connection').className).toContain('bg-mf-success');
  expect(screen.getByTestId('sidebar-footer-count-working')).toHaveTextContent('2');
  expect(screen.getByTestId('sidebar-footer-count-waiting')).toHaveTextContent('1');
});
