import { test, expect } from '@playwright/test';
import { rmSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';

// Minimal 1x1 red PNG — valid image, tiny payload
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// ─── Composer config selects (ported from §44) ────────────────────────────────
test.describe('§composer config selects @real', () => {
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

  test('M5: model select opens, lists models, and closes on pick', async () => {
    const { page } = app;
    await page.locator('[data-testid="composer-model-select"]').click();
    const options = page.locator('[data-testid^="composer-model-select-option-"]');
    await expect(options.first()).toBeVisible({ timeout: 5_000 });
    const count = await options.count();
    await options.nth(count - 1).click();
    await expect(options.first()).toHaveCount(0); // dropdown closed after pick
  });

  // TODO(bug): the `closeMenus()` before the reset click below is a WORKAROUND for a
  // real product wart, filed here because this is where it bites.
  //
  // Measured in Chromium (2026-08-06, throwaway Playwright probe reading the live DOM):
  // pick a mode, then click the chip again and the menu does NOT reopen — the trigger
  // stays `aria-expanded="false"`, `[role=menu]` count goes 1 → 0, and the very next
  // click opens it normally. The dropped click lands inside the window where Radix
  // still has the CLOSING menu's content mounted for its exit animation; waiting for
  // that content to unmount makes the reopen reliable every time. Not reproducible in
  // jsdom (a unit test of the same gesture passes), which is why no unit test caught it.
  //
  // For a user this reads as "the permission chip ignored my click" right after they
  // changed the mode. It is NOT a regression from the v2 port — the same swallow
  // reproduces on any Tooltip-wrapped DropdownMenuTrigger in the composer toolbar,
  // on the v1 primitive before #460 and on the v2 one since. Fixing it belongs in the primitive (or its Tooltip composition), not here;
  // when it is fixed, the `closeMenus()` on the reset click becomes redundant.
  test('M7: permission-mode select switches to Unattended (yolo)', async () => {
    const { page } = app;
    const trigger = page.locator('[data-testid="composer-permission-mode-select"]');
    await closeMenus();
    await trigger.click();
    await page.locator('[data-testid="composer-permission-mode-select-option-yolo"]').click();
    // The session's first switch to Unattended asks (C13).
    await page.getByTestId('composer-unattended-confirm-confirm').click();
    await expect(trigger).toContainText(/unattended/i, { timeout: 5_000 });
    // Reset to Interactive for cleanliness — only after the menu has actually
    // unmounted, per the TODO(bug) above.
    await closeMenus();
    await trigger.click();
    await page.locator('[data-testid="composer-permission-mode-select-option-default"]').click();
    await expect(trigger).toContainText(/interactive/i, { timeout: 5_000 });
  });

  // Tuning writes (effort/features) now broadcast `chat.updated` (core `applyChatTuning` →
  // `ChatManager.emitChatUpdated`), so the server-authoritative composer chip reflects them.
  /**
   * Reach a state where a picker trigger is actually clickable. Two hazards, both
   * measured in a live browser (2026-08-06):
   *
   *  1. While a modal Radix menu is open, its overlay owns `<html>`'s pointer
   *     events, so a test that left a menu (or a model row's tuning flyout) open
   *     makes the next trigger click unhittable. Escape unwinds one layer per press.
   *  2. Radix keeps a CLOSING menu's content mounted through its exit animation, and
   *     a trigger click inside that window is SWALLOWED — the menu never reopens
   *     (`aria-expanded` stays false; the click after it works). So picking an item
   *     is not enough: wait until no `[role=menu]` is left in the DOM.
   */
  async function closeMenus(): Promise<void> {
    const { page } = app;
    const menus = page.locator('[role="menu"]');
    for (let layer = 0; layer < 4 && (await menus.count()) > 0; layer++) {
      await page.keyboard.press('Escape');
    }
    await expect(menus).toHaveCount(0, { timeout: 5_000 });
  }

  /**
   * Effort and options sit below the model list, for the selected model only.
   * Selects the first candidate the menu offers and opens the menu on its
   * tuning; returns its id, or null when this environment exposes none.
   */
  async function openModelTuning(candidates: string[]): Promise<string | null> {
    const { page } = app;
    await closeMenus();
    await page.locator('[data-testid="composer-model-select"]').click();
    await expect(page.locator('[data-testid^="composer-model-select-option-"]').first()).toBeVisible({
      timeout: 10_000,
    });
    for (const id of candidates) {
      const row = page.locator(`[data-testid="composer-model-select-option-${id}"]`);
      if (!(await row.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
      await row.click();
      await closeMenus();
      await page.locator('[data-testid="composer-model-select"]').click();
      await expect(page.locator(`[data-testid="composer-model-${id}-tuning"]`)).toBeVisible({ timeout: 5_000 });
      return id;
    }
    return null;
  }

  const OPUS = ['claude-opus-4-5-20251001', 'opus'];
  const SONNET = ['claude-sonnet-4-5-20251101', 'sonnet'];
  const HAIKU = ['claude-haiku-4-5-20251001', 'haiku'];

  test("M6: a capable model's effort segment lists its declared levels", async () => {
    const { page } = app;
    const id = await openModelTuning([...OPUS, ...SONNET]);
    if (id == null) {
      test.skip(true, 'no effort-capable model found in this environment');
      return;
    }

    await expect(page.locator(`[data-testid="composer-model-${id}-effort-low"]`)).toBeVisible({ timeout: 5_000 });
    const high = page.locator(`[data-testid="composer-model-${id}-effort-high"]`);
    await expect(high).toBeVisible();

    // Picking an effort keeps the menu open, and the level reads as checked.
    await high.click();
    await expect(high).toHaveAttribute('aria-checked', 'true');
  });

  test('M6b: an opus-level model exposes xhigh and max', async () => {
    const { page } = app;
    const id = await openModelTuning(OPUS);
    if (id == null) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }

    await expect(page.locator(`[data-testid="composer-model-${id}-effort-xhigh"]`)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="composer-model-${id}-effort-max"]`)).toBeVisible();
    await closeMenus();
  });

  test('M6c: haiku shows no effort or options', async () => {
    const { page } = app;
    await closeMenus();
    await page.locator('[data-testid="composer-model-select"]').click();
    let found: string | null = null;
    for (const id of HAIKU) {
      const row = page.locator(`[data-testid="composer-model-select-option-${id}"]`);
      if (!(await row.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
      await row.click();
      found = id;
      break;
    }
    if (found == null) {
      test.skip(true, 'haiku model not found in this environment');
      return;
    }
    await closeMenus();
    await page.locator('[data-testid="composer-model-select"]').click();
    // No effort levels and no options, so there is nothing below the list.
    await expect(page.locator(`[data-testid="composer-model-${found}-tuning"]`)).toHaveCount(0);
    await closeMenus();
  });

  test('M6d: an opus-level model exposes all three options', async () => {
    const { page } = app;
    const id = await openModelTuning(OPUS);
    if (id == null) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }

    await expect(page.locator(`[data-testid="composer-model-${id}-feature-fast"]`)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="composer-model-${id}-feature-ultracode"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="composer-model-${id}-feature-adaptiveThinking"]`)).toBeVisible();
    await closeMenus();
  });

  test('M6e: enabling ultracode pins the effort to xhigh and freezes the levels', async () => {
    const { page } = app;
    const id = await openModelTuning(OPUS);
    if (id == null) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }

    const ultracode = page.locator(`[data-testid="composer-model-${id}-feature-ultracode"]`);
    await expect(ultracode).toBeVisible({ timeout: 5_000 });
    if ((await ultracode.getAttribute('aria-checked')) !== 'true') await ultracode.click();

    // The resolver coerces ultracode to xhigh, so the segment shows it checked and
    // every level inert — the effort is no longer the user's to set.
    const xhigh = page.locator(`[data-testid="composer-model-${id}-effort-xhigh"]`);
    await expect(xhigh).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    await expect(page.locator(`[data-testid="composer-model-${id}-effort-max"]`)).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await closeMenus();
  });
});

