import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { openZone, setChangesMode } from '../helpers/zones.js';

// New coverage from scenarios/files-editor-review.md (F3 next/prev-change). No AI.
// next/prev only render for a diff with >1 hunk, so we seed a committed file and change it in two
// well-separated places to produce a 2-hunk uncommitted diff.
test.describe('§56 File-view diff navigation', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    const file = path.join(project.projectPath, 'bigfile.ts');
    const base = Array.from({ length: 24 }, (_, i) => `const line${i} = ${i};`).join('\n') + '\n';
    writeFileSync(file, base);
    execSync('git add bigfile.ts && git commit -m "add bigfile"', { cwd: project.projectPath, stdio: 'pipe' });
    // Two separate edits → two hunks.
    const modified = base
      .replace('const line2 = 2;', 'const line2 = 222; // changed near top')
      .replace('const line20 = 20;', 'const line20 = 2020; // changed near bottom');
    writeFileSync(file, modified);

    await createTestChat(fixture.page, project.projectId, 'default');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('F3: next/prev-change navigate a multi-hunk diff', async () => {
    const { page } = fixture;
    await openZone(page, 'zone-rail-button-changes', 'zone-button-tab-dropdown');
    await setChangesMode(page, 'uncommitted');
    await page.locator('[data-testid="changes-refresh"]').click();
    await page.locator('[data-testid="changes-uncommitted-file-bigfile.ts"]').click();
    await expect(page.locator('.monaco-diff-editor').first()).toBeVisible({ timeout: 15_000 });

    // With >1 hunk, the navigation controls appear.
    const next = page.locator('[data-testid="fileview-next-change"]');
    const prev = page.locator('[data-testid="fileview-prev-change"]');
    await expect(next).toBeVisible({ timeout: 5_000 });
    await expect(prev).toBeVisible();
    await next.click();
    await next.click();
    await prev.click();
    // Still showing the diff after navigating (no crash).
    await expect(page.locator('.monaco-diff-editor').first()).toBeVisible();
  });
});
