import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the built Electron main entry point
const APP_MAIN = path.resolve(__dirname, '../../../packages/desktop/out/main/index.js');

export interface AppFixture {
  app: ElectronApplication;
  page: Page;
}

export async function launchApp(): Promise<AppFixture> {
  const app = await electron.launch({ args: [APP_MAIN] });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Wait for the connection dot to appear (daemon ready)
  await page.locator('[data-testid="connection-status"]').waitFor({ timeout: 15_000 });
  return { app, page };
}

export async function closeApp(fixture: AppFixture): Promise<void> {
  await fixture.app.close();
}
