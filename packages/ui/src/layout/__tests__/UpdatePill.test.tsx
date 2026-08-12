import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UpdateStatus } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { UpdatePill } from '@/layout/UpdatePill';

function renderPill(status: UpdateStatus, host = new FakeHostBridge({ updates: { status } })) {
  render(
    <TooltipProvider>
      <HostProvider host={host}>
        <UpdatePill />
      </HostProvider>
    </TooltipProvider>,
  );
  return host;
}

const pill = () => screen.queryByTestId('sidebar-update-pill');

describe('UpdatePill', () => {
  it('stays hidden while no update is pending', async () => {
    renderPill({ state: 'not-available' });
    await waitFor(() => expect(pill()).toBeNull());
  });

  it('offers the download for an available update', async () => {
    const host = renderPill({ state: 'available', version: '2.0.0-rc.25' });
    const download = vi.spyOn(host.updates, 'download');

    const button = await screen.findByTestId('sidebar-update-pill');
    expect(button).toHaveTextContent('Update');
    expect(button).not.toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(button);
    expect(download).toHaveBeenCalledOnce();
  });

  it('reports progress inertly while downloading', async () => {
    const host = renderPill({ state: 'downloading', percent: 46.6 });
    const install = vi.spyOn(host.updates, 'install');

    const button = await screen.findByTestId('sidebar-update-pill');
    expect(button).toHaveTextContent('47%');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(button);
    expect(install).not.toHaveBeenCalled();
  });

  it('installs on click once the update is downloaded', async () => {
    const host = renderPill({ state: 'downloaded', version: '2.0.0-rc.25' });
    const install = vi.spyOn(host.updates, 'install');

    const button = await screen.findByTestId('sidebar-update-pill');
    expect(button).toHaveTextContent('Restart');

    await userEvent.click(button);
    expect(install).toHaveBeenCalledOnce();
  });
});
