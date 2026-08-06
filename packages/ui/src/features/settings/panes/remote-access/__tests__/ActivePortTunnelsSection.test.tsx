import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import { ActivePortTunnelsSection } from '../ActivePortTunnelsSection';
import { applyPortTunnelEvent, resetPortTunnels } from '@/store/port-tunnels';

/** The section's stop control is a bare Radix tooltip; the app supplies the provider at the root. */
function renderSection() {
  return render(
    <TooltipProvider>
      <ActivePortTunnelsSection port={31415} />
    </TooltipProvider>,
  );
}

const stopPortTunnel = vi.fn();
vi.mock('@/lib/api/tunnel-ports', () => ({
  stopPortTunnel: (...a: unknown[]) => stopPortTunnel(...a),
}));

const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...a: unknown[]) => toastError(...a) } }));

function emit(event: DaemonEvent): void {
  act(() => applyPortTunnelEvent(event));
}

function ready(port: number, url: string): DaemonEvent {
  return { type: 'tunnel:status', state: 'ready', label: `port:${port}`, url };
}

afterEach(() => {
  resetPortTunnels();
  vi.clearAllMocks();
});

describe('ActivePortTunnelsSection', () => {
  it('renders nothing when no tunnel is up', () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a row per tunnel with its port and URL', () => {
    renderSection();
    emit(ready(5173, 'https://a.trycloudflare.com'));
    emit(ready(8080, 'https://b.trycloudflare.com'));

    expect(screen.getByTestId('settings-remote-access-port-tunnels-section')).toBeInTheDocument();
    expect(screen.getByText('Port 5173')).toBeInTheDocument();
    expect(screen.getByText('https://a.trycloudflare.com')).toBeInTheDocument();
    expect(screen.getByText('Port 8080')).toBeInTheDocument();
  });

  it('shows a starting tunnel as a row, not a missing one', () => {
    renderSection();
    emit({ type: 'tunnel:status', state: 'starting', label: 'port:5173' });

    expect(screen.getByText('Starting…')).toBeInTheDocument();
    expect(screen.getByTestId('remote-access-port-tunnel-stop-5173')).toBeInTheDocument();
  });

  it('stops the tunnel by port and waits for the daemon event to clear the row', () => {
    stopPortTunnel.mockResolvedValue(undefined);
    renderSection();
    emit(ready(5173, 'https://a.trycloudflare.com'));

    fireEvent.click(screen.getByTestId('remote-access-port-tunnel-stop-5173'));
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
    expect(screen.getByTestId('remote-access-port-tunnel-stop-5173')).toBeInTheDocument();

    emit({ type: 'tunnel:status', state: 'stopped', label: 'port:5173' });
    expect(screen.queryByTestId('remote-access-port-tunnel-stop-5173')).toBeNull();
  });

  it('ignores tunnel events that are not port tunnels', () => {
    const { container } = renderSection();
    emit({ type: 'tunnel:status', state: 'ready', label: 'daemon', url: 'https://daemon.example' });
    emit({ type: 'tunnel:status', state: 'ready', label: 'preview:web', url: 'https://preview.example' });

    expect(container).toBeEmptyDOMElement();
  });
});