// ─── Composer attachments (ported from §30, non-AI tests only) ───────────────
test.describe('§composer attachments', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let testImagePath: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    testImagePath = path.join(project.projectPath, 'test-image.png');
    writeFileSync(testImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('attaching an image shows thumbnail in composer', async () => {
    const { page } = app;

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('composer-add-menu').click();
    await page.getByTestId('composer-add-attachment').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    // app-tauri uses `composer-attachment-tile` instead of `attachment-thumb`
    const thumb = page.locator('[data-testid="composer-attachment-tile"]');
    await thumb.waitFor({ timeout: 5_000 });
    await expect(thumb).toBeVisible();
  });

  test('removing attachment clears it from composer', async () => {
    const { page } = app;

    // Tile still visible from prior test
    const thumb = page.locator('[data-testid="composer-attachment-tile"]');
    await expect(thumb).toBeVisible();

    // Hover to reveal remove button, then click
    await thumb.hover();
    // app-tauri uses `composer-attachment-remove` instead of aria-label "Remove"
    await page.getByTestId('composer-attachment-remove').first().click();

    await expect(thumb).not.toBeVisible({ timeout: 3_000 });
  });

  // TODO(app-tauri): in-message image thumbnail (message-image-thumb) + AI attachment flow not verified yet
  test.skip('sending a message with attachment gets AI response', async () => {
    const { page } = app;

    // Re-attach
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('composer-add-menu').click();
    await page.getByTestId('composer-add-attachment').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);
    await page.locator('[data-testid="composer-attachment-tile"]').waitFor({ timeout: 5_000 });

    // Skipped: message-image-thumb surface not ported to app-tauri yet
    const messageThumb = page.locator('[data-testid="message-image-thumb"]').first();
    await messageThumb.waitFor({ timeout: 10_000 });
    await expect(messageThumb).toBeVisible();
  });
});

