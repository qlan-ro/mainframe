/**
 * §context-panel — BottomPanel (Context / Skills / Agents sidebar tabs) specs.
 *
 * Cluster A, spec #7 of docs/plans/2026-07-03-tauri-e2e-test-plan.md.
 *
 * Source read: packages/ui/src/features/context-panel/{BottomPanel,ContextInspector,
 * ContextSection,ContextFileItem,TasksSection,SessionAttachmentsGrid,SkillsList,AgentsList,
 * ScopedListRow,use-session-context,use-sidebar-skills,derive-session-items}.tsx,
 * packages/ui/src/store/session-todos.ts, packages/core/src/chat/context-tracker.ts,
 * packages/core/src/server/routes/{context,attachments,skills,agents}.ts,
 * packages/e2e/plugins/mock-cli/src/{adapter,session}.ts.
 *
 * ── Ground-truth data-source decision (read before editing) ──────────────────
 * The mock-cli adapter used by every E2E_MODE=mock chat CANNOT populate most of
 * SessionContext:
 *   - `ReplaySession.getContextFiles()` (session.ts) is hardcoded to return
 *     `{ global: [], project: [] }` — Global/Project sections are ALWAYS empty
 *     for a mock-cli chat, seeded CLAUDE.md or not.
 *   - `ReplaySession.extractPlanFiles()` / `.extractSkillFiles()` are hardcoded
 *     to return `[]` — modifiedFiles/skillFiles (the 'plan'/'skill' badge
 *     sources for the Session group) never populate either, regardless of what
 *     tool calls a recording replays.
 * `MockCliAdapter` NOW implements `listSkills`/`listAgents` (project-scope only,
 * `.claude/skills/<name>/SKILL.md` + `.claude/agents/<name>.md` — see
 * plugins/mock-cli/src/skills.ts), so seeding those directories in the temp
 * project IS reflected in the Skills/Agents tabs — see the dedicated describe
 * below. `useSidebarSkills` keys the fetch off `useActiveIdentity()`'s
 * `projectPath`/`adapterId`, so a chat must be active first.
 * The only two SessionContext fields NOT wired through the adapter are
 * `mentions` (`POST /api/chats/:id/mentions`, public REST) and `attachments`
 * (`POST /api/chats/:id/attachments`, public REST) — both persist straight to
 * the daemon DB/attachment-store independent of the adapter, so they are the
 * reliable, adapter-agnostic way to put real rows in the Session group without
 * an agent turn (or the `context-tab` recording, which was read but doesn't
 * change any of the above — its Edit/Read tool calls never reach
 * modifiedFiles/skillFiles under mock-cli either).
 *
 * Testid reference (verified against source):
 *   sidebar-bottom-tab-track          — BottomPanel.tsx tab bar container
 *   sidebar-bottom-tab-<context|skills|agents> — tab buttons (active tab carries
 *                                        the `bg-mf-tab-active` class; no aria-pressed)
 *   sidebar-context-section-<global|project|session> — ContextSection header button
 *                                        (testid = `title.toLowerCase()`), toggles open/closed
 *   sidebar-context-item-<path>       — ContextFileItem row; click emits open-file
 *   context-tasks-section             — TasksSection root (only rendered when todos.length>0)
 *   context-tasks-progress-fill       — TasksSection progress bar fill
 *   context-task-row-<content>        — a single todo row
 *   sidebar-skill-item-<id> / sidebar-agent-item-<id> — ScopedListRow (SkillsList/AgentsList)
 *   sidebar-attachment-<id>           — SessionAttachmentsGrid thumbnail button
 *   image-lightbox-dialog             — ImageLightbox Dialog content (opened by an image thumb)
 *   files-tab-strip                   — layout/FilesTabStrip.tsx (opened file tabs land here)
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitConnected, waitForIdle } from '../helpers/tauri/wait.js';
import { sessionsSidebar, composer } from '../helpers/tauri/page-objects.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

// A 1x1 transparent PNG — small enough to round-trip instantly through the
// attachment store, real enough for SessionAttachmentsGrid to render an <img>.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function addFileMention(chatId: string, path: string): Promise<void> {
  const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/mentions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'file', name: path.split('/').pop() ?? path, path }),
  });
  if (!res.ok) throw new Error(`addFileMention: POST /mentions failed (${res.status} ${await res.text()})`);
}

interface SeedAttachment {
  name: string;
  mediaType: string;
  data: string;
  kind: 'image' | 'file';
}

/** Seed attachments via the daemon's public upload route; returns their assigned ids in order. */
async function addAttachments(chatId: string, attachments: SeedAttachment[]): Promise<string[]> {
  const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments }),
  });
  if (!res.ok) throw new Error(`addAttachments: POST /attachments failed (${res.status} ${await res.text()})`);
  const body = (await res.json()) as { data: { attachments: { id: string }[] } };
  return body.data.attachments.map((a) => a.id);
}

