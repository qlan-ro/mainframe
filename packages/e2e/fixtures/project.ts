import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import type { Page } from '@playwright/test';

// Use 127.0.0.1 explicitly — localhost resolves to ::1 (IPv6) first on macOS/Node 17+,
// but the daemon binds to 127.0.0.1 (IPv4) only.
const DAEMON_BASE = `http://127.0.0.1:${process.env['PORT'] ?? '31415'}`;

export interface ProjectFixture {
  projectPath: string;
  projectId: string;
}

export async function createTestProject(page: Page): Promise<ProjectFixture> {
  // Create temp directory
  const projectPath = mkdtempSync(path.join(tmpdir(), 'mf-e2e-'));

  // Init git repo with an initial commit so git status works
  execSync('git init && git commit --allow-empty -m "init"', {
    cwd: projectPath,
    stdio: 'pipe',
  });

  // Seed files the AI can work with
  writeFileSync(path.join(projectPath, 'CLAUDE.md'), '# E2E Test Project\n');
  writeFileSync(path.join(projectPath, 'index.ts'), 'export const greeting = "hello";\n');
  writeFileSync(path.join(projectPath, 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }\n');

  // Register project via daemon API (bypasses native OS picker)
  const res = await page.request.post(`${DAEMON_BASE}/api/projects`, {
    data: { path: projectPath },
  });
  if (!res.ok()) throw new Error(`Failed to register project: ${await res.text()}`);
  const { data: projectData } = (await res.json()) as { data: { id: string } };

  // The server has no project.added WebSocket broadcast, so the renderer's store
  // doesn't know about the new project until loadData() re-runs.
  // Reloading triggers loadData() which re-fetches all projects from the API.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page
    .locator('[data-testid="connection-status"]')
    .getByText('Connected', { exact: true })
    .waitFor({ timeout: 15_000 });

  // Open the project dropdown and activate the newly registered project.
  // Scope the click to the dropdown container to avoid strict-mode violations
  // when the same project name appears in both the selector button and the list.
  const projectName = path.basename(projectPath);
  await page.locator('[data-testid="project-selector"]').click();
  await page.locator('[data-testid="project-dropdown"]').getByText(projectName, { exact: true }).click();

  // Confirm the selector now shows this project as active
  await page
    .locator('[data-testid="project-selector"]')
    .getByText(projectName, { exact: true })
    .waitFor({ timeout: 5_000 });

  return { projectPath, projectId: projectData.id };
}

export async function cleanupProject({ projectPath }: ProjectFixture): Promise<void> {
  rmSync(projectPath, { recursive: true, force: true });
}
