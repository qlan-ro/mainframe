/**
 * §fork-from-message — "Fork from here" on a sent user message
 * (docs/specs/2026-10-06-fork-from-message.md).
 *
 * Runs in E2E_MODE=mock against the `messaging` recording (two prompts). With
 * `mockFork`, the daemon registers the mock adapter as fork-capable
 * (E2E_MOCK_FORK=1); without it the button is disabled with the adapter hint.
 *
 * Testid reference:
 *   chat-user-message          — user turn root (carries data-message-id)
 *   chat-user-message-fork     — the hover bar's "Fork from here" button
 *   chat-header-parent-link    — the fork's link back to its parent
 *   chat-composer-input        — composer textarea (one per visible zone)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

const PROMPT_1 = 'What is 2 + 2? Reply with just the number.';
const PROMPT_2 = 'List the files in this project using bash ls.';

const userMessage = (page: Page, index: number) => page.locator('[data-testid="chat-user-message"]').nth(index);

/** The fork button lives in a hover bar, so hover its message first. */
async function forkButton(page: Page, index: number) {
  await userMessage(page, index).hover();
  return userMessage(page, index).locator('[data-testid="chat-user-message-fork"]');
}

async function sendBothPrompts(page: Page) {
  await sendMessage(page, PROMPT_1);
  await waitForIdle(page, 60_000);
  await sendMessage(page, PROMPT_2);
  await waitForIdle(page, 90_000);
}

/**
 * The fork zone's own composer — NOT `.first()`, which is DOM order and
 * picks the PARENT zone whenever it renders first (the parent never holds
 * PROMPT_2, so a stale-reapply assertion against `.first()` proves nothing).
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

  test('is disabled on the first message, with its hint', async () => {
    const { page } = app;
    const button = await forkButton(page, 0);
    await expect(button).toBeDisabled();
    await button.locator('..').hover();
    await expect(page.getByRole('tooltip')).toContainText('Nothing before this message to fork');
  });

  test('forks before the second message, prefills its text, and cuts the transcript there', async () => {
    const { page } = app;
    const button = await forkButton(page, 1);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.locator('[data-testid="chat-header-parent-link"]').first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() =>
        page
          .locator('[data-testid="chat-composer-input"]')
          .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value)),
      )
      .toContain(PROMPT_2);

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

    // The fork holds everything the parent showed BEFORE the chosen message:
    // PROMPT_1 renders read-only. PROMPT_2 is the cut point — it is absent
    // from the fork's transcript (it waits, unsent, in the composer instead).
    const forkMessages = forkZone.locator('[data-testid="chat-user-message"]');
    await expect(forkMessages).toHaveCount(1);
    await expect(forkMessages.first()).toContainText(PROMPT_1);
    await expect(forkMessages).not.toContainText(PROMPT_2);
  });
});

/**
 * A narrow surface parks the split behind the single-chat view (ChatSurface's
 * `splitFits` gate, `MIN_ZONE_WIDTH` in zones-store.ts) even though the fork
 * is still a `zones` member. The review follow-up on 3e34c95c: zone
 * membership alone must not defer the draft-stash take, or the prefill is
 * lost here (nothing renders `ChatZone`) and, if the window is later
 * widened, reapplied stale over whatever the user already typed or sent.
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

  test('prefills the fork in the parked single view, and widening hands the edit to its OWN zone, never the stale prefill', async () => {
    const { page } = app;
    const button = await forkButton(page, 1);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.getByTestId('chat-header-parent-link').first()).toBeVisible({ timeout: 15_000 });
    // Too narrow for the split: ChatSurface renders the single view, so the
    // fork's composer is this hook instance's own — not a ChatZone's. The
    // prefill must still land here, or it is lost outright (review follow-up
    // on 3e34c95c: zone-membership-only skip left NEITHER consumer taking it).
    await expect(page.getByTestId('chat-split-row')).toHaveCount(0);
    const composer = page.getByTestId('chat-composer-input');
    await expect(composer).toHaveValue(PROMPT_2);

    // The user edits the prefill before the window ever widens.
    const edited = 'edited before widening — must survive';
    await composer.fill(edited);

    // Widening now makes the split fit; the fork renders through its OWN
    // ChatZone for the first time. The single-view instance's handoff effect
    // (review follow-up on 214de9d4) re-stashes whatever the composer holds
    // — the user's edit, not the stale PROMPT_2 — the moment it loses
    // displayed status, so ZoneDraftRestore picks up the LATEST state rather
    // than finding nothing (losing the edit) or re-applying the original
    // prefill stale over it.
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.getByTestId('chat-split-row')).toBeVisible();
    const forkComposer = await forkZoneComposer(page, parentChatId);
    await expect(forkComposer).toHaveValue(edited);
    await expect(forkComposer).not.toHaveValue(PROMPT_2);
  });
});

/**
 * Mid-width: the surface doesn't fit a split until the WORKSPACE PANEL parks
 * (ChatSurface measures the chat column alone; with the workspace open
 * beside it, that column is too narrow, until `use-zones-reconciler` parks
 * the workspace to the bottom strip on the pair becoming visible). This is
 * the exact race review follow-up B on 214de9d4 describes: `splitFits`
 * reads false for a beat right after the pair resolves into `zones` (its
 * ResizeObserver settles asynchronously, after the park), so the hook
 * instance can be "displayed" and take the stash before `ChatZone` ever
 * mounts — the handoff effect must still deliver it there once `splitFits`
 * catches up, not just leave it flashing in the single view.
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

  test('prefills the fork once the split catches up after the workspace parks', async () => {
    const { page } = app;
    const button = await forkButton(page, 1);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.getByTestId('chat-header-parent-link').first()).toBeVisible({ timeout: 15_000 });
    // The pair parks the workspace, splitFits catches up, and ChatZone mounts
    // — the prefill must land in ITS composer, not vanish in the hand-off.
    await expect(page.getByTestId('chat-split-row')).toBeVisible({ timeout: 15_000 });
    const forkComposer = await forkZoneComposer(page, parentChatId);
    await expect(forkComposer).toHaveValue(PROMPT_2);
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
    const button = await forkButton(page, 1);
    await expect(button).toBeDisabled();
    await button.locator('..').hover();
    await expect(page.getByRole('tooltip')).toContainText("Forking isn't available for Mock CLI chats yet");
  });
});
