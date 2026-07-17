import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TunnelStatusRow } from '../TunnelStatusRow';

describe('TunnelStatusRow', () => {
  it.each([
    ['starting', null, 'Starting tunnel…'],
    ['verifying', null, 'Verifying DNS…'],
  ] as const)('state=%s with url=%s shows "%s" with a spinner', (state, url, label) => {
    const { container } = render(<TunnelStatusRow state={state} url={url} onRetryVerify={vi.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it.each([
    ['idle', null],
    ['error', null],
  ] as const)('renders nothing for state=%s', (state, url) => {
    const { container } = render(<TunnelStatusRow state={state} url={url} onRetryVerify={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('state=ready shows the url with a copy button', () => {
    render(
      <TooltipProvider>
        <TunnelStatusRow state="ready" url="https://t.example.com" onRetryVerify={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByText('https://t.example.com')).toBeInTheDocument();
    expect(screen.getByTestId('tunnel-url-copy-ready')).toBeInTheDocument();
  });

  it('state=unreachable shows the warning and Re-check fires onRetryVerify', async () => {
    const onRetryVerify = vi.fn();
    render(
      <TooltipProvider>
        <TunnelStatusRow state="unreachable" url="https://t.example.com" onRetryVerify={onRetryVerify} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/DNS not yet propagated/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('tunnel-recheck-verify'));
    expect(onRetryVerify).toHaveBeenCalledTimes(1);
  });
});
