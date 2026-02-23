import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the built Electron main entry point
const APP_MAIN = path.resolve(__dirname, '../../../packages/desktop/out/main/index.js');

export interface AppFixture {
  app: ElectronApplication;
  page: Page;
  testDataDir: string;
}

export async function launchApp(): Promise<AppFixture> {
  // Isolated data dir — never touches ~/.mainframe
  const testDataDir = mkdtempSync(path.join(tmpdir(), 'mf-e2e-data-'));

  const app = await electron.launch({
    args: [APP_MAIN],
    env: {
      ...process.env,
      MAINFRAME_DATA_DIR: testDataDir,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Wait for the connection dot to appear (daemon ready)
  await page.locator('[data-testid="connection-status"]').waitFor({ timeout: 15_000 });
  return { app, page, testDataDir };
}

export async function closeApp(fixture: AppFixture): Promise<void> {
  await fixture.app.close();
  rmSync(fixture.testDataDir, { recursive: true, force: true });
}
