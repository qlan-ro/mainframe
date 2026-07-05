/**
 * §sessions-draft — the new-session Welcome flow (app-tauri browser mode).
 *
 * Covers the rebuilt draft-thread surface: NewSessionPickerPopover (project
 * picker, "All" view) → DraftSessionRow (sidebar synthetic row) → WelcomeState
 * (repo suggestions) / FirstRunState (zero projects), with the chat created
 * ONLY on first send (D3) and no cross-project draft leak on repeated New
 * cycles (the historical slot-reuse regression).
 *
 * `docs/plans/2026-07-03-tauri-e2e-test-plan.md` §6 is STALE (written against a
 * deleted NewThreadConfigPicker) — scenarios below are derived from the CURRENT
 * source: `packages/ui/src/features/sessions/new-thread/` + `sidebar/DraftSessionRow.tsx`
 * + `sidebar/SessionsNewButton.tsx`.
 *
 * Testid reference (verified against source):
 *   sessions-new-button              — sidebar "+" (SessionsNewButton.tsx)
 *   sessions-new-picker              — NewSessionPickerPopover root (All view only)
 *   sessions-new-picker-project-<id> — project row inside the picker
 *   sessions-draft-row               — synthetic draft row (DraftSessionRow.tsx)
 *   sessions-draft-row-title         — draft row's "New Session" title span
 *   sessions-draft-row-discard       — draft row's hover-revealed ✕
 *   sessions-filter-pill-<id>        — project filter pill (ProjectFilterPillBar.tsx)
 *   sessions-filter-pill-all         — "All" filter pill
 *   sessions-welcome                 — WelcomeState root (ChatEmptyState variant='welcome')
 *   sessions-welcome-suggestion-<i>  — one repo-derived suggestion row (SuggestionRow.tsx)
 *   sessions-firstrun                — FirstRunState root (zero projects)
 *   sessions-firstrun-add-project    — FirstRunState's "Add project…" CTA
 *   directory-picker                 — DirectoryPickerModal root (opened by add-project)
 *   chat-composer-input / -send      — composer (usable pre-send on the draft)
 *   composer-model-select / composer-permission-mode-select — config selectors
 *
 * Not covered here (per the plan's "does NOT cover" list / out of scope for this
 * flow): DraftSessionRow's own unit-level styling states, provider-tuning
 * inheritance defaults (chat-header.spec.ts / composer.spec.ts territory).
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar, composer } from '../helpers/tauri/page-objects.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/**
 * Expand the project-pill bar's "+N more" overflow toggle if it's collapsed.
 * The sidebar is a fixed 280px wide and ProjectFilterPillBar's useRowOverflow
 * measures real available width — 2 `mf-e2e-<hex>`-named project pills
 * genuinely don't fit next to "All" + "Add project" at that width, so every
 * per-project-pill interaction in this describe needs the overflow open
 * first, or the pill locator times out waiting on a hidden element (the root
 * cause of the "pill-active New" test's apparent hang/crash below — not a
 * product bug). Mirrors sessions-filters.spec.ts's own helper. Idempotent —
 * a no-op once already expanded.
 */
async function expandProjectPills(page: Page): Promise<void> {
  const more = page.getByTestId('sessions-projects-more');
  if (!(await more.isVisible().catch(() => false))) return;
  if ((await more.getAttribute('aria-expanded')) === 'true') return;
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
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

async function fetchChatProjectId(chatId: string): Promise<string | undefined> {
  const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { data?: { projectId?: string } };
  return body.data?.projectId;
}

/** `createTauriProject` names the project after the temp dir's basename. */
function baseName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] as string;
}

// ─── §sessions-draft — "All" view picker + draft row lifecycle ───────────────

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

    await page.getByTestId(`sessions-new-picker-project-${project.projectId}`).click();
    await expect(page.getByTestId('sessions-new-picker')).toHaveCount(0);

    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    await expect(draftRow).toHaveAttribute('data-active', 'true');
    // The draft is a distinct synthetic row — no new sessions-row was created.
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore);
    await expect(draftRow.getByText(baseName(project.projectPath))).toBeVisible();
  });

  // Depends on the previous test's draft-row surviving — see the fix note
  // documented on the test above.
  test('composer config selectors are usable on the unsent draft', async () => {
    const { page } = app;
    // Continues from the previous test's active draft.
    await expect(page.getByTestId('sessions-draft-row')).toBeVisible({ timeout: 10_000 });
    await expect(composer(page).input()).toBeVisible({ timeout: 10_000 });

    const modelTrigger = page.getByTestId('composer-model-select');
    await expect(modelTrigger).toBeVisible({ timeout: 10_000 });
    await expect(modelTrigger).toBeEnabled();
    await modelTrigger.click();
    await expect(page.locator('[data-testid^="composer-model-select-option-"]').first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press('Escape');

    const permTrigger = page.getByTestId('composer-permission-mode-select');
    await expect(permTrigger).toBeVisible();
    await expect(permTrigger).toBeEnabled();
    await permTrigger.click();
    await expect(page.getByTestId('composer-permission-mode-select-option-default')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });

  // Depends on a draft-row existing to discard — see the fix note documented
  // on the first test in this describe block.
  test('discarding the draft (✕) clears the row and returns to the previously active session', async () => {
    const { page } = app;
    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });

    await draftRow.hover();
    await draftRow.getByTestId('sessions-draft-row-discard').click();

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
    const idsBefore = await page
      .getByTestId('sessions-row')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));

    await sidebar.newButton().click();
    await page.getByTestId(`sessions-new-picker-project-${project.projectId}`).click();
    await expect(page.getByTestId('sessions-draft-row')).toBeVisible({ timeout: 10_000 });
    // Still no new sessions-row while the draft is unsent.
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore);

    await composer(page).submit('e2e draft first-send test');

    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore + 1, { timeout: 20_000 });
    const idsAfter = await page
      .getByTestId('sessions-row')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));
    const newChatId = idsAfter.find((id) => id != null && !idsBefore.includes(id));
    expect(newChatId).toBeTruthy();

    const projectId = await fetchChatProjectId(newChatId as string);
    expect(projectId).toBe(project.projectId);
  });
});

