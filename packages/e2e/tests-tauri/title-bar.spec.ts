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
 *   - the session-details toggle (`title-bar-details`) is new (D8) — the panel's
 *     ONLY switch now that the floating rail is gone.
 *
 * Source read: packages/ui/src/layout/{TitleBar,TitleBarActions}.tsx,
 * packages/ui/src/features/session-tabs/{SessionTabContextMenu,SessionTabPill,
 * use-session-tab-handlers}.tsx, packages/ui/src/features/session-panel/
 * {SessionPanelToggle,panel-control-store}.ts, packages/ui/src/store/layout.ts,
 * packages/ui/src/store/layout-placement.ts (isSurfaceFloor).
 *
 * Testid reference (all verified against source):
 *   title-bar / title-bar-sidebar-section / title-bar-chat-column / title-bar-actions
 *   title-bar-details        — the session-details toggle; `aria-pressed` mirrors the
 *                               persisted open bit (ui-prefs `sessionPanelOpen`)
 *   session-tab-<id>         — right-click target (role=tab); opens `SessionTabContextMenu`
 *   session-tab-ctx-hide-chat — always rendered; `disabled` (Radix `data-disabled`) while
 *                               chat is the only lit surface (the dynamic floor)
 *   surface-rail-<chat|workspace> / workspace-surface / workspace-surface-close — layout.spec.ts's
 *                               own testids, referenced here only to observe hide effects
 *   [data-surface="chat|workspace"] — layout engine's per-surface panel wrapper
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
    const toggle = page.getByTestId('session-panel-toggle');
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