/** Re-select a chat row (e.g. after a full page reload, which does not preserve the active thread). */
async function selectChat(page: Page, chatId: string): Promise<void> {
  await sessionsSidebar(page).row(chatId).click();
  await composer(page).input().waitFor({ timeout: 12_000 });
}

/** Read a ContextSection/tab's trailing count chip — always the last <span> in the button. */
function countChip(button: ReturnType<Page['getByTestId']>) {
  return button.locator('span').last();
}

// ─── §context-panel — no active chat ──────────────────────────────────────────

test.describe('§context-panel — no active chat', () => {
  let app: TauriAppFixture;

  test.beforeAll(async () => {
    app = await launchTauriApp();
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
  });

  test('bottom tabs render with zero counts before any chat is active', async () => {
    const { page } = app;
    await expect(countChip(page.getByTestId('sidebar-bottom-tab-context'))).toHaveText('0');
    await expect(countChip(page.getByTestId('sidebar-bottom-tab-skills'))).toHaveText('0');
    await expect(countChip(page.getByTestId('sidebar-bottom-tab-agents'))).toHaveText('0');
  });

  test('the Context tab shows the no-active-chat empty state', async () => {
    const { page } = app;
    await expect(page.getByText('No active chat')).toBeVisible({ timeout: 10_000 });
  });
});

// ─── §context-panel — tab switching (Skills/Agents guaranteed-empty under mock-cli) ──

