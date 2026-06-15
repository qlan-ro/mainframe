import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AboutPane } from '../AboutPane';

vi.mock('../../../../../lib/tauri/bridge', () => ({
  getAppInfo: vi.fn().mockResolvedValue({ version: '0.22.2', author: 'qlan.ro', homedir: '/Users/x' }),
}));

describe('AboutPane', () => {
  it('renders version and author from getAppInfo', async () => {
    render(<AboutPane />);
    await waitFor(() => expect(screen.getByTestId('settings-about-version').textContent).toContain('0.22.2'));
    expect(screen.getByTestId('settings-about-author').textContent).toContain('qlan.ro');
  });
  it('does not render an update button', () => {
    render(<AboutPane />);
    expect(screen.queryByTestId('settings-about-check-updates')).toBeNull();
  });
});
