import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FakeHostBridge } from '../../../../../lib/host/fake-adapter';
import { HostProvider } from '../../../../../lib/host';
import { AboutPane } from '../AboutPane';

function renderAbout() {
  const host = new FakeHostBridge({
    app: { getInfo: { version: '0.22.2', author: 'qlan.ro', homedir: '/Users/x' } },
  });
  return render(
    <HostProvider host={host}>
      <AboutPane />
    </HostProvider>,
  );
}

describe('AboutPane', () => {
  it('renders version and author from getAppInfo', async () => {
    renderAbout();
    await waitFor(() => expect(screen.getByTestId('settings-about-version').textContent).toContain('0.22.2'));
    expect(screen.getByTestId('settings-about-author').textContent).toContain('qlan.ro');
  });
  it('does not render an update button', () => {
    renderAbout();
    expect(screen.queryByTestId('settings-about-check-updates')).toBeNull();
  });
});
