/**
 * §sessions-draft — the new-session Welcome flow (app-tauri browser mode).
 *
 * Covers the rebuilt draft-thread surface: NewSessionPickerPopover (project
 * picker, "All" view) → DraftSessionRow (sidebar synthetic row) → WelcomeState
 * (repo suggestions) / FirstRunState (zero projects), with the chat created
 * ONLY on first send (D3) and no cross-project draft leak on repeated New
 * cycles (the historical slot-reuse regression). Also covers the bugfix where
 * ⌘N in "All" view and a zero-session boot both used to strand the user on a
 * projectless dead-end new-thread surface instead of resolving a project
 * first (useNewChatHotkeyHandler + ChatSurface's boot-settle fallback, both
 * driving the shared useNewSessionPickerTarget store).
 *
 * `docs/plans/2026-07-03-tauri-e2e-test-plan.md` §6 is STALE (written against a
 * deleted NewThreadConfigPicker) — scenarios below are derived from the CURRENT
 * source: `packages/ui/src/features/sessions/new-thread/` + `sidebar/DraftSessionRow.tsx`
 * + `sidebar/SessionsNewButton.tsx`.
 *
 * Testid reference (verified against source):
 *   sessions-new-button              — the list header's "+" (v2 SessionsNewButton.tsx). In "All"
 *                                      view it is a DropdownMenu trigger; with a project filter
 *                                      active it opens the draft directly.
 *   sessions-new-picker              — the picker menu content (All view only)
 *   sessions-new-picker-project-<id> — project row inside the picker
 *   sessions-draft-row               — the synthetic draft row's BUTTON (v2 DraftSessionRow.tsx)
 *   sessions-draft-row-title         — draft row's "New Session" title span
 *   sessions-draft-row-discard       — the ✕. It is a `SidebarMenuAction`, i.e. a SIBLING of
 *                                      `sessions-draft-row` inside the list item — not a
 *                                      descendant, so it can only be reached from the page.
 *   sidebar-project-<id>             — one project row in the switcher list (was
 *                                      `sessions-filter-pill-<id>`)
 *   sidebar-project-all              — "All projects" row (was `sessions-filter-pill-all`)
 *   project-avatar                   — the coloured initial the draft row shows in "All" view.
 *                                      The draft row no longer prints the project NAME (v2
 *                                      DraftSessionRow renders a `ProjectAvatar`), so the
 *                                      project a draft belongs to is asserted on the chat
 *                                      header's chip instead.
 *   chat-header-project              — ChatCardHeaderDraft's project chip (names the project)
 *   sessions-welcome                 — WelcomeState root (ChatEmptyState variant='welcome')
 *   sessions-welcome-suggestion-<i>  — one repo-derived suggestion row (SuggestionRow.tsx)
 *   sessions-firstrun                — FirstRunState root (zero projects)
 *   sessions-firstrun-add-project    — FirstRunState's "Add project…" CTA
 *   directory-picker                 — DirectoryPickerModal root (opened by add-project)
 *   chat-composer-input / -send      — composer (usable pre-send on the draft)
 *   composer-model-select / composer-permission-mode-select — config selectors
 *
 * The project switcher is a count-collapsed vertical list now (ProjectSection.tsx,
 * VISIBLE_LIMIT = 3), not a width-measured pill row, so the old `expandProjectPills`
 * helper is gone — with ≤3 projects every row is rendered.
 *
 * Not covered here (per the plan's "does NOT cover" list / out of scope for this
 * flow): DraftSessionRow's own unit-level styling states, provider-tuning
 * inheritance defaults (chat-header.spec.ts / composer.spec.ts territory).
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar, composer } from '../helpers/tauri/page-objects.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';
import { TOAST } from '../helpers/tauri/testids.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/** One row of the project switcher list (page-objects' `projectFilterPill` is stale). */
function projectRow(page: Page, projectId: string): Locator {
  return page.getByTestId(`sidebar-project-${projectId}`);
}

/**
 * Pick a project out of the "New session in…" menu and wait for that menu to be
 * GONE, not merely closing.
 *
 * Radix keeps a closing menu's content mounted through its exit animation, and
 * while it lives the modal layer still owns `<html>`'s pointer events — so the
 * very next click (the composer's Send, in every send-from-draft test here) is
 * swallowed and retried until the test's own 60s budget runs out. `toHaveCount(0)`
 * on the menu's testid is the state that says the layer retired; asserting it here
 * (rather than pressing Escape) also keeps a menu that fails to self-close on
 * select a visible failure instead of a silently dismissed one.
 */
