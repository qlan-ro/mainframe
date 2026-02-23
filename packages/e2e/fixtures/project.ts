import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import type { Page } from '@playwright/test';

const DAEMON_BASE = `http://localhost:${process.env['PORT'] ?? '31415'}`;

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
  const project = (await res.json()) as { id: string };

  // Wait for the project to appear in the title bar
  await page.locator(`[data-testid="project-selector"]`).waitFor({ timeout: 5_000 });

  return { projectPath, projectId: project.id };
}

export async function cleanupProject({ projectPath }: ProjectFixture): Promise<void> {
  rmSync(projectPath, { recursive: true, force: true });
}
