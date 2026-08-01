import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar, SidebarProvider, SidebarTrigger } from '..';

function Harness(props: React.ComponentProps<typeof SidebarProvider>) {
  return (
    <SidebarProvider {...props}>
      <Sidebar data-testid="panel">
        <span>sessions</span>
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>
  );
}

describe('SidebarProvider', () => {
  it('starts expanded and collapses on the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId('panel')).toHaveAttribute('data-state', 'expanded');
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByTestId('panel')).toHaveAttribute('data-state', 'collapsed');
  });

  it('toggles on meta+b', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.keyboard('{Meta>}b{/Meta}');
    expect(screen.getByTestId('panel')).toHaveAttribute('data-state', 'collapsed');
    await user.keyboard('{Meta>}b{/Meta}');
    expect(screen.getByTestId('panel')).toHaveAttribute('data-state', 'expanded');
  });

  it('defers to the caller when controlled, holding its own state unchanged', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('panel')).toHaveAttribute('data-state', 'expanded');
  });
});

describe('Sidebar', () => {
  it('publishes the collapse mode only while collapsed, so descendants key off it', async () => {
    const user = userEvent.setup();
    render(
      <SidebarProvider>
        <Sidebar data-testid="panel" collapsible="icon" />
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(screen.getByTestId('panel')).toHaveAttribute('data-collapsible', '');
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByTestId('panel')).toHaveAttribute('data-collapsible', 'icon');
  });

  it('ignores collapse entirely when collapsible is none', async () => {
    const user = userEvent.setup();
    render(
      <SidebarProvider>
        <Sidebar data-testid="panel" collapsible="none" />
        <SidebarTrigger />
      </SidebarProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));

    const panel = screen.getByTestId('panel');
    expect(panel).toHaveAttribute('data-state', 'expanded');
    expect(panel).toHaveStyle({ width: 'var(--sidebar-width)' });
  });
});