async function pickProjectFromPicker(page: Page, projectId: string): Promise<void> {
  await page.getByTestId(`sessions-new-picker-project-${projectId}`).click({ timeout: 10_000 });
  await expect(page.getByTestId('sessions-new-picker')).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Close an open composer config menu and wait for its layer to retire.
 *
 * One blind `Escape` is not enough, for the same reason `pickProjectFromPicker`
 * asserts on the menu's absence: while a Radix menu lives it owns `<html>`'s
 * pointer events, so the NEXT trigger's click is swallowed and retried until the
 * test budget runs out — which is how this read in CI, as `<html> intercepts
 * pointer events` against a still-open model menu. Retry the Escape until the
 * options are gone, so a menu that cannot be dismissed fails as itself.
 */
async function closeConfigMenu(page: Page, options: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(options).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
}

/**
 * Make sure a draft row is active, creating one if this test did not inherit it.
 *
 * The draft tests below document that they continue from the previous test's
 * draft. That holds on a clean pass and breaks on a RETRY: Playwright re-runs the
 * failed test alone in a fresh worker, so `beforeAll` reseeds the app but the test
 * that opened the draft never runs — turning any first failure in this describe
 * into two.
 */
async function ensureDraftRow(page: Page, projectId: string): Promise<void> {
  const draftRow = page.getByTestId('sessions-draft-row');
  if ((await draftRow.count()) === 0) {
    await sessionsSidebar(page).newButton().click();
    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 10_000 });
    await pickProjectFromPicker(page, projectId);
  }
  await expect(draftRow).toBeVisible({ timeout: 10_000 });
}

interface SuggestionDto {
  title: string;
  meta: string;
  prefill: string;
}

async function fetchSuggestions(projectId: string): Promise<SuggestionDto[]> {
  const res = await fetch(`${DAEMON_BASE}/api/projects/${projectId}/suggestions`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { data?: SuggestionDto[] };
  return body.data ?? [];
}

/** `GET /api/chats?project=<id>` — the same route `lib/api/chats.ts` `listChats`
 *  uses, rather than the uncovered `/api/projects/:id/chats` parity alias. */
async function fetchProjectChatIds(projectId: string): Promise<string[]> {
  const res = await fetch(`${DAEMON_BASE}/api/chats?project=${encodeURIComponent(projectId)}`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((chat) => chat.id);
}

/**
 * Poll the daemon until EXACTLY ONE chat exists in `projectId` that did not exist
 * before, and return its id.
 *
 * The daemon is the authority on "a chat was created": a set-difference over the
 * sidebar's `data-chat-id`s is not. The first send triggers a thread-list reload,
 * the list is windowed, and an `evaluateAll()` taken right after a `toHaveCount`
 * assertion can land mid-remount and come back without the new row — which surfaces
 * only as `expect(undefined).toBeTruthy()`, naming neither the cause nor the
 * contract.
 */
async function waitForCreatedChat(projectId: string, before: string[]): Promise<string> {
  const known = new Set(before);
  let created: string[] = [];
  await expect
    .poll(
      async () => {
        created = (await fetchProjectChatIds(projectId)).filter((id) => !known.has(id));
        return created.length;
      },
      { timeout: 20_000 },
    )
    .toBe(1);
  return created[0] as string;
}

/** `createTauriProject` names the project after the temp dir's basename. */
function baseName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] as string;
}

// ─── §sessions-draft — "All" view picker + draft row lifecycle ───────────────

/**
 * Dismiss every PERSISTENT toast.
 *
 * `mfToast` gives error and permission toasts `duration: Infinity` plus a close
 * button, and the Toaster sits bottom-right (App.tsx) — exactly where the composer's
 * Send button is. So one failed agent run earlier in a describe leaves a toast parked
 * over Send for the rest of the file: measured as `chat-composer-send` reported
 * "visible, enabled and stable" while the click retried for the full test budget.
 * Auto-dismissing toasts need no help, so the closeable ones are the whole problem.
 */
