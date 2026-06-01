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
    // createTestProject leaves the seed files (CLAUDE.md/index.ts/utils.ts) untracked. Commit them so
    // the working tree is clean: a dirty tree makes Checkout call window.confirm("uncommitted
    // changes"), and Electron's native confirm doesn't reliably reach Playwright's dialog handler
    // under headless xvfb — the checkout then aborts and the status bar never switches (only B6 hits
    // this path; rename/delete don't). A clean tree skips the prompt entirely.
    git('git add -A');
    git('git -c user.email=e2e@mainframe.test -c user.name="Mainframe E2E" commit -m "seed working tree"');
    // Seed extra local branches on the test repo (createTestProject made the repo + initial commit).
    git('git branch feat/alpha');
    git('git branch feat/beta');
    git('git branch feat/gamma');
    // Activate the project so the status-bar branch button renders.
    await createTestChat(fixture.page, project.projectId, 'default');
    // Fresh profile shows the first-run tutorial; at 1280×720 its step-3 card overlaps the *center*
    // of the branch submenu's Checkout item (Rename/Delete sit below it, which is why only B6 failed
    // headlessly — Playwright clicks the occluded center and the overlay eats it). Skip it.
    const skip = fixture.page.locator('[data-testid="tutorial-skip-btn"]');
    if (await skip.isVisible().catch(() => false)) await skip.click();
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
    const { page } = fixture;
    const statusBar = page.locator('[data-testid="status-bar-branch"]');
    const checkout = page.locator('[data-testid="branch-submenu-item-checkout"]');
    // On a loaded headless runner the prior branch-create leaves the list reloading, so the submenu
    // briefly repositions and the Checkout item renders disabled (`busy`). A single click then either
    // races the stability gate or no-ops on the disabled button (nothing gets checked out). Retry the
    // whole open → select → checkout until the branch actually switches; toBeEnabled waits out `busy`.
    await expect(async () => {
      await openBranchPopover();
      await page.locator('[data-testid="branch-row-select-feat/alpha"]').click();
      await expect(page.locator('[data-testid="branch-submenu-dialog"]')).toBeVisible({ timeout: 3_000 });
      await expect(checkout).toBeEnabled({ timeout: 3_000 });
      await checkout.click();
      await expect(statusBar).toContainText('feat/alpha', { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
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
