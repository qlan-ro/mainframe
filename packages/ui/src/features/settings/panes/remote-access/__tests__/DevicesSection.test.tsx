import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DevicesSection } from '../DevicesSection';

const getDevices = vi.fn();
const removeDevice = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../../lib/api/remote-access', () => ({
  getDevices: (...a: unknown[]) => getDevices(...a),
  removeDevice: (...a: unknown[]) => removeDevice(...a),
}));

beforeEach(() =>
  getDevices.mockResolvedValue([{ deviceId: 'd1', deviceName: 'iPhone', createdAt: '2026-01-01', lastSeen: null }]),
);
afterEach(() => vi.clearAllMocks());

describe('DevicesSection', () => {
  it('renders devices and removes one optimistically', async () => {
    render(
      <TooltipProvider>
        <DevicesSection port={31415} />
      </TooltipProvider>,
    );
    const btn = await screen.findByTestId('remote-access-device-remove-d1');
    fireEvent.click(btn);
    expect(removeDevice).toHaveBeenCalledWith(31415, 'd1');
    await waitFor(() => expect(screen.queryByTestId('remote-access-device-remove-d1')).toBeNull());
  });
});