async function dismissPersistentToasts(page: Page): Promise<void> {
  const closers = page.locator(`${TOAST.root} ${TOAST.close}`);
  for (let remaining = await closers.count(); remaining > 0; remaining--) {
    await closers.first().click();
  }
  await expect(closers).toHaveCount(0, { timeout: 5_000 });
}

test.describe('§sessions-draft — All view picker + draft row', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let existingChatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // Seed one real chat so a discard has a session to return to, and so the
    // draft row is provably distinct from a `sessions-row`.
    existingChatId = await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // Previously: `sessions-draft-row` never rendered after picking a project
  // from the "All view" picker — `use-draft-row.ts`'s discard-on-navigate-away
  // effect fired on the render where the draft config had just been armed but
  // `mainThreadId` hadn't yet caught up to `newThreadId` (the switch is
  // awaited), wiping the draft it was meant to display. Fixed by the
  // product-bug-fix campaign: a `wasSelectedRef` gate now requires the draft
  // to have genuinely been selected (`mainThreadId === newThreadId` on some
  // earlier render) before treating a mismatch as a real navigate-away.
  test('New (All view) opens the project picker; picking a project resolves the draft without creating a chat', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowsBefore = await page.getByTestId('sessions-row').count();

    await sidebar.newButton().click();
    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 10_000 });
    // Opening the picker creates no draft/chat yet.
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore);
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0);

    await pickProjectFromPicker(page, project.projectId);

    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    await expect(draftRow).toHaveAttribute('data-active', 'true');
    // The draft is a distinct synthetic row — no new sessions-row was created.
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore);
    // In "All" view the row marks its project with a coloured initial, not the
    // name (v2 DraftSessionRow → ProjectAvatar); the name is on the chat header.
    await expect(draftRow.getByTestId('project-avatar')).toBeVisible();
    await expect(page.getByTestId('chat-header-project')).toContainText(baseName(project.projectPath));
  });

  // Continues from the previous test's draft-row — see the fix note documented on
  // the test above; `ensureDraftRow` re-opens one when this runs as a lone retry.
  test('composer config selectors are usable on the unsent draft', async () => {
    const { page } = app;
    await ensureDraftRow(page, project.projectId);
    await expect(composer(page).input()).toBeVisible({ timeout: 10_000 });

    const modelOptions = page.locator('[data-testid^="composer-model-select-option-"]');
    const modelTrigger = page.getByTestId('composer-model-select');
    await expect(modelTrigger).toBeVisible({ timeout: 10_000 });
    await expect(modelTrigger).toBeEnabled();
    await modelTrigger.click();
    await expect(modelOptions.first()).toBeVisible({ timeout: 5_000 });
    await closeConfigMenu(page, modelOptions);

    const permOption = page.getByTestId('composer-permission-mode-select-option-default');
    const permTrigger = page.getByTestId('composer-permission-mode-select');
    await expect(permTrigger).toBeVisible();
    await expect(permTrigger).toBeEnabled();
    await permTrigger.click();
    await expect(permOption).toBeVisible({ timeout: 5_000 });
    await closeConfigMenu(page, permOption);
  });

  // Needs a draft-row to discard — see the fix note documented on the first test
  // in this describe block.
  test('discarding the draft (✕) clears the row and returns to the previously active session', async () => {
    const { page } = app;
    await ensureDraftRow(page, project.projectId);
    const draftRow = page.getByTestId('sessions-draft-row');

    await draftRow.hover();
    // The ✕ is a SidebarMenuAction — a sibling of the row button, so it is
    // addressed from the page rather than scoped to `draftRow`.
    await page.getByTestId('sessions-draft-row-discard').click();

    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0, { timeout: 10_000 });
    const previousRow = sessionsSidebar(page).row(existingChatId);
    await expect(previousRow).toHaveAttribute('data-active', 'true', { timeout: 10_000 });
  });

  // This test independently re-triggers the picker flow — see the fix note
  // documented on the first test in this describe block.
  test('first send creates exactly one chat in the picked project (no chat exists before send)', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    const rowsBefore = await page.getByTestId('sessions-row').count();
    const chatsBefore = await fetchProjectChatIds(project.projectId);

    await sidebar.newButton().click();
    await pickProjectFromPicker(page, project.projectId);
    await expect(page.getByTestId('sessions-draft-row')).toBeVisible({ timeout: 10_000 });
    // Still no new sessions-row while the draft is unsent.
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore);
    // ...and nothing on the daemon either: the chat is created on first send (D3).
    expect(await fetchProjectChatIds(project.projectId)).toHaveLength(chatsBefore.length);

    await composer(page).submit('e2e draft first-send test');

    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore + 1, { timeout: 20_000 });
    await waitForCreatedChat(project.projectId, chatsBefore);
  });

  // Regression (#275, "first message is not visible"): the first send hands the
  // draft off to the canonical remote row — a different thread id. The registry
  // has to alias both ids onto the one controller that holds the optimistic
  // message; keying only by thread id mounted a BLANK second controller whose
  // sole seed was a REST history read.
  //
  // The forced-empty response is not a fake: the daemon persists the user
  // message only AFTER spawning the CLI, so any read issued during a cold spawn
  // legitimately returns an empty transcript. Pinning that losing side makes the
  // race deterministic — before the fix the message vanished on every run.
  test('the first user message stays visible when the history read predates persistence', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    // GET only. The send itself travels over the WebSocket, so nothing else on this
    // path is faulted today — but pinning the method keeps a future write on
    // `/messages` out of the injection, and `route.continue()` is the honest
    // fallthrough for it.
    await page.route(
      (url) => /^\/api\/chats\/[^/]+\/messages$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { messages: [], transcriptMissing: false } }),
        });
      },
    );

    // No try/finally around the body: `page.unroute` on a page the test timeout
    // already tore down throws, and that throw REPLACED the only report of which
    // step actually hung. This is the last test in the describe and `afterAll`
    // closes the app, so the route cannot leak into anything.
    await sidebar.newButton().click({ timeout: 10_000 });
    await pickProjectFromPicker(page, project.projectId);
    await expect(page.getByTestId('sessions-draft-row')).toBeVisible({ timeout: 10_000 });

    // A failed agent run earlier in this describe parks a persistent error toast
    // over the Send button; clear it before submitting.
    await dismissPersistentToasts(page);
    await composer(page).submit('e2e first-message visibility regression');

    const userMessage = page.getByTestId('chat-user-message');
    await expect(userMessage).toHaveCount(1, { timeout: 20_000 });
    await expect(userMessage).toContainText('e2e first-message visibility regression');
    // The draft row retiring IS the handoff: the local draft has been replaced by
    // the canonical remote row, which is when the second controller seeds itself
    // from the (forced-empty) history read above.
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0, { timeout: 20_000 });
    // Hold past it: the blank controller used to replace the transcript a beat
    // AFTER the row switched, so the negative assertion needs a window.
    await page.waitForTimeout(2_000);
    await expect(userMessage).toHaveCount(1);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