// ─── Permissions ──────────────────────────────────────────────────────────────
test.describe('§composer permissions', () => {
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

  test('⇧⇥ in the field switches Interactive and Auto-Edits, and says so', async () => {
    const { page } = app;
    const permissions = page.getByTestId('composer-permission-mode-select');
    await expect(permissions).toContainText('Interactive');
    await page.getByTestId('chat-composer-input').click();
    await page.keyboard.press('Shift+Tab');
    await expect(permissions).toContainText('Auto-Edits', { timeout: 5_000 });
    await expect(page.getByTestId('chat-composer-input')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(permissions).toContainText('Interactive', { timeout: 5_000 });
  });

  test('Unattended asks once per session', async () => {
    const { page } = app;
    const permissions = page.getByTestId('composer-permission-mode-select');
    const pick = async (mode: string) => {
      // A click on the trigger while the menu animates out is swallowed.
      await expect(page.locator('[role="menu"]')).toHaveCount(0);
      await permissions.click();
      await page.getByTestId(`composer-permission-mode-select-option-${mode}`).click();
    };
    await pick('yolo');
    await expect(page.getByTestId('composer-unattended-confirm-cancel')).toBeFocused();
    await page.getByTestId('composer-unattended-confirm-confirm').click();
    await expect(permissions).toContainText('Unattended', { timeout: 5_000 });
    await expect(permissions).toBeFocused();
    await pick('default');
    await expect(permissions).toContainText('Interactive', { timeout: 5_000 });
    await pick('yolo');
    await expect(permissions).toContainText('Unattended', { timeout: 5_000 });
    await expect(page.getByTestId('composer-unattended-confirm')).toHaveCount(0);
  });
});

// ─── Running turn: queue, stop, send what was held (C8–C10) ───────────────────
test.describe('§composer running turn', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'composer-running', mockMaxDelayMs: 3_600_000 });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
    for (const text of ['Where does the quota reset?', 'Read the tests around it', 'Write the missing test']) {
      await sendMessage(app.page, text);
      await waitForIdle(app.page);
    }
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('typing while a turn runs offers Queue and Steer, and keeps Stop', async () => {
    const { page } = app;
    await sendMessage(page, 'Fix the reset');
    await expect(page.getByTestId('chat-composer-cancel')).toHaveAttribute('aria-label', 'Stop the turn');
    await expect(page.getByTestId('composer-model-select')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('chat-composer-input').fill('Also cover the DST case');
    await expect(page.getByTestId('chat-composer-cancel')).toBeVisible();
    await page.getByTestId('chat-composer-send-options').click();
    // The mock adapter cannot steer, and the menu says what happens instead.
    await expect(page.getByTestId('chat-composer-send-steer')).toContainText('it will queue');
    await page.keyboard.press('Escape');
  });

  test('a queued message is a row in the card, not a transcript bubble', async () => {
    const { page } = app;
    await page.getByTestId('chat-composer-input').press('Enter');
    await expect(page.getByTestId('chat-composer-queue').getByTestId('chat-queued-message')).toHaveCount(1);
    await expect(page.getByTestId('chat-user-message').filter({ hasText: 'DST' })).toHaveCount(0);
    await page.getByTestId('chat-composer-input').fill('Then open a PR');
    await page.getByTestId('chat-composer-input').press('Enter');
    await expect(page.getByTestId('chat-queued-message')).toHaveCount(2);
  });

  test('⌘. stops the turn and holds the queue; Send now sends it in order', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+.');
    const rows = page.getByTestId('chat-queued-message');
    await expect(rows.first()).toContainText('Not sent: the session stopped.', { timeout: 10_000 });
    await expect(rows.nth(1)).toContainText('Waiting');
    await expect(page.getByTestId('chat-composer-input')).toBeFocused();
    await waitForIdle(page);
    await expect(rows).toHaveCount(2);

    await page.getByTestId('chat-queued-send-now').click();
    await expect(rows).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText('Opened the pull request.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('chat-user-message').filter({ hasText: 'Also cover the DST case' })).toHaveCount(1);
  });
});