test.describe('§context-panel — tab switching', () => {
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

  test('Context is the default active tab and renders the Global/Project/Session sections', async () => {
    const { page } = app;
    const contextTab = page.getByTestId('sidebar-bottom-tab-context');
    await expect(contextTab).toHaveClass(/bg-mf-tab-active/);
    await expect(page.getByTestId('sidebar-context-section-global')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sidebar-context-section-project')).toBeVisible();
    await expect(page.getByTestId('sidebar-context-section-session')).toBeVisible();
    // No mentions/attachments/plan/skill files exist yet for this chat — 0 across the board.
    await expect(countChip(page.getByTestId('sidebar-context-section-global'))).toHaveText('0');
    await expect(countChip(page.getByTestId('sidebar-context-section-project'))).toHaveText('0');
    await expect(countChip(page.getByTestId('sidebar-context-section-session'))).toHaveText('0');
  });

  test('switching to Skills shows the empty state and marks Skills as the active tab', async () => {
    const { page } = app;
    const skillsTab = page.getByTestId('sidebar-bottom-tab-skills');
    await skillsTab.click();
    await expect(skillsTab).toHaveClass(/bg-mf-tab-active/);
    await expect(page.getByTestId('sidebar-bottom-tab-context')).not.toHaveClass(/bg-mf-tab-active/);
    // This project seeds no `.claude/skills` dir — MockCliAdapter.listSkills tolerates the
    // missing dir and resolves []. The seeded-skills case is covered in the describe below.
    await expect(page.getByText('No skills')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sidebar-context-section-global')).toHaveCount(0);
  });

  test('switching to Agents shows the empty state and marks Agents as the active tab', async () => {
    const { page } = app;
    const agentsTab = page.getByTestId('sidebar-bottom-tab-agents');
    await agentsTab.click();
    await expect(agentsTab).toHaveClass(/bg-mf-tab-active/);
    await expect(page.getByText('No agents')).toBeVisible({ timeout: 10_000 });
  });

  test('switching back to Context restores the section body', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-bottom-tab-context').click();
    await expect(page.getByTestId('sidebar-context-section-global')).toBeVisible({ timeout: 10_000 });
  });
});

// ─── §context-panel — Skills/Agents rows (seeded .claude/skills|agents) ──────

test.describe('§context-panel — skills and agents rows', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);

    // MockCliAdapter.listSkills/listAgents scan ONLY `<projectPath>/.claude/{skills,agents}`
    // (plugins/mock-cli/src/skills.ts) — seed both before selecting the chat that triggers
    // useSidebarSkills's fetch.
    const skillDir = path.join(project.projectPath, '.claude', 'skills', 'write-tests');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Write Tests\ndescription: Write comprehensive unit tests for a module.\n---\n\n# Write Tests\n',
    );
    const agentDir = path.join(project.projectPath, '.claude', 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'code-reviewer.md'),
      '# Code Reviewer\n\nReviews code changes for quality issues.\n',
    );

    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a skill row click opens its SKILL.md in the editor', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-bottom-tab-skills').click();

    const row = page.getByTestId('sidebar-skill-item-mock-cli:project:write-tests');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('/Write Tests');

    await row.click();
    const strip = page.getByTestId('files-tab-strip');
    await expect(strip.getByRole('tab', { selected: true })).toContainText('SKILL.md', { timeout: 10_000 });
  });

  test('an agent row click opens its agent file in the editor', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-bottom-tab-agents').click();

    const row = page.getByTestId('sidebar-agent-item-mock-cli:project:agent:code-reviewer');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('code-reviewer');

    await row.click();
    const strip = page.getByTestId('files-tab-strip');
    await expect(strip.getByRole('tab', { selected: true })).toContainText('code-reviewer.md', { timeout: 10_000 });
  });
});

// ─── §context-panel — Tasks section (todo-write) ──────────────────────────────

test.describe('§context-panel — tasks section', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'todo-write' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  // The recording's TodoWrite call also renders as a visible ToolFallback card
  // under mock-cli (its `hidden` category set is deliberately empty — see
  // RECORDING-STATUS.md), but that doesn't affect the Tasks section itself,
  // which reads only the `todos.updated` store, not message content.
  test('renders the progress fill and per-todo rows, with completed rows struck through', async () => {
    const { page } = app;
    await sendMessage(page, 'Track two todos: write the README, then run the test suite');
    await waitForIdle(page, 60_000);

    const section = page.getByTestId('context-tasks-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // 1 of 2 todos completed → 50% fill (inline `style={{width: '50%'}}`, not
    // resolvable via getComputedStyle since it's percentage-based).
    await expect(section.getByTestId('context-tasks-progress-fill')).toHaveAttribute('style', /width:\s*50%/);

    const doneRow = section.getByTestId('context-task-row-Write the README');
    await expect(doneRow).toBeVisible();
    await expect(doneRow).toContainText('Write the README');
    await expect(doneRow.locator('span').last()).toHaveClass(/line-through/);

    // in_progress rows render their activeForm as the label, not struck through.
    const inProgressRow = section.getByTestId('context-task-row-Run the test suite');
    await expect(inProgressRow).toBeVisible();
    await expect(inProgressRow).toContainText('Running the test suite');
    await expect(inProgressRow.locator('span').last()).not.toHaveClass(/line-through/);
  });
});

// ─── §context-panel — sections, file-open, and attachments (REST-seeded) ─────────