// ─── §sessions-draft — selected-project skip + no cross-project leak ─────────

test.describe('§sessions-draft — selected-project skip + no leak across New cycles', () => {
  let app: TauriAppFixture;
  let projectA: TauriProject;
  let projectB: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    projectA = await createTauriProject(app.page);
    projectB = await createTauriProject(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(projectA);
    cleanupTauriProject(projectB);
    await closeTauriApp(app);
  });

  // FIXED (commit 3368d065): discard (✕) never cleared the draft row when a
  // project filter was active. `use-draft-row.ts`'s `onDiscard` now marks
  // the draft in a discarded-drafts suppression set before resetting, so the
  // row clears reliably under an active project filter.
  test('with a project selected, New skips the picker and the draft inherits that project', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);

    await projectRow(page, projectA.projectId).click();
    await expect(projectRow(page, projectA.projectId)).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });

    await sidebar.newButton().click();
    // No picker — the draft resolves straight from the selected project.
    await expect(page.getByTestId('sessions-new-picker')).toHaveCount(0);

    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    // The draft row's project marker only renders in "All" view (`showProject`,
    // DraftSessionRow.tsx) — with a project selected the row omits it. The chat
    // header's chip always names the draft's project (ChatCardHeaderDraft's
    // `chat-header-project`), so assert there.
    await expect(draftRow.getByTestId('project-avatar')).toHaveCount(0);
    await expect(page.getByTestId('chat-header-project')).toContainText(baseName(projectA.projectPath));

    // Clean up: discard, then clear the filter for the next test. The project
    // switcher list is single-select (not a toggle) — only the "All projects"
    // row clears the filter, a second click on the active row no longer does.
    await draftRow.hover();
    await page.getByTestId('sessions-draft-row-discard').click();
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId('sidebar-project-all').click();
  });

  test('abandoning a draft in project A does not leak into a second New picking project B', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    // Guarantee "All" view.
    await expect(page.getByTestId('sessions-new-button')).toBeVisible();

    const rowsBefore = await page.getByTestId('sessions-row').count();
    const chatsBeforeA = await fetchProjectChatIds(projectA.projectId);
    const chatsBeforeB = await fetchProjectChatIds(projectB.projectId);

    // First New: pick project A. The draft row itself only carries a coloured
    // initial (both e2e projects are `mf-e2e-<hex>`, so the initial cannot tell
    // them apart) — the chat header's chip is what names the draft's project.
    const headerProject = page.getByTestId('chat-header-project');
    await sidebar.newButton().click();
    await pickProjectFromPicker(page, projectA.projectId);
    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    await expect(headerProject).toContainText(baseName(projectA.projectPath));

    // WITHOUT sending, click New again — the reused draft slot must not stack.
    await sidebar.newButton().click();
    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(1);

    // This time pick project B — the stale A config must be fully replaced, not merged.
    await pickProjectFromPicker(page, projectB.projectId);
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(1);
    await expect(headerProject).toContainText(baseName(projectB.projectPath), { timeout: 10_000 });
    await expect(headerProject).not.toContainText(baseName(projectA.projectPath));

    // Commit it and verify on the daemon side: the created chat belongs to B, not A.
    await composer(page).submit('e2e no-leak regression test');
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore + 1, { timeout: 20_000 });
    await waitForCreatedChat(projectB.projectId, chatsBeforeB);
    // The abandoned A draft left nothing behind on the daemon.
    expect(await fetchProjectChatIds(projectA.projectId)).toHaveLength(chatsBeforeA.length);
  });
});

