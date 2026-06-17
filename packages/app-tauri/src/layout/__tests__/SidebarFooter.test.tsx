import { it, describe, expect } from 'vitest';
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

describe('SidebarFooter — design-parity (Phase-3)', () => {
  it('root element has h-[25px] class (artboard specifies height: 25)', () => {
    render(
      <TooltipProvider>
        <SidebarFooterView
          connection={{ state: 'connected', daemonStatus: 'ok' }}
          counts={{ 'worktree-missing': 0, working: 0, waiting: 0, idle: 0 }}
        />
      </TooltipProvider>,
    );
    const footer = screen.getByTestId('sidebar-footer');
    expect(footer.className).toContain('h-[25px]');
    expect(footer.className).not.toContain('h-7');
  });

  it('working-count dot has animate-pulse class (artboard shows tw-pulse animation)', () => {
    render(
      <TooltipProvider>
        <SidebarFooterView
          connection={{ state: 'connected', daemonStatus: 'ok' }}
          counts={{ 'worktree-missing': 0, working: 1, waiting: 0, idle: 0 }}
        />
      </TooltipProvider>,
    );
    const workingCount = screen.getByTestId('sidebar-footer-count-working');
    const dot = workingCount.querySelector('.animate-pulse');
    expect(dot).toBeTruthy();
  });
});
