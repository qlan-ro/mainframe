/**
 * §title-bar — the title bar's right cluster and the per-tab surface actions
 * that replaced `ChatCardHeader`.
 *
 * Formerly `chat-header.spec.ts` (Cluster B, spec #14 of
 * docs/plans/2026-07-03-tauri-e2e-test-plan.md). Retargeted whole for the shell
 * redesign (docs/plans/2026-10-04-mainframe-redesign-adoption.md D7): `ChatCardHeader`
 * is gone — `ChatZone`/`ChatSurface` start at the transcript, with no header row of
 * their own. Its controls moved:
 *   - the model chip is DROPPED (capability moved to the composer's own model chip,
 *     which already carries model · context · effort — composer.spec.ts's territory);
 *   - Hide Chat is an item on every session tab's right-click context menu
 *     (`SessionTabContextMenu.tsx`'s `SurfaceMenuActions`); Split Right / Split
 *     Down were removed — the title bar's surface toggle lights the workspace;
 *   - the Review entry point moved into the session panel's Changes row (its own
 *     worktree-gating coverage lives in session-panel.spec.ts / review-panel.spec.ts);
 *   - the fork-parent link and side-chat toggle moved into `title-bar-actions`
 *     (single view) or each zone's `ZoneStrip` (visible split) — side-chat.spec.ts /
 *     fork specs cover those testids at their new mounts;
 *   - the session-details toggle moved again: it lives in each chat column's
 *     header (`session-panel-toggle`) — session-panel.spec.ts covers it.
 *
 * Source read: packages/ui/src/layout/{TitleBar,TitleBarActions}.tsx,
 * packages/ui/src/features/session-tabs/{SessionTabContextMenu,SessionTabPill,
 * use-session-tab-handlers}.tsx, packages/ui/src/features/session-panel/
 * {SessionPanelToggle,panel-control-store}.ts, packages/ui/src/store/layout.ts,
 * packages/ui/src/store/layout-placement.ts (isSurfaceFloor).
 *
 * Testid reference (all verified against source):
 *   title-bar / title-bar-sidebar-segment / title-bar-chat-column / title-bar-trailing /
 *   title-bar-workspace / title-bar-actions, and title-bar-separator-{sidebar,workspace,actions}
 *   session-tab-<id>         — right-click target (role=tab); opens `SessionTabContextMenu`
 *   session-tab-ctx-hide-chat — always rendered; `disabled` (Radix `data-disabled`) while
 *                               chat is the only lit surface (the dynamic floor)
 *   surface-rail-<chat|workspace> / workspace-surface — layout.spec.ts's
 *                               own testids, referenced here only to observe hide effects
 *   [data-surface="chat|workspace"] — layout engine's per-surface panel wrapper
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { workspace } from '../helpers/tauri/page-objects.js';

// ─── Hide-Chat control (dynamic floor, tab context menu) ─────────────────────

test.describe('§title-bar — hide-chat control (dynamic floor, tab context menu)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  async function openTabMenu(page: Page) {
    await page.getByTestId(`session-tab-${chatId}`).click({ button: 'right' });
    const hideItem = page.getByTestId('session-tab-ctx-hide-chat');
    await expect(hideItem).toBeVisible({ timeout: 5_000 });
    return hideItem;
  }

  test('disabled while Chat is the only lit surface', async () => {
    const { page } = app;
    const hideItem = await openTabMenu(page);
    await expect(hideItem).toHaveAttribute('data-disabled', '');
    await page.keyboard.press('Escape');
  });

  test('enabled once the workspace is lit (⌘/Ctrl+Shift+W), and hides the chat surface when clicked', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+Shift+W');
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const hideItem = await openTabMenu(page);
    await expect(hideItem).not.toHaveAttribute('data-disabled', '');
    await hideItem.click();

    await expect(page.locator('[data-surface="chat"]')).toHaveCount(0);
    // Files remains the sole lit surface.
    await expect(page.getByTestId('workspace-surface')).toBeVisible();
  });
});

// ─── Segments line up with the columns below (W1) ─────────────────────────────

test.describe('§title-bar — separators stand on the column edges', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  const left = async (page: Page, selector: string) =>
    (await page.locator(selector).evaluate((el) => el.getBoundingClientRect().left)) as number;
  const separator = (name: string) => `[data-testid="title-bar-separator-${name}"]`;

  /** A separator covers the one pixel left of its column, where the column's own hairline is. */
  async function expectOnEdge(page: Page, name: string, column: string) {
    await expect
      .poll(async () => Math.abs((await left(page, column)) - 1 - (await left(page, separator(name)))))
      .toBeLessThan(0.5);
  }

  test('the first stands on the sidebar edge, and follows the capsule once the sidebar is collapsed', async () => {
    const { page } = app;
    await expectOnEdge(page, 'sidebar', '[data-testid="main-surface-shell"]');

    await page.keyboard.press('ControlOrMeta+B');
    const capsule = page.getByTestId('usage-capsule');
    await expect
      .poll(async () => {
        const box = (await capsule.boundingBox())!;
        return (await left(page, separator('sidebar'))) - (box.x + box.width);
      })
      .toBe(12);
    await page.keyboard.press('ControlOrMeta+B');
    await expectOnEdge(page, 'sidebar', '[data-testid="main-surface-shell"]');
  });

  test('the second stands on the workspace edge through a divider drag; the third closes the segment', async () => {
    const { page } = app;
    await expect(page.locator(separator('workspace'))).toHaveCount(0);
    await page.getByTestId('surface-rail-workspace').click();
    await expectOnEdge(page, 'workspace', '[data-surface="workspace"]');

    const divider = (await page.getByTestId('surf-divider-x').boundingBox())!;
    const before = await left(page, separator('workspace'));
    await page.mouse.move(divider.x, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x - 90, divider.y + divider.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(before - (await left(page, separator('workspace')))).toBeGreaterThan(60);
    await expectOnEdge(page, 'workspace', '[data-surface="workspace"]');

    const [files, third, search] = await Promise.all([
      left(page, '[data-testid="workspace-files-open"]'),
      left(page, separator('actions')),
      left(page, '[data-testid="main-toolbar-search"]'),
    ]);
    expect(files).toBeLessThan(third);
    expect(third).toBeLessThan(search);
  });
});