// ─── §sessions-draft — bugfix: ⌘N in "All" view opens the project picker ────
//
// Regression coverage for the reported bug: ⌘N in "All" view used to bypass
// SessionsNewButton's picker entirely (AppShell's hotkey called
// switchToNewThread() directly), dropping the user on a projectless dead-end
// (no project chip, no file tree; first send failed and rolled back via the
// coordinator's "no draft config" guard). Fixed via useNewChatHotkeyHandler +
// the shared useNewSessionPickerTarget store — ⌘N now opens the SAME anchored
// popover the "+" button does when no project is selected, and is
// unchanged (switch straight to a new thread) when one IS selected.

test.describe('§sessions-draft — ⌘N in "All" view opens the project picker (no projectless session)', () => {
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

  test('⌘N opens the same anchored picker as the "+" button; no projectless draft is created', async () => {
    const { page } = app;
    const rowsBefore = await page.getByTestId('sessions-row').count();
    // Guarantee "All" view (no project selected).
    await expect(page.getByTestId('sidebar-project-all')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('ControlOrMeta+n');

    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 10_000 });
    // The picker gates project choice BEFORE any draft/chat exists — no
    // projectless dead-end row and no new session.
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0);
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore);

    await pickProjectFromPicker(page, project.projectId);

    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('chat-header-project')).toBeVisible();
  });

  test('sending from the ⌘N-picked draft creates exactly one chat tied to the picked project', async () => {
    const { page } = app;
    const rowsBefore = await page.getByTestId('sessions-row').count();
    const chatsBefore = await fetchProjectChatIds(project.projectId);

    // Continues from the previous test's ⌘N-picked draft.
    await expect(page.getByTestId('sessions-draft-row')).toBeVisible({ timeout: 10_000 });
    await composer(page).submit('e2e cmd-n picker test');

    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore + 1, { timeout: 20_000 });
    // "exactly one chat tied to the picked project" is a claim about the daemon, so
    // read it there — see `waitForCreatedChat` for why the sidebar's ids are the
    // wrong source (this test failed with a bare `expect(undefined).toBeTruthy()`
    // from exactly that DOM snapshot).
    await waitForCreatedChat(project.projectId, chatsBefore);
  });

  test('with a project selected, ⌘N still skips the picker and seeds that project directly', async () => {
    const { page } = app;

    await projectRow(page, project.projectId).click();
    await expect(projectRow(page, project.projectId)).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });

    await page.keyboard.press('ControlOrMeta+n');
    // No picker this time — the draft resolves straight from the selected project.
    await expect(page.getByTestId('sessions-new-picker')).toHaveCount(0);

    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('chat-header-project')).toContainText(baseName(project.projectPath));

    // Clean up: discard, then clear the filter. The project switcher list is
    // single-select (not a toggle) — only "All projects" clears it.
    await draftRow.hover();
    await page.getByTestId('sessions-draft-row-discard').click();
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId('sidebar-project-all').click();
  });
});

