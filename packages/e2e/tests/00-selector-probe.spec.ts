/**
 * TEMPORARY no-AI probe (delete after repair verification).
 * Verifies the keystone fixture/helper repairs against the live DOM without any AI calls:
 *  - fixtures/project.ts createTestProject works via the new add-project flow
 *  - dead selectors are truly absent
 *  - the live replacement selectors resolve
 */
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

test.describe('selector repair probe (no AI)', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    // Keystone 1: this uses the rewritten add-project flow. If it throws, the fix is wrong.
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
  });
  test.afterAll(async () => {
    if (project) await cleanupProject(project);
    if (fixture) await closeApp(fixture);
  });

  test('project created via new add-project flow', async () => {
    // createTestProject() (in beforeAll) internally drives the new chats-add-project flow and
    // waits for project-group-name before returning a projectId. Reaching here with an id proves
    // keystone 1. (project-group-name itself is hidden once a chat is open, so don't assert it here.)
    expect(project.projectId).toBeTruthy();
  });

  test('dead selectors are absent from the DOM', async () => {
    for (const dead of ['right-panel', 'project-selector', 'project-dropdown', 'chat-status-working']) {
      await expect(fixture.page.locator(`[data-testid="${dead}"]`)).toHaveCount(0);
    }
  });

  test('keystone-2 replacement: session-bar-status resolves (empty when idle)', async () => {
    // The container is always present; it is empty (zero-size) when idle and shows
    // "Thinking" while the agent works — which is what waitForAIIdle keys off.
    await expect(fixture.page.locator('[data-testid="session-bar-status"]')).toBeAttached();
    await expect(
      fixture.page.locator('[data-testid="session-bar-status"]').getByText('Thinking', { exact: true }),
    ).toBeHidden();
  });

  test('zone navigation for specs 10/12/14 (verified ensure-shown pattern)', async () => {
    // zone-rail-button-* TOGGLE the zone tab, and the default-active tab is not guaranteed.
    // Robust pattern for the real specs: click the rail button only if the target isn't visible.
    const ensureShown = async (railId: string, contentTestid: string) => {
      const content = fixture.page.locator(`[data-testid="${contentTestid}"]`);
      if (!(await content.isVisible())) {
        await fixture.page.locator(`[data-testid="${railId}"]`).click();
      }
      await expect(content).toBeVisible({ timeout: 10_000 });
    };
    await ensureShown('zone-rail-button-files', 'files-root-toggle');
    await ensureShown('zone-rail-button-changes', 'zone-button-tab-dropdown');
  });
});
