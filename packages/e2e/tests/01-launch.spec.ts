import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';

test.describe('§1 Launch & connection', () => {
  test('app launches and shows connection indicator', async () => {
    const fixture = await launchApp();
    try {
      // Verify the status bar shows "Connected" (WebSocket to daemon is open)
      await expect(fixture.page.locator('[data-testid="connection-status"]')).toContainText('Connected');
    } finally {
      await closeApp(fixture);
    }
  });
});