// ─── §sessions-draft — WelcomeState repo suggestions ──────────────────────────

test.describe('§sessions-draft — WelcomeState suggestions', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    // createTauriProject's temp repo has one commit plus two untracked files
    // (CLAUDE.md, index.ts) — a dirty working tree the daemon's churn signal
    // picks up (verified live: GET /suggestions returns exactly the "Review the
    // working changes" churn suggestion for this fixture).
    project = await createTauriProject(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('suggestions render for a project with git history; row count matches the daemon response', async () => {
    const { page } = app;
    const suggestions = await fetchSuggestions(project.projectId);
    // Presence-level, not content: the fixture repo has a dirty working tree, so
    // the churn signal must produce at least one suggestion — an empty list would
    // mean the daemon signal broke, which this test must catch.
    expect(suggestions.length).toBeGreaterThan(0);

    await sessionsSidebar(page).newButton().click();
    await pickProjectFromPicker(page, project.projectId);

    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
    const rows = page.locator('[data-testid^="sessions-welcome-suggestion-"]:not([data-testid*="insert"])');
    await expect(rows).toHaveCount(suggestions.length, { timeout: 10_000 });
  });

  test('clicking a suggestion inserts its exact prefill text into the composer', async () => {
    const { page } = app;
    const suggestions = await fetchSuggestions(project.projectId);
    test.skip(suggestions.length === 0, 'no suggestions available for this fixture');

    // Continues from the previous test's welcome state.
    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
    const input = composer(page).input();
    await expect(input).toHaveValue('');

    await page.getByTestId('sessions-welcome-suggestion-0').click();
    await expect(input).toHaveValue(suggestions[0]!.prefill, { timeout: 5_000 });
  });
});

// ─── §sessions-draft — FirstRunState (zero projects) ──────────────────────────

test.describe('§sessions-draft — FirstRunState (zero projects)', () => {
  let app: TauriAppFixture;

  test.beforeAll(async () => {
    // Deliberately no createTauriProject — a fresh workspace with zero projects.
    app = await launchTauriApp();
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
  });

  test('a workspace with no projects shows the FirstRunState hero, not the project picker or Welcome state', async () => {
    const { page } = app;
    await expect(page.getByTestId('sessions-firstrun')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sessions-welcome')).toHaveCount(0);
    await expect(page.getByTestId('sessions-new-picker')).toHaveCount(0);
  });

  test('the "Add project…" CTA opens the directory picker', async () => {
    const { page } = app;
    await page.getByTestId('sessions-firstrun-add-project').click();
    await expect(page.getByTestId('directory-picker')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('directory-picker')).toHaveCount(0);
  });
});

// ─── §sessions-draft — bugfix: zero-session boot opens the project picker ───
//
// Regression coverage: booting into "All" view with projects>0 but 0 sessions
// used to strand the user on the boot draft with no project resolved (no
// FirstRunState — projects exist — and no picker either, since nothing had
// opened it). ChatSurface's boot-settle effect now force-opens the same
// anchored picker after BOOT_SETTLE_MS if the boot draft is still
// unresolved, so the workspace never lands on that dead-end surface.

test.describe('§sessions-draft — zero-session boot (projects>0, no sessions) opens the project picker', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    // createTauriProject reloads the page after seeding the project via REST —
    // the reload remounts the app fresh, i.e. a "boot" with 1 project, 0 chats.
    project = await createTauriProject(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('boot lands on the project picker, not a projectless dead-end surface', async () => {
    const { page } = app;
    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 15_000 });
    // No dead-end draft/session sitting behind the forced picker.
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0);
    await expect(page.getByTestId('sessions-firstrun')).toHaveCount(0);

    await pickProjectFromPicker(page, project.projectId);
    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });
  });
});