// ─── Segments at their limits (W1, W2) ────────────────────────────────────────

test.describe('§title-bar — segments at their limits', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    for (const file of ['UsageCapsule.tsx', 'quota.rs', 'use-quota.ts']) {
      writeFileSync(path.join(project.projectPath, file), '// seeded\n');
    }
    await createTauriChat(app.page, project.projectId, 'default');
    await app.page.setViewportSize({ width: 1200, height: 800 });
    await app.page.getByTestId('surface-rail-workspace').click();
    for (const file of ['UsageCapsule.tsx', 'quota.rs', 'use-quota.ts']) {
      await workspace(app.page).openFilePicker();
      await app.page.getByTestId('file-picker-input').fill(file);
      await app.page.locator('[data-testid^="file-picker-row-"]').filter({ hasText: file }).first().click();
      await workspace(app.page).tab(file).dblclick();
    }
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  async function dragDivider(page: Page, x: number) {
    const box = (await page.getByTestId('surf-divider-x').boundingBox())!;
    await page.mouse.move(box.x, 400);
    await page.mouse.down();
    await page.mouse.move(x, 400, { steps: 5 });
    await page.mouse.up();
  }

  async function dragSidebar(page: Page, width: number) {
    const edge = (await page.getByTestId('main-surface-shell').boundingBox())!.x;
    await page.mouse.move(edge - 4, 400);
    await page.mouse.down();
    await page.mouse.move(56 + width - 4, 400, { steps: 8 });
    await page.mouse.up();
  }

  const edges = (page: Page) =>
    page.evaluate(() => {
      const box = (id: string) => document.querySelector(id)!.getBoundingClientRect();
      const panel = box('[data-surface="workspace"]');
      return {
        sidebarOff:
          box('[data-testid="main-surface-shell"]').left - 1 - box('[data-testid="title-bar-separator-sidebar"]').left,
        workspaceOff: panel.left - 1 - box('[data-testid="title-bar-separator-workspace"]').left,
        panelOverflow: panel.right - window.innerWidth,
        togglesOverflow: box('[data-testid="surface-rail"]').right - window.innerWidth,
      };
    });

  /** Separators on their edges, the panel and the toggles inside the window. */
  async function expectAligned(page: Page) {
    await expect
      .poll(async () => {
        const e = await edges(page);
        return Math.max(Math.abs(e.sidebarOff), Math.abs(e.workspaceOff), e.panelOverflow, e.togglesOverflow);
      })
      .toBeLessThan(0.5);
  }

  test('follows a clamped panel that moves without resizing', async () => {
    const { page } = app;
    await page.setViewportSize({ width: 920, height: 800 });
    await expectAligned(page);
    for (const width of [880, 800]) {
      await page.setViewportSize({ width, height: 800 });
      expect((await page.locator('[data-surface="workspace"]').boundingBox())!.width).toBeCloseTo(320, 0);
      await expectAligned(page);
    }
  });

  test('follows the panel at the divider minimum, both ways, with the toggles on screen', async () => {
    const { page } = app;
    await page.setViewportSize({ width: 1200, height: 800 });
    await dragDivider(page, 1190);
    await expectAligned(page);
    for (const width of [1400, 1200, 800, 1200]) {
      await page.setViewportSize({ width, height: 800 });
      await expectAligned(page);
    }
  });

  test('stands on the sidebar edge at its narrowest and widest, in the smallest window', async () => {
    const { page } = app;
    await page.setViewportSize({ width: 1200, height: 800 });
    await dragSidebar(page, 100);
    expect((await page.getByTestId('main-surface-shell').boundingBox())!.x).toBe(56 + 208);
    await expectAligned(page);

    await dragSidebar(page, 700);
    expect((await page.getByTestId('main-surface-shell').boundingBox())!.x).toBe(56 + 480);
    await page.setViewportSize({ width: 800, height: 800 });
    await expectAligned(page);

    await page.setViewportSize({ width: 1200, height: 800 });
    await dragSidebar(page, 260);
    await expectAligned(page);
  });

  test('is dragged from the chat side only, clear of a native webview in the panel', async () => {
    const { page } = app;
    const grabs = await page.evaluate(() => {
      const left = document.querySelector('[data-surface="workspace"]')!.getBoundingClientRect().left;
      const divider = document.querySelector('[data-testid="surf-divider-x"]')!;
      return [-9, -5, -1, 0, 4].map((dx) => divider.contains(document.elementFromPoint(left + dx + 0.5, 400)));
    });
    expect(grabs).toEqual([true, true, true, false, false]);
  });

  test('shrinks the other tabs to 60px and never truncates the selected one', async () => {
    const { page } = app;
    await page.setViewportSize({ width: 1200, height: 800 });
    await dragDivider(page, 760);
    await workspace(page).tab('UsageCapsule.tsx').click();
    const title = workspace(page)
      .tab('UsageCapsule.tsx')
      .getByTestId(/^workspace-tab-title-/);
    await expect.poll(() => title.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    for (const file of ['quota.rs', 'use-quota.ts']) {
      expect((await workspace(page).tab(file).boundingBox())!.width).toBeGreaterThanOrEqual(60);
    }

    await dragDivider(page, 900);
    const widths = await Promise.all(
      ['quota.rs', 'use-quota.ts'].map(async (file) => (await workspace(page).tab(file).boundingBox())!.width),
    );
    expect(Math.min(...widths)).toBe(60);
  });

  test('keeps the selected tab and its close button inside the row at the 320px panel', async () => {
    const { page } = app;
    await page.setViewportSize({ width: 1200, height: 800 });
    await dragDivider(page, 1190);
    const overhang = (file: string) =>
      page.evaluate((name) => {
        const tab = [...document.querySelectorAll<HTMLElement>('[data-testid^="workspace-tab-"][role="tab"]')].find(
          (el) => el.textContent!.includes(name),
        )!;
        const row = tab.closest('[role="tablist"]')!.getBoundingClientRect();
        const close = tab.querySelector('[data-tab-close]')!.getBoundingClientRect();
        return { close: close.right - row.right, start: row.left - tab.getBoundingClientRect().left };
      }, file);
    for (const file of ['use-quota.ts', 'UsageCapsule.tsx']) {
      await workspace(page).tab(file).click();
      await expect.poll(async () => Math.max(...Object.values(await overhang(file)))).toBeLessThan(0.5);
    }
    // A short name fits whole even here; a longer one fades rather than losing its close button.
    const title = workspace(page)
      .tab('quota.rs')
      .getByTestId(/^workspace-tab-title-/);
    await workspace(page).tab('quota.rs').click();
    await expect.poll(() => title.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  });
});

// ─── PR-link chips (unseedable in browser mode) ───────────────────────────────

test.describe('§title-bar — PR link chips', () => {
  test('PR chip renders for a chat with a detected PR', async () => {
    test.skip(
      true,
      'TODO(recording): the detected-PR row (now `session-panel-summary-pr-<number>` in the ' +
        "session panel's Pull requests section, PullRequestsSection.tsx — the header never had " +
        'its own PR chips) is driven by custom.detectedPrs, which is only populated by the ' +
        "daemon's PR-detection background service (reading git/gh against a real remote). There " +
        'is no REST route to seed it directly (grepped packages/core/src/server/routes for ' +
        'detectedPrs) and no recording can substitute for a git-remote/gh state. Needs either a ' +
        'REST test-seam or a live git+gh fixture to unskip — tracked identically in ' +
        "session-panel.spec.ts's own note.",
    );
  });
});
