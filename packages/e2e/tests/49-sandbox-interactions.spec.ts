import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, mkdtempSync, realpathSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import type { Page } from '@playwright/test';
import { launchApp, closeApp, DAEMON_PORT } from '../fixtures/app.js';
import { openPickerAndSelectPath, cleanupProject, type ProjectFixture } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

// New coverage from scenarios/sandbox.md — preview run + webview interactions (S1, S7, S8, S10, S11).
// No AI. These drive a real preview webview, so they're inherently the flakiest e2e here.
async function createProjectWithPreview(page: Page): Promise<ProjectFixture> {
  const tmpBase = path.join(homedir(), 'tmp');
  mkdirSync(tmpBase, { recursive: true });
  const projectPath = realpathSync(mkdtempSync(path.join(tmpBase, 'mf-e2e-')));
  execSync('git init && git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });
  writeFileSync(path.join(projectPath, 'CLAUDE.md'), '# E2E Test\n');
  writeFileSync(
    path.join(projectPath, '__test_server.js'),
    `const http=require('http');const port=process.env.PORT||4577;` +
      `http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});` +
      `r.end('<html><body><h1 id="h">Preview</h1></body></html>')}).listen(port,()=>console.log('listening '+port));\n`,
  );
  const mfDir = path.join(projectPath, '.mainframe');
  mkdirSync(mfDir, { recursive: true });
  writeFileSync(
    path.join(mfDir, 'launch.json'),
    JSON.stringify({
      version: '1',
      configurations: [
        {
          name: 'Web',
          runtimeExecutable: 'node',
          runtimeArgs: ['__test_server.js'],
          port: 4577,
          url: 'http://localhost:4577',
          preview: true,
        },
      ],
    }),
  );
  await openPickerAndSelectPath(page, projectPath);
  const deadline = Date.now() + 15_000;
  let found: { id: string; path: string } | undefined;
  while (Date.now() < deadline) {
    const res = await page.request.get(`${DAEMON_BASE}/api/projects`);
    const { data } = (await res.json()) as { data: { id: string; path: string }[] };
    found = data.find((p) => p.path === projectPath);
    if (found) break;
    await page.waitForTimeout(200);
  }
  if (!found) throw new Error('project not registered');
  return { projectPath, projectId: found.id };
}

test.describe('§49 Sandbox preview interactions', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: ProjectFixture;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createProjectWithPreview(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'default');
    // Start the Web preview via the title-bar launch button.
    await fixture.page.locator('[data-testid="launch-config-selector"]').click();
    await fixture.page.locator('[data-testid="launch-config-Web"]').click();
    await fixture.page.locator('[data-testid="launch-start-btn"]').click();
  });
  test.afterAll(async () => {
    if (project?.projectId) {
      await fixture.page.request
        .post(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/Web/stop`)
        .catch(() => {});
    }
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('S1: starting the preview shows the stop button and preview tab', async () => {
    await expect(fixture.page.locator('[data-testid="launch-stop-btn"]')).toBeVisible({ timeout: 15_000 });
    await expect(fixture.page.locator('[data-testid="preview-tab"]')).toBeVisible({ timeout: 10_000 });
  });

  test('S7: full screenshot adds a capture thumbnail', async () => {
    const btn = fixture.page.locator('[data-testid="sandbox-button-screenshot"]');
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await expect(fixture.page.locator('[data-testid="capture-thumb"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('S10: mobile-view toggle', async () => {
    const btn = fixture.page.locator('[data-testid="sandbox-button-mobile-view"]');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click(); // → mobile frame
    await btn.click(); // → back to full width
  });

  test('S11: console toggle + clear logs', async () => {
    await fixture.page.locator('[data-testid="sandbox-button-toggle-console"]').click();
    const clear = fixture.page.locator('[data-testid="sandbox-button-clear-logs"]');
    await expect(clear).toBeVisible({ timeout: 10_000 });
    await clear.click();
    await expect(fixture.page.locator('[data-testid="preview-console-output"]')).toContainText(/no output/i, {
      timeout: 10_000,
    });
  });

  test('S6: inspect mode toggles on and off', async () => {
    const inspect = fixture.page.locator('[data-testid="sandbox-button-inspect"]');
    await expect(inspect).toBeVisible({ timeout: 10_000 });
    await inspect.click(); // enter element-pick mode
    await inspect.click(); // 2nd click cancels
    // App stays healthy (no crash on toggling inspect).
    await expect(fixture.page.locator('[data-testid="preview-tab"]')).toBeVisible();
  });

  test('S8: region-capture mode can be entered and cancelled', async () => {
    await fixture.page.locator('[data-testid="sandbox-button-region-capture"]').click();
    const cancel = fixture.page.locator('[data-testid="sandbox-button-cancel-capture"]');
    await expect(cancel).toBeVisible({ timeout: 10_000 });
    // The capture overlay intercepts pointer events; cancel via Esc (the button is "Cancel (Esc)").
    await fixture.page.keyboard.press('Escape');
    await expect(cancel).toHaveCount(0, { timeout: 5_000 });
  });

  test('S12: clear session reloads the preview without crashing', async () => {
    const clearSession = fixture.page.locator('[data-testid="sandbox-button-clear-session"]');
    // Electron-only; present in the e2e Electron app.
    await expect(clearSession).toBeVisible({ timeout: 10_000 });
    await clearSession.click();
    await expect(fixture.page.locator('[data-testid="preview-tab"]')).toBeVisible({ timeout: 10_000 });
  });
});
