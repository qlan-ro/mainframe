/**
 * SidebarHeader — Update pill (finding 1.3, audit 2026-07-02).
 *
 * The artboard shows an accent-tinted "Install update — vX.X.X is available"
 * pill between the traffic-lights spacer and the trailing icon cluster,
 * driven by the host.updates bridge (checkForUpdate/onUpdateStatus already
 * exist on HostBridge — only the chrome pill consuming them was missing).
 *
 * Behaviors covered:
 *  1. state='not-available' → no pill rendered.
 *  2. state='available' → pill renders with the version text.
 *  3. state='downloading' → pill shows a downloading label.
 *  4. state='downloaded' → pill shows "Restart to update" and clicking it calls host.updates.install().
 *  5. clicking the pill in the 'available' state calls host.updates.download().
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { SidebarHeader } from '../SidebarHeader';

let fakeHost: FakeHostBridge;

function renderHeader() {
  return render(
    <HostProvider host={fakeHost}>
      <SidebarHeader />
    </HostProvider>,
  );
}

beforeEach(() => {
  fakeHost = new FakeHostBridge();
});

describe('SidebarHeader — Update pill (finding 1.3)', () => {
  it('does not render the update pill when state is not-available', async () => {
    renderHeader();
    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-update-pill')).toBeNull();
    });
  });

  it('renders the update pill with the version when state is available', async () => {
    fakeHost = new FakeHostBridge({ updates: { status: { state: 'available', version: '1.2.3' } } });
    renderHeader();
    const pill = await screen.findByTestId('sidebar-update-pill');
    expect(pill.textContent).toContain('1.2.3');
  });

  it('calls host.updates.download() when the available pill is clicked', async () => {
    fakeHost = new FakeHostBridge({ updates: { status: { state: 'available', version: '1.2.3' } } });
    const downloadSpy = vi.spyOn(fakeHost.updates, 'download').mockResolvedValue(undefined);
    renderHeader();
    const pill = await screen.findByTestId('sidebar-update-pill');
    await userEvent.click(pill);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a downloading label when state is downloading', async () => {
    fakeHost = new FakeHostBridge({ updates: { status: { state: 'downloading', percent: 40 } } });
    renderHeader();
    const pill = await screen.findByTestId('sidebar-update-pill');
    expect(pill.textContent).toContain('Downloading');
  });

  it('shows "Restart to update" and calls install() on click when state is downloaded', async () => {
    fakeHost = new FakeHostBridge({ updates: { status: { state: 'downloaded', version: '1.2.3' } } });
    const installSpy = vi.spyOn(fakeHost.updates, 'install');
    renderHeader();
    const pill = await screen.findByTestId('sidebar-update-pill');
    expect(pill.textContent).toContain('Restart to update');
    await userEvent.click(pill);
    expect(installSpy).toHaveBeenCalledTimes(1);
  });
});
