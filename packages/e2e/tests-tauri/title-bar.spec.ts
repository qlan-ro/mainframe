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
 *   - Split Right / Split Down / Hide Chat are now items on every session tab's
 *     right-click context menu (`SessionTabContextMenu.tsx`'s `SurfaceMenuActions`),
 *     next to the tab's own `session-tab-ctx-open-split`;
 *   - the Review entry point moved into the session panel's Changes row (its own
 *     worktree-gating coverage lives in session-panel.spec.ts / review-panel.spec.ts);
 *   - the fork-parent link and side-chat toggle moved into `title-bar-actions`
 *     (single view) or each zone's `ZoneStrip` (visible split) — side-chat.spec.ts /
 *     fork specs cover those testids at their new mounts;
 *   - the session-details toggle (`title-bar-details`) is new (D8) — the panel's
 *     ONLY switch now that the floating rail is gone.
 *
 * Source read: packages/ui/src/layout/{TitleBar,TitleBarActions}.tsx,
 * packages/ui/src/features/session-tabs/{SessionTabContextMenu,SessionTabPill,
 * use-session-tab-handlers}.tsx, packages/ui/src/features/session-panel/
 * {SessionPanelToggle,panel-control-store}.ts, packages/ui/src/store/layout.ts,
 * packages/ui/src/store/layout-placement.ts (layoutCanSplit/isSurfaceFloor).
 *
 * Testid reference (all verified against source):
 *   title-bar / title-bar-sidebar-section / title-bar-chat-column / title-bar-actions
 *   title-bar-details        — the session-details toggle; `aria-pressed` mirrors the
 *                               persisted open bit (ui-prefs `sessionPanelOpen`)
 *   session-tab-<id>         — right-click target (role=tab); opens `SessionTabContextMenu`
 *   session-tab-ctx-split-right / -split-down — surface split actions. CONDITIONALLY
 *                               rendered (`surface.canSplit`), not merely disabled — with
 *                               two surfaces lit there is nothing left to split to, so the
 *                               items are absent from the menu entirely until the workspace
 *                               is hidden again
 *   session-tab-ctx-hide-chat — always rendered; `disabled` (Radix `data-disabled`) while
 *                               chat is the only lit surface (the dynamic floor)
 *   surface-rail-<chat|workspace> / workspace-surface / workspace-surface-close — layout.spec.ts's
 *                               own testids, referenced here only to observe split/hide effects
 *   [data-surface="chat|workspace"] — layout engine's per-surface panel wrapper
 *
 * SurfaceId is 'chat' | 'workspace' since the 2026-08-05 Files+Run merge, so there
 * is exactly one surface to split to and the split items vanish from the menu once
 * it is placed (packages/ui/CLAUDE.md, "Surface model").
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

// ─── Session-details toggle (D8) ──────────────────────────────────────────────

test.describe('§title-bar — session-details toggle', () => {
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

  test('toggles the session panel open and closed; aria-pressed mirrors the state', async () => {
    const { page } = app;
    const toggle = page.getByTestId('title-bar-details');
    const panel = page.getByTestId('session-panel-root');

    // The panel auto-opens the first time the column fits (default true), so
    // read the starting state rather than assuming either value.
    const startedOpen = (await toggle.getAttribute('aria-pressed')) === 'true';
    if (startedOpen) await expect(panel).toBeVisible();
    else await expect(panel).toHaveCount(0);

    await toggle.click();
    if (startedOpen) {
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(panel).toHaveCount(0, { timeout: 5_000 });
    } else {
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(panel).toBeVisible({ timeout: 5_000 });
    }

    // Toggle back to the starting state for tests that follow.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(startedOpen));
  });
});

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

// ─── Split controls (tab context menu) ────────────────────────────────────────

test.describe('§title-bar — split controls (tab context menu)', () => {
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

  /**
   * With two surfaces there is exactly one thing to split TO, so `layoutCanSplit`
   * (store/layout-placement.ts) is false the moment the workspace is placed and the
   * split items disappear from the tab's context menu entirely. Hiding it
   * un-places it and brings them back.
   */
  async function collapseToChatOnly(page: Page): Promise<void> {
    const hideWorkspace = page.getByTestId('workspace-surface-close');
    if ((await hideWorkspace.count()) > 0) await hideWorkspace.first().click();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0, { timeout: 5_000 });
    await page.getByTestId(`session-tab-${chatId}`).click({ button: 'right' });
    await expect(page.getByTestId('session-tab-ctx-split-right')).toBeVisible();
    await page.keyboard.press('Escape');
  }

  test('split-right lights the workspace beside Chat in the top row', async () => {
    const { page } = app;
    await collapseToChatOnly(page);
    await page.getByTestId(`session-tab-${chatId}`).click({ button: 'right' });
    await page.getByTestId('session-tab-ctx-split-right').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-surface="chat"]').boundingBox();
    const workspaceBox = await page.locator('[data-surface="workspace"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    // Same row: comparable y, Chat stays leftmost.
    expect(Math.abs(chatBox!.y - workspaceBox!.y)).toBeLessThan(5);
    expect(chatBox!.x).toBeLessThan(workspaceBox!.x);

    // Nothing left to split to — both items vanish from the menu until the
    // workspace is hidden again.
    await page.getByTestId(`session-tab-${chatId}`).click({ button: 'right' });
    await expect(page.getByTestId('session-tab-ctx-split-right')).toHaveCount(0);
    await expect(page.getByTestId('session-tab-ctx-split-down')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('split-down docks the workspace in the bottom strip', async () => {
    const { page } = app;
    await collapseToChatOnly(page);
    await page.getByTestId(`session-tab-${chatId}`).click({ button: 'right' });
    await page.getByTestId('session-tab-ctx-split-down').click();
    await expect(page.getByTestId('workspace-surface')).toBeVisible({ timeout: 5_000 });

    const chatBox = await page.locator('[data-surface="chat"]').boundingBox();
    const workspaceBox = await page.locator('[data-surface="workspace"]').boundingBox();
    expect(chatBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    // The strip spans the full width below the top row, so Chat keeps the whole row.
    expect(workspaceBox!.y).toBeGreaterThan(chatBox!.y + chatBox!.height - 5);
    expect(Math.abs(workspaceBox!.x - chatBox!.x)).toBeLessThan(5);
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
