import { mkdtempSync, writeFileSync, rmSync, realpathSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import type { Page } from '@playwright/test';
import { DAEMON_PORT } from './app.js';

// Use 127.0.0.1 explicitly — localhost resolves to ::1 (IPv6) first on macOS/Node 17+,
// but the daemon binds to 127.0.0.1 (IPv4) only. Share the harness port (default 31416) so this
// never points at a different daemon than the one launchApp() started.
const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

export interface ProjectFixture {
  projectPath: string;
  projectId: string;
}

const DEFAULT_CLAUDE_MD =
  '# E2E Test Project\n\nThis is an automated test environment. Do not use plan mode. Do not call EnterPlanMode. Execute all tool calls directly without planning first.\n';

/**
 * Opens the project picker modal, navigates to projectPath (assumed to be a
 * direct child of ~/tmp), selects it, and clicks the Select button.
 * Caller is responsible for any assertions after this returns.
 */
export async function openPickerAndSelectPath(page: Page, projectPath: string): Promise<void> {
  const parentDir = path.dirname(projectPath);

  // Open the directory picker from the Sessions panel "add project" button.
  // (The old TitleBar project-selector → project-dropdown → "Add project" flow was
  // removed; projects now live in the Sessions panel and are added via this button.)
  await page.locator('[data-testid="chats-add-project"]').click();

  await page.locator('[data-testid="dir-picker-modal"]').waitFor({ timeout: 5_000 });
  await page.locator(`[data-testid="dir-entry-${parentDir}"]`).waitFor({ timeout: 5_000 });
  await page.locator(`[data-testid="dir-entry-${parentDir}"]`).click();
  await page.locator(`[data-testid="dir-entry-${projectPath}"]`).waitFor({ timeout: 5_000 });
  await page.locator(`[data-testid="dir-entry-${projectPath}"]`).click();
  await page.locator('[data-testid="dir-picker-select-btn"]').click();
}

export async function createTestProject(page: Page, options?: { claudeMd?: string }): Promise<ProjectFixture> {
  // Create temp directory inside home dir — the browse API restricts navigation to homedir().
  const tmpBase = path.join(homedir(), 'tmp');
  mkdirSync(tmpBase, { recursive: true });
  const projectPath = realpathSync(mkdtempSync(path.join(tmpBase, 'mf-e2e-')));

  // Init git repo with an initial commit so git status works
  execSync('git init && git commit --allow-empty -m "init"', {
    cwd: projectPath,
    stdio: 'pipe',
  });

  // Seed files the AI can work with
  writeFileSync(path.join(projectPath, 'CLAUDE.md'), options?.claudeMd ?? DEFAULT_CLAUDE_MD);
  writeFileSync(path.join(projectPath, 'index.ts'), 'export const greeting = "hello";\n');
  writeFileSync(path.join(projectPath, 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }\n');

  await openPickerAndSelectPath(page, projectPath);

  // Wait for the Sessions panel to show the newly registered project group
  const projectName = path.basename(projectPath);
  await page
    .locator('[data-testid="project-group-name"]', { hasText: projectName })
    .first()
    .waitFor({ timeout: 15_000 });

  // Fetch the project ID from the API
  const res = await page.request.get(`${DAEMON_BASE}/api/projects`);
  const { data: projects } = (await res.json()) as { data: { id: string; path: string }[] };
  const found = projects.find((p) => p.path === projectPath);
  if (!found) throw new Error(`Project not found in API after picker selection: ${projectPath}`);

  return { projectPath, projectId: found.id };
}

export async function cleanupProject({ projectPath }: ProjectFixture): Promise<void> {
  rmSync(projectPath, { recursive: true, force: true });
}
