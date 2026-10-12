/**
 * §fork-from-message — "Fork from here" after an assistant turn.
 *
 * Runs in E2E_MODE=mock against the `messaging` recording (two prompts). With
 * `mockFork`, the daemon registers the mock adapter as fork-capable.
 *
 * Testid reference:
 *   chat-assistant-message     — assistant turn root
 *   chat-assistant-message-fork — the turn's "Fork from here" button
 *   chat-header-parent-link    — the fork's link back to its parent
 *   chat-composer-input        — composer textarea (one per visible zone)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

const PROMPT_1 = 'What is 2 + 2? Reply with just the number.';
const PROMPT_2 = 'List the files in this project using bash ls.';

const assistantMessage = (page: Page, index: number) => page.getByTestId('chat-assistant-message').nth(index);

async function forkButton(page: Page, index: number) {
  await assistantMessage(page, index).hover();
  return assistantMessage(page, index).getByTestId('chat-assistant-message-fork');
}

async function sendBothPrompts(page: Page) {
  await sendMessage(page, PROMPT_1);
  await waitForIdle(page, 60_000);
  await sendMessage(page, PROMPT_2);
  await waitForIdle(page, 90_000);
}

/**
 * The fork zone's own composer. `.first()` can select the parent zone.
 * `chat-zone-` also prefixes the column strip's own `chat-zone-strip-<id>` /
 * `chat-zone-close-<id>` testids, so exclude those to isolate zone roots.
 */
async function forkZoneComposer(page: Page, parentChatId: string) {
  const zones = page.locator('[data-testid^="chat-zone-"]:not([data-testid*="-strip-"]):not([data-testid*="-close-"])');
  await expect(zones).toHaveCount(2);
  const zoneTestIds = await zones.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  const forkZoneTestId = zoneTestIds.find((id) => id !== `chat-zone-${parentChatId}`);
  expect(forkZoneTestId).toBeTruthy();
  return page.getByTestId(forkZoneTestId!).locator('[data-testid="chat-composer-input"]');
}

test.describe('§fork-from-message (fork-capable mock)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let parentChatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging', mockFork: true });
    project = await createTauriProject(app.page);
    parentChatId = await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendBothPrompts(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('offers forks after earlier and latest completed assistant turns', async () => {
    const { page } = app;
    await expect(await forkButton(page, 0)).toBeEnabled();
    await expect(await forkButton(page, 1)).toBeEnabled();
  });

  test('forks after the first turn with an empty composer and cuts the transcript there', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.locator('[data-testid="chat-header-parent-link"]').first()).toBeVisible({ timeout: 15_000 });

    // The parent was on screen, so the fork opens beside it as a split pair
    // (forkAnchor). Scope the transcript checks per zone so each chat's own
    // messages are asserted, not the union of both. `chat-zone-` also prefixes
    // the column strip's own `chat-zone-strip-<id>` / `chat-zone-close-<id>`
    // testids, so exclude those to isolate the zone root itself.
    const zones = page.locator(
      '[data-testid^="chat-zone-"]:not([data-testid*="-strip-"]):not([data-testid*="-close-"])',
    );
    await expect(zones).toHaveCount(2);
    const zoneTestIds = await zones.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    const forkZoneTestId = zoneTestIds.find((id) => id !== `chat-zone-${parentChatId}`);
    expect(forkZoneTestId).toBeTruthy();
    const parentZone = page.getByTestId(`chat-zone-${parentChatId}`);
    const forkZone = page.getByTestId(forkZoneTestId!);

    // The parent is untouched: both prompts (and the fork point itself) still
    // show in its own transcript.
    const parentMessages = parentZone.locator('[data-testid="chat-user-message"]');
    await expect(parentMessages).toHaveCount(2);
    await expect(parentMessages.nth(0)).toContainText(PROMPT_1);
    await expect(parentMessages.nth(1)).toContainText(PROMPT_2);

    // The fork holds the first turn, while the later prompt stays only in the parent.
    const forkMessages = forkZone.locator('[data-testid="chat-user-message"]');
    await expect(forkMessages).toHaveCount(1);
    await expect(forkMessages.first()).toContainText(PROMPT_1);
    await expect(forkMessages).not.toContainText(PROMPT_2);
    await expect(forkZone.getByTestId('chat-composer-input')).toBeEmpty();
  });
});

/**
 * A narrow surface parks the split behind the single-chat view (ChatSurface's
 * `splitFits` gate, `MIN_ZONE_WIDTH` in zones-store.ts) even though the fork
 * is still a `zones` member. The review follow-up on 3e34c95c: zone
 * membership alone must not lose an edit made in the single view when the
 * window is widened and the fork moves into its own zone.
 */
test.describe('§fork-from-message (narrow viewport — split parked behind single view)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let parentChatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging', mockFork: true });
    await app.page.setViewportSize({ width: 820, height: 800 });
    project = await createTauriProject(app.page);
    parentChatId = await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendBothPrompts(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('keeps an edit made in the parked single view when widened', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.getByTestId('chat-header-parent-link').first()).toBeVisible({ timeout: 15_000 });
    // Too narrow for the split: ChatSurface renders the single view.
    await expect(page.getByTestId('chat-split-row')).toHaveCount(0);
    const composer = page.getByTestId('chat-composer-input');
    await expect(composer).toBeEmpty();

    const edited = 'edited before widening — must survive';
    await composer.fill(edited);

    // Widening now makes the split fit; the fork renders through its OWN
    // ChatZone for the first time. The single-view instance's handoff effect
    // (review follow-up on 214de9d4) re-stashes whatever the composer holds
    // — the user's edit — the moment it loses displayed status.
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.getByTestId('chat-split-row')).toBeVisible();
    const forkComposer = await forkZoneComposer(page, parentChatId);
    await expect(forkComposer).toHaveValue(edited);
  });
});

/**
 * Mid-width: the surface doesn't fit a split until the WORKSPACE PANEL parks
 * (ChatSurface measures the chat column alone; with the workspace open
 * beside it, that column is too narrow, until `use-zones-reconciler` parks
 * the workspace to the bottom strip on the pair becoming visible). This is
 * the exact race review follow-up B on 214de9d4 describes: `splitFits`
 * reads false for a beat right after the pair resolves into `zones` (its
 * ResizeObserver settles asynchronously, after the park).
 */
test.describe('§fork-from-message (mid-width viewport — fits only once the workspace panel parks)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let parentChatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging', mockFork: true });
    await app.page.setViewportSize({ width: 1500, height: 900 });
    project = await createTauriProject(app.page);
    parentChatId = await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendBothPrompts(app.page);
    // Open the workspace beside the chat (⌘⇧W) so the chat column alone is
    // too narrow for a split — until the fork's pair parks it.
    await app.page.keyboard.press('ControlOrMeta+Shift+W');
    await expect(app.page.getByTestId('workspace-surface')).toBeVisible({ timeout: 10_000 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('opens an empty fork once the split catches up after the workspace parks', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.getByTestId('chat-header-parent-link').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('chat-split-row')).toBeVisible({ timeout: 15_000 });
    const forkComposer = await forkZoneComposer(page, parentChatId);
    await expect(forkComposer).toBeEmpty();
  });
});

test.describe('§fork-from-message (mock without fork)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendBothPrompts(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('is disabled with the adapter hint', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeDisabled();
    await button.locator('..').hover();
    await expect(page.getByRole('tooltip')).toContainText("Forking isn't available for Mock CLI chats yet");
  });
});
