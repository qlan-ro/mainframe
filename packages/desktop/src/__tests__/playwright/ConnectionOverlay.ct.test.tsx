import { test, expect } from '@playwright/experimental-ct-react';
import React from 'react';
import { ConnectionOverlayView } from '../../renderer/components/ConnectionOverlay.js';

test('renders overlay with reconnecting text when disconnected', async ({ mount, page }) => {
  await mount(<ConnectionOverlayView connected={false} />);
  await expect(page.getByTestId('connection-overlay')).toBeVisible();
  await expect(page.getByText(/Reconnecting to daemon/)).toBeVisible();
});

test('renders spinner when disconnected', async ({ mount }) => {
  const component = await mount(<ConnectionOverlayView connected={false} />);
  await expect(component.locator('.animate-spin')).toBeAttached();
});

test('renders nothing when connected', async ({ mount }) => {
  const component = await mount(<ConnectionOverlayView connected={true} />);
  await expect(component.getByTestId('connection-overlay')).not.toBeAttached();
});
