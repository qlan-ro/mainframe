/**
 * §sessions-list — the windowed list as a whole, in a real browser: what its
 * parked and stuck headers do to the rows under them, what a narrow panel does
 * to a hovered row, and the row's hover card under the pointer and the keyboard.
 * jsdom lays nothing out, so none of this can be a unit test.
 *
 * Rows as such are sessions-rows.spec.ts.
 *
 * Source: SessionListVirtuoso.tsx, SessionGroupHeader.tsx, SidebarScrollRegion.tsx,
 * use-session-meta-card.ts, use-hover-card-wedge-guard.ts, use-scroll-memory.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';
import { DAEMON_BASE } from '../fixtures/daemon.js';

const CHATS = 40;
/** The parked header's height; the stuck one below it ends at 52. */
const PARKED = 28;
const STACK = 52;

async function post(path: string, body: unknown, method = 'POST'): Promise<{ id: string }> {
  const res = await fetch(`${DAEMON_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status} ${await res.text()})`);
  const json = (await res.json()) as { data?: { id: string } };
  return json.data ?? { id: '' };
}

const createChat = (projectId: string) =>
  post('/api/chats', { projectId, adapterId: 'mock-cli', permissionMode: 'default' }).then((chat) => chat.id);

const scroller = (page: Page) => page.getByTestId('sidebar-scroll');
const scrollTo = (page: Page, top: number) => scroller(page).evaluate((el, y) => el.scrollTo({ top: y }), top);
const scrollTop = (page: Page) => scroller(page).evaluate((el) => el.scrollTop);

test.describe('§sessions-list Long list', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  const chats: string[] = [];

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    for (let i = 0; i < CHATS; i++) chats.push(await createChat(project.projectId));
    // Two groups: the first one's header parks, the second one's sticks below it.
    for (const id of chats.slice(0, 5)) await post(`/api/chats/${id}/pinned`, { pinned: true }, 'PATCH');
    await app.page.reload();
    await waitConnected(app.page);
    await expect(app.page.getByTestId('sessions-group-header-Today').first()).toBeVisible();
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('Shift+Tab never leaves the focused row under the headers', async () => {
    const { page } = app;
    await scrollTo(page, 500);
    const rows = page.locator('[data-testid="sessions-row"] [data-sidebar="menu-button"]');
    const start = await rows.evaluateAll((els, stack) => {
      const top = document.querySelector('[data-testid="sidebar-scroll"]')!.getBoundingClientRect().top;
      return els.findIndex((el) => el.getBoundingClientRect().top - top > stack + 40);
    }, STACK);
    await rows.nth(start).focus();

    const covered: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(60);
      const depth = await page.evaluate(() => {
        const row = document.activeElement?.closest('[data-testid="sessions-row"]');
        if (row == null) return null;
        const bounds = document.querySelector('[data-testid="sidebar-scroll"]')!.getBoundingClientRect();
        const box = row.getBoundingClientRect();
        const headers = [
          ...document.querySelectorAll('[data-testid="sidebar-scroll"] [data-slot="sidebar-group-label"]'),
        ];
        const under = headers.some((header) => {
          const h = header.getBoundingClientRect();
          return h.bottom > box.top + 1 && h.top < box.bottom - 1 && h.top - bounds.top < 52;
        });
        return { top: Math.round(box.top - bounds.top), under };
      });
      if (depth == null) break;
      if (depth.under || depth.top < PARKED) covered.push(`press ${i}: ${JSON.stringify(depth)}`);
    }
    expect(covered).toEqual([]);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  });

  test('a group header stops below the parked one instead of sliding under it', async () => {
    const { page } = app;
    const tops: number[] = [];
    for (let y = 60; y <= 260; y += 4) {
      await scrollTo(page, y);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      tops.push(
        await page.evaluate(() => {
          const bounds = document.querySelector('[data-testid="sidebar-scroll"]')!.getBoundingClientRect();
          const headers = [...document.querySelectorAll('[data-testid="sessions-group-header-Today"]')];
          return Math.round(Math.min(...headers.map((h) => h.getBoundingClientRect().top)) - bounds.top);
        }),
      );
    }
    // Its 14px space goes behind the parked header; its label starts where that ends.
    expect(Math.min(...tops)).toBe(PARKED - 14);
    for (let i = 1; i < tops.length; i++)
      expect(tops[i], `step ${i}: ${tops.join(' ')}`).toBeLessThanOrEqual(tops[i - 1]!);
    expect(tops.at(-1)).toBe(PARKED - 14);
  });

  test('the list is where it was after a trip to another view', async () => {
    const { page } = app;
    await scrollTo(page, 400);
    await expect.poll(() => scrollTop(page)).toBe(400);

    await page.getByTestId('shell-rail-tasks').click();
    await expect(page.locator('[data-view="tasks"]')).toBeVisible();
    await page.getByTestId('shell-rail-chats').click();

    await expect.poll(() => scrollTop(page)).toBe(400);
    await expect(page.getByTestId('sessions-row').first()).toBeVisible();
  });

  test('a hovered row keeps its title readable at the narrowest panel', async () => {
    const { page } = app;
    await scrollTo(page, 0);
    const wrapper = page.locator('[data-slot="sidebar-wrapper"]').first();
    await wrapper.evaluate((el) => el.style.setProperty('--sidebar-width', '208px'));
    const row = sessionsSidebar(page).row(chats[0]!);

    await row.hover();
    await expect(row.getByTestId('sessions-row-action-archive')).toBeVisible();
    await expect(row.getByTestId('sessions-row-action-tags')).toBeHidden();
    await expect
      .poll(async () => (await row.getByTestId('sessions-row-title').boundingBox())!.width)
      .toBeGreaterThan(80);
    // The value is off screen, not gone: it is still in the row's name.
    expect((await row.getByTestId('sessions-row-status').boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(row.getByTestId('sessions-row-status')).toContainText(/\w/);

    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await row.getByTestId('sessions-row-status').boundingBox())!.width)
      .toBeGreaterThan(10);
    await wrapper.evaluate((el) => el.style.removeProperty('--sidebar-width'));
  });

  test('a menu acts on its own session when the list reorders under it', async () => {
    const { page } = app;
    const target = chats[CHATS - 1]!;
    const row = sessionsSidebar(page).row(target);
    await scrollTo(page, 0);
    await row.click({ button: 'right' });
    const archive = page.getByTestId('sessions-ctx-archive');
    await expect(archive).toBeVisible();

    // A new session tops the group, so every row below it moves down by one.
    const before = (await row.boundingBox())!.y;
    const added = await createChat(project.projectId);
    await expect.poll(async () => (await row.boundingBox())!.y).toBeGreaterThan(before);
    await archive.click();

    await expect(row).toHaveCount(0);
    await expect(sessionsSidebar(page).row(added)).toHaveCount(1);
    const { data } = (await (await fetch(`${DAEMON_BASE}/api/chats/${target}`)).json()) as { data: { status: string } };
    expect(data.status).toBe('archived');
  });
});