// ─── Worktree-missing → degraded card locks composer (§9c) ────────────────────
test.describe('§composer worktree-missing degraded card', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;
  let worktreePath: string;
  const branchName = 'e2e-worktree-missing';

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');

    // Enable a worktree via the composer popover — real `git worktree add`, same flow as
    // composer-advanced.spec.ts's "§composer worktree setup" describe.
    const { page } = app;
    await page.getByTestId('composer-worktree-trigger').click();
    await expect(page.getByTestId('composer-worktree-tab-new')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('composer-worktree-branch-name').fill(branchName);
    await page.getByTestId('composer-worktree-enable').click();
    await expect(page.getByTestId('composer-worktree-popover')).toHaveCount(0, { timeout: 15_000 });

    // createWorktree() (packages/core/src/workspace/worktree.ts) resolves to
    // <projectPath>/<settings.general.worktreeDir, default '.worktrees'>/<branch, '/'→'-'>.
    // branchName has no '/', so the sanitized segment equals it verbatim.
    worktreePath = path.join(project.projectPath, '.worktrees', branchName);
    rmSync(worktreePath, { recursive: true, force: true });

    // is_worktree_present() (packages/core-rs/crates/mainframe-services/src/workspace/worktree.rs)
    // is a live fs check recomputed on every enrich_chat() — now joined by the generalized
    // directory check for the no-worktree case — so a reload + reselect is enough to pick up
    // worktreeMissing:true with no daemon restart needed.
    await page.reload();
    await waitConnected(page);
    await sessionsSidebar(page).row(chatId).click();
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('shows the degraded-chat card with recovery actions and hides the composer', async () => {
    const { page } = app;
    // The old chat-composer-worktree-missing banner was replaced by the
    // thread-level DegradedChatCard (unified transcript/worktree recovery), which now lives in
    // the sticky footer and takes the composer's slot instead of disabling it.
    const card = page.getByTestId('chat-degraded-card');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Worktree deleted');
    await expect(card).toContainText(worktreePath);
    await expect(page.getByTestId('chat-degraded-recreate-worktree')).toBeVisible();
    await expect(page.getByTestId('chat-degraded-project-root')).toBeVisible();
    await expect(page.getByTestId('chat-degraded-delete')).toBeVisible();
    await expect(page.getByTestId('chat-composer-worktree-missing')).toHaveCount(0);

    await expect(page.getByTestId('chat-thread-footer').getByTestId('chat-degraded-card')).toHaveCount(1);
    await expect(page.getByTestId('chat-composer')).toHaveCount(0);
  });
});
