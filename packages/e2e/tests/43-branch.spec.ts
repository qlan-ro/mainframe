import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage from scenarios/branch.md (B1, B2, B10, B6, B12, B13). No AI — real git operations
// on the seeded test repo. Tests run serially and share the popover/app state.
test.describe('§43 Branch popover', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  const git = (cmd: string): string => execSync(cmd, { cwd: project.projectPath, stdio: 'pipe' }).toString();

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    // Seed extra local branches on the test repo (createTestProject made the repo + initial commit).
    git('git branch feat/alpha');
    git('git branch feat/beta');
    git('git branch feat/gamma');
    // Activate the project so the status-bar branch button renders.
    await createTestChat(fixture.page, project.projectId, 'default');
    // Auto-accept confirm() dialogs (delete / dirty-checkout confirmations).
    fixture.page.on('dialog', (d) => {
      void d.accept().catch(() => {});
    });
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  const searchInput = () => fixture.page.locator('[data-testid="branch-popover-search-input"]');

  async function openBranchPopover(): Promise<void> {
    // branch-button TOGGLES the popover and its branch list re-renders async, so a single
    // isVisible-then-click races (a click can toggle an open popover shut). Retry until open.
    const input = searchInput();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await input.isVisible().catch(() => false)) return;
      await fixture.page.locator('[data-testid="branch-button"]').click();
      try {
        await input.waitFor({ state: 'visible', timeout: 4_000 });
        return;
      } catch {
        /* toggle raced — retry */
      }
    }
    await expect(input).toBeVisible({ timeout: 5_000 });
  }

  test('B1: opens and closes the branch popover', async () => {
    await fixture.page.locator('[data-testid="branch-button"]').click();
    await expect(searchInput()).toBeVisible({ timeout: 10_000 });
    await fixture.page.keyboard.press('Escape');
    await expect(searchInput()).toHaveCount(0);
  });

  test('B2: search filters the branch list', async () => {
    await openBranchPopover();
    await searchInput().fill('alpha');
    await expect(fixture.page.locator('[data-testid="branch-row-select-feat/alpha"]')).toBeVisible({ timeout: 5_000 });
    await expect(fixture.page.locator('[data-testid="branch-row-select-feat/beta"]')).toHaveCount(0);
    await searchInput().fill('');
  });

  test('B10: create a new branch', async () => {
    await openBranchPopover();
    await fixture.page.locator('[data-testid="branch-popover-new-branch"]').click();
    await fixture.page.locator('[data-testid="new-branch-name-input"]').fill('feat/delta');
    await fixture.page.locator('[data-testid="new-branch-create"]').click();
    await expect(() => expect(git('git branch')).toContain('feat/delta')).toPass({ timeout: 10_000 });
  });

  test('B6: checkout a branch updates the status bar', async () => {
    await openBranchPopover();
    await fixture.page.locator('[data-testid="branch-row-select-feat/alpha"]').click();
    // Selecting a row switches the popover to its submenu view, which resizes/repositions it. On a
    // loaded headless runner that reposition keeps the checkout item "unstable" for Playwright's
    // actionability check (it resolves the element but never settles). Wait for the submenu dialog,
    // then force the click past the stability gate (we've already asserted it's visible).
    await expect(fixture.page.locator('[data-testid="branch-submenu-dialog"]')).toBeVisible({ timeout: 5_000 });
    const checkout = fixture.page.locator('[data-testid="branch-submenu-item-checkout"]');
    await expect(checkout).toBeVisible({ timeout: 5_000 });
    await checkout.click({ force: true });
    await expect(fixture.page.locator('[data-testid="status-bar-branch"]')).toContainText('feat/alpha', {
      timeout: 10_000,
    });
  });

  test('B12: rename a branch', async () => {
    await openBranchPopover();
    await fixture.page.locator('[data-testid="branch-row-select-feat/beta"]').click();
    await fixture.page.locator('[data-testid="branch-submenu-item-rename"]').click();
    await fixture.page.locator('[data-testid="rename-branch-name-input"]').fill('feat/beta-renamed');
    await fixture.page.locator('[data-testid="rename-branch-rename"]').click();
    await expect(() => expect(git('git branch')).toContain('feat/beta-renamed')).toPass({ timeout: 10_000 });
  });

  test('B13: delete a branch (with confirm)', async () => {
    await openBranchPopover();
    await fixture.page.locator('[data-testid="branch-row-select-feat/gamma"]').click();
    await fixture.page.locator('[data-testid="branch-submenu-item-delete-branch"]').click();
    await expect(() => expect(git('git branch')).not.toContain('feat/gamma')).toPass({ timeout: 10_000 });
  });
});