test.describe('§sessions-list Hover card', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let parent: string;
  let child: string;

  test.beforeAll(async () => {
    let lineage: Record<string, unknown> = {};
    app = await launchTauriApp({
      // The mock adapter cannot fork: hand the list a parent and a PR.
      beforeNavigate: (page) =>
        page.route(/\/api\/chats(\?.*)?$/, async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          const body = (await response.json()) as { data: Record<string, unknown>[] };
          for (const chat of body.data) if (chat['id'] === child) Object.assign(chat, lineage);
          return route.fulfill({ response, json: body });
        }),
    });
    project = await createTauriProject(app.page);
    parent = await createTauriChat(app.page, project.projectId);
    child = await createTauriChat(app.page, project.projectId);
    lineage = {
      parentChatId: parent,
      detectedPrs: [{ url: 'https://example.com/1', owner: 'o', repo: 'r', number: 42, source: 'created' }],
    };
    await app.page.reload();
    await waitConnected(app.page);
  });

  test.afterAll(async () => {
    // A list refetch can be mid-route when the page goes.
    await app.page.unrouteAll({ behavior: 'ignoreErrors' });
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  /** Selects the child, so opening the parent is a visible change. */
  async function selectChild(page: Page) {
    const row = sessionsSidebar(page).row(child);
    // On the title: the middle of a nested row is where its Pin appears on hover.
    await row.click({ position: { x: 40, y: 14 } });
    await expect(row).toHaveAttribute('data-active', 'true');
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('sessions-meta-card')).toHaveCount(0);
    return row;
  }

  test('the parent link is readable and 24px tall', async () => {
    const { page } = app;
    const row = await selectChild(page);
    await row.hover();
    const link = page.getByTestId('sessions-meta-card-open-parent');
    await expect(link).toBeVisible();
    await expect.poll(async () => (await link.boundingBox())!.height).toBe(24);
    const [ink, body] = await link.evaluate((el) => [
      getComputedStyle(el).color,
      getComputedStyle(el.closest('[data-slot="hover-card-content"]')!).color,
    ]);
    expect(ink).toBe(body);
    await page.mouse.move(0, 0);
  });

  test('a diagonal move reaches the link, and using it closes the card', async () => {
    const { page } = app;
    const row = await selectChild(page);
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + box.height - 4);
    const link = page.getByTestId('sessions-meta-card-open-parent');
    await expect(link).toBeVisible();
    // Let the open animation settle, so the aim is where the link ends up.
    await page.waitForTimeout(300);
    const to = (await link.boundingBox())!;
    const from = { x: box.x + 60, y: box.y + box.height - 4 };
    const target = { x: to.x + 20, y: to.y + to.height / 2 };
    // About 600ms: ten times Radix's close delay.
    for (let step = 1; step <= 24; step++) {
      await page.mouse.move(from.x + ((target.x - from.x) * step) / 24, from.y + ((target.y - from.y) * step) / 24);
      await page.waitForTimeout(25);
    }
    await expect(link).toBeVisible();
    await page.mouse.click(target.x, target.y);

    await expect(sessionsSidebar(page).row(parent)).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('sessions-meta-card-open-parent')).toHaveCount(0);
    await page.mouse.move(0, 0);
  });

  test('the keyboard reaches every link in the card and comes back out', async () => {
    const { page } = app;
    const row = await selectChild(page);
    const trigger = row.locator('[data-sidebar="menu-button"]');
    await trigger.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    const link = page.getByTestId('sessions-meta-card-open-parent');
    await expect(link).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await expect(link).not.toHaveCSS('outline-style', 'none');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sessions-meta-card-pr').getByRole('link')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(link).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(sessionsSidebar(page).row(parent)).toHaveAttribute('data-active', 'true');
    await expect(link).toHaveCount(0);
  });
});

test.describe('§sessions-list Midnight', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({
      beforeNavigate: async (page) => {
        await page.clock.install();
        await page.clock.resume();
      },
    });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId);
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('today becomes yesterday at midnight, with nothing happening', async () => {
    const { page } = app;
    const label = page.getByTestId('sessions-section-jump');
    await expect(label).toHaveText('Today');

    await page.clock.fastForward('24:00:00');

    await expect(label).toHaveText('Yesterday', { timeout: 45_000 });
  });
});