// ─── §sessions-draft — pill-active skip + no cross-project leak ──────────────

test.describe('§sessions-draft — pill-active skip + no leak across New cycles', () => {
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

  // Previously reported as a page/browser crash on this project pill click —
  // re-triaged as an e2e-only issue, not a product bug: at the sidebar's fixed
  // 280px width, both `mf-e2e-<hex>`-named project pills collapse behind the
  // "+N more" overflow toggle (`useRowOverflow`), so the un-expanded pill
  // locator was never actionable and the click hung out the full test
  // timeout. `expandProjectPills` (above) opens the overflow first.
  //
  // FIXED (commit 3368d065): discard (✕) never cleared the draft row when a
  // project filter pill was active. `use-draft-row.ts`'s `onDiscard` now marks
  // the draft in a discarded-drafts suppression set before resetting, so the
  // row clears reliably under an active project filter.
  test('with a project pill active, New skips the picker and the draft inherits that project', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    await expandProjectPills(page);

    await sidebar.projectFilterPill(projectA.projectId).click();
    await expect(sidebar.projectFilterPill(projectA.projectId)).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });

    await sidebar.newButton().click();
    // No picker — the draft resolves straight from the active pill.
    await expect(page.getByTestId('sessions-new-picker')).toHaveCount(0);

    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    // DraftSessionRow's own project chip only renders in "All" view
    // (`showProject`, per its own doc comment) — with a project pill active,
    // the sidebar row deliberately omits it (same pattern as
    // `sessions-row-meta-project`). Assert the project on the chat header's
    // own chip instead, which always renders for a draft regardless of pill
    // state (ChatCardHeaderDraft's `chat-header-project`).
    await expect(page.getByTestId('chat-header-project')).toContainText(baseName(projectA.projectPath));

    // Clean up: discard, then clear the pill for the next test.
    await draftRow.hover();
    await draftRow.getByTestId('sessions-draft-row-discard').click();
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(0, { timeout: 10_000 });
    await sidebar.projectFilterPill(projectA.projectId).click();
  });

  test('abandoning a draft in project A does not leak into a second New picking project B', async () => {
    const { page } = app;
    const sidebar = sessionsSidebar(page);
    // Guarantee "All" view.
    await expect(page.getByTestId('sessions-new-button')).toBeVisible();

    const rowsBefore = await page.getByTestId('sessions-row').count();
    const idsBefore = await page
      .getByTestId('sessions-row')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));

    // First New: pick project A.
    await sidebar.newButton().click();
    await page.getByTestId(`sessions-new-picker-project-${projectA.projectId}`).click();
    const draftRow = page.getByTestId('sessions-draft-row');
    await expect(draftRow).toBeVisible({ timeout: 10_000 });
    await expect(draftRow.getByText(baseName(projectA.projectPath))).toBeVisible();

    // WITHOUT sending, click New again — the reused draft slot must not stack.
    await sidebar.newButton().click();
    await expect(page.getByTestId('sessions-new-picker')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(1);

    // This time pick project B — the stale A config must be fully replaced, not merged.
    await page.getByTestId(`sessions-new-picker-project-${projectB.projectId}`).click();
    await expect(page.getByTestId('sessions-draft-row')).toHaveCount(1);
    await expect(draftRow.getByText(baseName(projectB.projectPath))).toBeVisible({ timeout: 10_000 });
    await expect(draftRow.getByText(baseName(projectA.projectPath))).toHaveCount(0);

    // Commit it and verify on the daemon side: the created chat belongs to B, not A.
    await composer(page).submit('e2e no-leak regression test');
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore + 1, { timeout: 20_000 });
    const idsAfter = await page
      .getByTestId('sessions-row')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-id')));
    const newChatId = idsAfter.find((id) => id != null && !idsBefore.includes(id));
    expect(newChatId).toBeTruthy();

    const projectId = await fetchChatProjectId(newChatId as string);
    expect(projectId).toBe(projectB.projectId);
    expect(projectId).not.toBe(projectA.projectId);
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
    await page.getByTestId(`sessions-new-picker-project-${project.projectId}`).click();

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
