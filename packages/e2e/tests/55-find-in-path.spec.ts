import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { openZone } from '../helpers/zones.js';

// New coverage from scenarios/files-editor-review.md (F6 find-in-path). No AI. The files context
// menu is a React component (not native), so "Find in Path…" is clickable.
test.describe('§55 Find in path', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // Seed a subdirectory + file with a unique searchable token.
    const subDir = path.join(project.projectPath, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, 'extra.ts'), 'export const findMeInPathToken = 42;\n');

    await createTestChat(fixture.page, project.projectId, 'default');
    await openZone(fixture.page, 'zone-rail-button-files', 'files-root-toggle');
    // The root auto-expands, so the seeded sub/ directory node is already listed.
    await fixture.page.locator('[data-testid="files-tree-node-sub"]').waitFor({ timeout: 10_000 });
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('F6: find-in-path searches a directory and opens results', async () => {
    const { page } = fixture;
    // Right-click the directory → React context menu → "Find in Path…".
    await page.locator('[data-testid="files-tree-node-sub"]').click({ button: 'right' });
    await page.getByRole('button', { name: /Find in Path/ }).click();

    await expect(page.locator('[data-testid="find-in-path-modal"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="find-in-path-input"]').fill('findMeInPathToken');
    await expect(page.locator('[data-testid^="find-in-path-result-"]').first()).toBeVisible({ timeout: 10_000 });

    // include-ignored toggle is present for directory scope.
    await expect(page.locator('[data-testid="find-in-path-include-ignored"]')).toBeVisible();

    await page.locator('[data-testid="find-in-path-close"]').click();
    await expect(page.locator('[data-testid="find-in-path-modal"]')).toHaveCount(0);
  });
});