test.describe('§context-panel — sections, file-open, and attachments', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;
  let imageAttachmentId: string;
  let fileAttachmentId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default');

    // Seed via public daemon REST routes (see file header for why this is the reliable path
    // under mock-cli, instead of driving an agent turn): one user file mention (Session badge
    // '@') plus one image + one non-image attachment.
    await addFileMention(chatId, 'index.ts');
    const ids = await addAttachments(chatId, [
      { name: 'thumb.png', mediaType: 'image/png', data: TINY_PNG_BASE64, kind: 'image' },
      { name: 'notes.txt', mediaType: 'text/plain', data: Buffer.from('hello').toString('base64'), kind: 'file' },
    ]);
    imageAttachmentId = ids[0]!;
    fileAttachmentId = ids[1]!;

    // Attachment upload does not broadcast a WS event (only addMention does) — reload to force
    // a fresh GET /api/chats/:id/context fetch that picks up everything seeded above.
    await app.page.reload();
    await waitConnected(app.page);
    await selectChat(app.page, chatId);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the Session section count reflects the mention plus both attachments, and the mention row carries the @ badge', async () => {
    const { page } = app;
    const sessionSection = page.getByTestId('sidebar-context-section-session');
    await expect(countChip(sessionSection)).toHaveText('3', { timeout: 10_000 });
    // Global/Project stay empty under mock-cli regardless of the seeded mention/attachments.
    await expect(countChip(page.getByTestId('sidebar-context-section-global'))).toHaveText('0');
    await expect(countChip(page.getByTestId('sidebar-context-section-project'))).toHaveText('0');

    const item = page.getByTestId('sidebar-context-item-index.ts');
    await expect(item).toBeVisible();
    await expect(item).toContainText('@');
  });

  test('the bottom Context tab count badge matches the total context item count', async () => {
    const { page } = app;
    await expect(countChip(page.getByTestId('sidebar-bottom-tab-context'))).toHaveText('3', { timeout: 10_000 });
  });

  test('clicking the file item opens it in the Files surface as an editor tab', async () => {
    const { page } = app;
    await page.getByTestId('sidebar-context-item-index.ts').click();
    const strip = page.getByTestId('files-tab-strip');
    await expect(strip.getByRole('tab', { selected: true })).toContainText('index.ts', { timeout: 10_000 });
  });

  test('attachment thumbnails render; the image thumb opens the lightbox', async () => {
    const { page } = app;
    const imageThumb = page.getByTestId(`sidebar-attachment-${imageAttachmentId}`);
    const fileThumb = page.getByTestId(`sidebar-attachment-${fileAttachmentId}`);
    await expect(imageThumb).toBeVisible({ timeout: 10_000 });
    await expect(fileThumb).toBeVisible();

    // Wait for the async attachment fetch to resolve into a real <img> before clicking —
    // SessionAttachmentsGrid only adds an attachment to the lightbox's image set once loaded.
    await expect(imageThumb.locator('img')).toBeVisible({ timeout: 10_000 });
    await imageThumb.click();
    await expect(page.getByTestId('image-lightbox-dialog')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('image-lightbox-dialog')).toHaveCount(0, { timeout: 5_000 });
  });

  test('the non-image thumb does not open the lightbox', async () => {
    const { page } = app;
    await page.getByTestId(`sidebar-attachment-${fileAttachmentId}`).click();
    await expect(page.getByTestId('image-lightbox-dialog')).toHaveCount(0);
  });

  test('collapsing the Session section header hides its rows; clicking again restores them', async () => {
    const { page } = app;
    const header = page.getByTestId('sidebar-context-section-session');
    const item = page.getByTestId('sidebar-context-item-index.ts');
    await expect(item).toBeVisible();

    await header.click();
    await expect(item).toHaveCount(0, { timeout: 5_000 });

    await header.click();
    await expect(item).toBeVisible({ timeout: 5_000 });
  });
});
