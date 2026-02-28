import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { openPickerAndSelectPath, cleanupProject, type ProjectFixture } from '../fixtures/project.js';
import { writeFileSync, mkdirSync, mkdtempSync, realpathSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import type { Page } from '@playwright/test';

const DAEMON_BASE = `http://127.0.0.1:${process.env['PORT'] ?? '31415'}`;

/**
 * Create a test project with a launch.json already written BEFORE the project
 * is registered with the daemon. This ensures useLaunchConfig reads it on first mount.
 */
async function createProjectWithLaunchConfig(page: Page): Promise<ProjectFixture> {
  const tmpBase = path.join(homedir(), 'tmp');
  mkdirSync(tmpBase, { recursive: true });
  const projectPath = realpathSync(mkdtempSync(path.join(tmpBase, 'mf-e2e-')));

  execSync('git init && git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });

  writeFileSync(path.join(projectPath, 'CLAUDE.md'), '# E2E Test\n');
  writeFileSync(path.join(projectPath, 'index.ts'), 'export const x = 1;\n');

  // Simple HTTP server for the preview process
  writeFileSync(
    path.join(projectPath, '__test_server.js'),
    `const http = require('http');
const port = process.env.PORT || 4567;
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end('<html><body><h1 id="heading">Test Running</h1></body></html>');
});
server.listen(port, () => console.log('server listening on port ' + port));
`,
  );

  const mainframeDir = path.join(projectPath, '.mainframe');
  mkdirSync(mainframeDir, { recursive: true });
  writeFileSync(
    path.join(mainframeDir, 'launch.json'),
    JSON.stringify(
      {
        version: '1',
        configurations: [
          {
            name: 'Web',
            runtimeExecutable: 'node',
            runtimeArgs: ['__test_server.js'],
            port: 4567,
            url: 'http://localhost:4567',
            preview: true,
          },
          {
            name: 'Worker',
            runtimeExecutable: 'node',
            runtimeArgs: ['-e', 'console.log("worker output"); setTimeout(() => {}, 60000)'],
            port: null,
            url: null,
          },
        ],
      },
      null,
      2,
    ),
  );

  await openPickerAndSelectPath(page, projectPath);

  const projectName = path.basename(projectPath);
  await page
    .locator('[data-testid="project-selector"]')
    .getByText(projectName, { exact: true })
    .waitFor({ timeout: 5_000 });

  const res = await page.request.get(`${DAEMON_BASE}/api/projects`);
  const { data: projects } = (await res.json()) as { data: { id: string; path: string }[] };
  const found = projects.find((p) => p.path === projectPath);
  if (!found) throw new Error(`Project not found: ${projectPath}`);

  return { projectPath, projectId: found.id };
}

async function stopAllProcesses(projectId: string): Promise<void> {
  try {
    const res = await fetch(`${DAEMON_BASE}/api/projects/${projectId}/launch/status`);
    if (!res.ok) return;
    const { data } = (await res.json()) as { data: Record<string, string> };
    await Promise.allSettled(
      Object.entries(data)
        .filter(([, status]) => status === 'running' || status === 'starting')
        .map(([name]) =>
          fetch(`${DAEMON_BASE}/api/projects/${projectId}/launch/${encodeURIComponent(name)}/stop`, {
            method: 'POST',
          }),
        ),
    );
  } catch {
    // best-effort
  }
}

test.describe('§28 Sandbox launch configurations', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: ProjectFixture;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createProjectWithLaunchConfig(fixture.page);
  });

  test.afterAll(async () => {
    if (project?.projectId) await stopAllProcesses(project.projectId);
    if (project) await cleanupProject(project);
    if (fixture) await closeApp(fixture);
  });

  // --- Config selector in title bar ---

  test('title bar shows selected launch config name', async () => {
    const selector = fixture.page.locator('[data-testid="launch-config-selector"]');
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await expect(selector).toContainText('Web', { timeout: 5_000 });
  });

  test('launch popover lists all configurations', async () => {
    await fixture.page.locator('[data-testid="launch-config-selector"]').click();
    const popover = fixture.page.locator('[data-testid="launch-popover"]');
    await expect(popover).toBeVisible({ timeout: 5_000 });

    await expect(popover.locator('[data-testid="launch-config-Web"]')).toBeVisible();
    await expect(popover.locator('[data-testid="launch-config-Worker"]')).toBeVisible();

    // Close popover
    await fixture.page.locator('body').click({ position: { x: 10, y: 200 }, force: true });
    await expect(popover).toBeHidden({ timeout: 3_000 });
  });

  // --- Start Worker process via title bar UI ---

  test('selecting Worker and clicking Start opens bottom panel with console output', async () => {
    // Select Worker in the launch config dropdown
    await fixture.page.locator('[data-testid="launch-config-selector"]').click();
    await fixture.page.locator('[data-testid="launch-config-Worker"]').click();

    // Config selector should now show "Worker"
    await expect(fixture.page.locator('[data-testid="launch-config-selector"]')).toContainText('Worker');

    // Click the Start button in the title bar
    await fixture.page.locator('[data-testid="launch-start-btn"]').click();

    // Stop button should appear (process is running)
    await expect(fixture.page.locator('[data-testid="launch-stop-btn"]')).toBeVisible({
      timeout: 15_000,
    });

    // Bottom panel should be open with the preview tab
    const previewTab = fixture.page.locator('[data-testid="preview-tab"]');
    await expect(previewTab).toBeVisible({ timeout: 10_000 });

    // Console should show worker output
    const consoleOutput = fixture.page.locator('[data-testid="preview-console-output"]');
    await expect(consoleOutput).toBeVisible({ timeout: 5_000 });
    await expect(consoleOutput).toContainText('worker output', { timeout: 10_000 });
  });

  // --- Status API ---

  test('status API reflects running Worker process', async () => {
    const res = await fixture.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/status`);
    expect(res.ok()).toBe(true);
    const { data } = (await res.json()) as { data: Record<string, string> };
    expect(data['Worker']).toBe('running');
  });

  test('stopping Worker via API clears status', async () => {
    await fixture.page.request.post(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/Worker/stop`);

    const res = await fixture.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/status`);
    const { data } = (await res.json()) as { data: Record<string, string> };
    expect(data['Worker']).toBeUndefined();
  });

  // --- Preview process (Web with HTTP server) ---

  test('starting Web preview via UI shows server output', async () => {
    // Select Web in the dropdown
    await fixture.page.locator('[data-testid="launch-config-selector"]').click();
    await fixture.page.locator('[data-testid="launch-config-Web"]').click();

    // Start via title bar button
    await fixture.page.locator('[data-testid="launch-start-btn"]').click();

    // Stop button should appear
    await expect(fixture.page.locator('[data-testid="launch-stop-btn"]')).toBeVisible({
      timeout: 15_000,
    });

    // Switch to the Web tab in the bottom panel (Worker may still be selected)
    const previewTab = fixture.page.locator('[data-testid="preview-tab"]');
    await previewTab.getByRole('tab', { name: 'Web' }).click();

    // The Web tab has preview=true, so console starts collapsed. Expand it.
    const expandBtn = previewTab.getByTitle(/expand logs|collapse logs/i);
    await expandBtn.click();

    // Console should show server output
    const consoleOutput = fixture.page.locator('[data-testid="preview-console-output"]');
    await expect(consoleOutput).toContainText('server listening', { timeout: 15_000 });
  });

  test('stop and restart preview process works via API', async () => {
    // Stop
    await fixture.page.request.post(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/Web/stop`);

    const statusRes = await fixture.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/status`);
    const { data: stopped } = (await statusRes.json()) as { data: Record<string, string> };
    expect(stopped['Web']).toBeUndefined();

    // Restart
    const startRes = await fixture.page.request.post(
      `${DAEMON_BASE}/api/projects/${project.projectId}/launch/Web/start`,
    );
    expect(startRes.ok()).toBe(true);

    const statusRes2 = await fixture.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/status`);
    const { data: restarted } = (await statusRes2.json()) as { data: Record<string, string> };
    expect(restarted['Web']).toBe('running');
  });

  // --- Error cases ---

  test('start returns 404 for nonexistent config name', async () => {
    const res = await fixture.page.request.post(
      `${DAEMON_BASE}/api/projects/${project.projectId}/launch/Nonexistent/start`,
    );
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('not found');
  });

  test('start returns 404 for nonexistent project', async () => {
    const res = await fixture.page.request.post(`${DAEMON_BASE}/api/projects/nonexistent-id/launch/Web/start`);
    expect(res.status()).toBe(404);
  });

  test('stop is idempotent for already-stopped process', async () => {
    // Stop the running Web process
    await fixture.page.request.post(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/Web/stop`);
    // Stop again
    const res = await fixture.page.request.post(`${DAEMON_BASE}/api/projects/${project.projectId}/launch/Web/stop`);
    expect(res.ok()).toBe(true);
  });
});
