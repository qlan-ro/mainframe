/**
 * §composer-advanced — Triggers (`@`/`/`), quote, worktree popover, and the daemon-backed
 * mid-run queue. Extends `composer.spec.ts` (config selects/attachments) and `chat.spec.ts`
 * (gates) — nothing here duplicates those.
 *
 * Testid reference:
 *   composer-trigger-popover        — shared shell for both `/` and `@` trigger popovers
 *   composer-skill-item-{id}        — `/` skill row (id = invocationName, no plugin prefix here)
 *   composer-file-item-{id}         — `@` file/directory row (id = repo-relative path)
 *   composer-add-mention            — "@" toolbar button (appends `@` to the composer text)
 *   composer-prompt-highlight       — color-only overlay behind the transparent textarea
 *   chat-selection-toolbar/-quote   — floating "Quote" button on text selection (native)
 *   composer-quote-preview/-dismiss — dismissable quote pill above the composer input
 *   composer-worktree-trigger/-popover/-active-info/-mid-session-warning
 *   composer-worktree-tab-new/-existing, -base-branch(-list/-option-*), -branch-name
 *   composer-worktree-enable/-cancel/-attach-{path}
 *   chat-composer-edit(-input/-cancel/-save) — queued-message edit mode (swaps the composer)
 *   chat-queued-message/-edit/-cancel        — queued user turn + its hover actions
 *
 * `/` skills: the mock-cli adapter has no `listSkills` (plugins/mock-cli/src/adapter.ts —
 * verified, not implemented), so `/api/adapters/mock-cli/skills` 404s and the skills list is
 * always empty under the default mock chat. The builtin `claude` adapter's `listSkills` is a
 * pure filesystem scan (packages/core/src/plugins/builtin/claude/skills.ts) with no CLI spawn,
 * so the skill-trigger describe below creates its chat with `adapterId: 'claude'` and never
 * calls `sendMessage` on it — no real API call happens, only the skills REST scan.
 *
 * Orphaned finding (see report): `QuoteBlock` (components/ui/assistant-ui/quote.tsx) is
 * exported but never mounted in UserMessage.tsx — a sent message does NOT render a quote block
 * today. The plan's "sent message renders quote block" sub-scenario is skipped with a TODO.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

async function clearComposer(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('chat-composer-input').fill('');
}

// ─── `@` mention trigger ───────────────────────────────────────────────────────

test.describe('§composer mention trigger (@)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // Known filenames for the `@` fuzzy search + a nested dir for tree drill-down.
    mkdirSync(path.join(project.projectPath, 'notes'), { recursive: true });
    writeFileSync(path.join(project.projectPath, 'notes', 'todo.md'), '- write more e2e specs\n');
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('typing @ opens the file mention popover and lists a known project file', async () => {
    const { page } = app;
    await clearComposer(page);
    await page.getByTestId('chat-composer-input').fill('@index');
    const item = page.getByTestId('composer-file-item-index.ts');
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toContainText('index.ts');
  });

  test('picking a file inserts the mention token and closes the popover', async () => {
    const { page } = app;
    await page.getByTestId('composer-file-item-index.ts').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('@index.ts ');
    await expect(page.getByTestId('composer-trigger-popover')).toHaveCount(0);
  });

  test('picking a directory keeps the token open for drill-down', async () => {
    const { page } = app;
    await clearComposer(page);
    // "./" enters project-tree mode at the root (classifyMention: dir="." → tree, not fs).
    await page.getByTestId('chat-composer-input').fill('@./');
    const dirItem = page.getByTestId('composer-file-item-notes');
    await expect(dirItem).toBeVisible({ timeout: 8_000 });
    await dirItem.click();

    // Directory pick drops the native trigger's closing space (dropDirectoryClosingSpace),
    // so the token stays open — exact text, no trailing space.
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('@notes/');
    // The popover must still be open, now listing notes/ contents (drill-down).
    await expect(page.getByTestId('composer-file-item-notes/todo.md')).toBeVisible({ timeout: 8_000 });
  });

  test('Escape closes the trigger popover without clearing the typed text', async () => {
    const { page } = app;
    await clearComposer(page);
    await page.getByTestId('chat-composer-input').fill('@ind');
    await expect(page.getByTestId('composer-file-item-index.ts')).toBeVisible({ timeout: 8_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer-trigger-popover')).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('@ind');
  });

  test('the add-mention toolbar button appends @ to the composer text', async () => {
    const { page } = app;
    await clearComposer(page);
    await page.getByTestId('chat-composer-input').fill('check ');
    await page.getByTestId('composer-add-mention').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('check @');
  });

  test('a typed mention renders as its own colored node in the highlight overlay', async () => {
    const { page } = app;
    await clearComposer(page);
    await page.getByTestId('chat-composer-input').fill('please read @index.ts');
    const overlay = page.getByTestId('composer-prompt-highlight');
    await expect(overlay).toBeVisible();
    // render-highlights wraps the mention in its own <span> (colorClass.mention) — the plain
    // text ("please read ") and the mention are separate nodes, not one run.
    await expect(overlay.locator('span', { hasText: '@index.ts' })).toHaveText('@index.ts');
  });
});

// ─── `/` skill trigger (real `claude` adapter, filesystem-only — no CLI spawn) ────────────────

test.describe('§composer skill trigger (/)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    const skillDir = path.join(project.projectPath, '.claude', 'skills', 'greet-user');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: Greet User\ndescription: Say a friendly hello\n---\n\nSay hello to the user.\n',
    );
    // adapterId 'claude' so listSkills (a pure fs scan, packages/core/.../claude/skills.ts) runs —
    // mock-cli has no listSkills. No sendMessage is ever called on this chat.
    await createTauriChat(app.page, project.projectId, 'default', 'claude');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('typing / lists the project skill; picking it inserts the literal /skill token', async () => {
    const { page } = app;
    await page.getByTestId('chat-composer-input').fill('/');
    const item = page.getByTestId('composer-skill-item-greet-user');
    await expect(item).toBeVisible({ timeout: 8_000 });
    await expect(item).toContainText('Greet User');

    await item.click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('/greet-user ');
    await expect(page.getByTestId('composer-trigger-popover')).toHaveCount(0);
  });
});

// ─── Quote (select-to-quote) + worktree mid-session warning (needs hasMessages) ───────────────

test.describe('§composer quote + worktree mid-session warning', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('selecting assistant text shows the floating Quote button', async () => {
    const { page } = app;
    await sendMessage(page, 'List the files in this project using bash ls.');
    await waitForIdle(page, 90_000);

    const lastAssistant = page.getByTestId('chat-assistant-message').last();
    await expect(lastAssistant).toContainText('Files in the project', { timeout: 10_000 });

    // Programmatic selection (deterministic vs. dblclick word-boundary guessing): select the
    // word "project" inside the assistant's final text reply and fire the native 'mouseup' the
    // SelectionToolbarPrimitive.Root listens for (checkSelection reads window.getSelection()).
    await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-testid="chat-assistant-message"]');
      const last = messages[messages.length - 1];
      if (!last) throw new Error('no assistant message found');
      const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
      let target: Text | null = null;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const t = node as Text;
        if (t.textContent?.includes('project')) {
          target = t;
          break;
        }
      }
      if (!target?.textContent) throw new Error('quote target text not found');
      const idx = target.textContent.indexOf('project');
      const range = document.createRange();
      range.setStart(target, idx);
      range.setEnd(target, idx + 'project'.length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await expect(page.getByTestId('chat-selection-toolbar')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('chat-selection-quote')).toBeVisible();
  });

  test('clicking Quote adds a quote preview pill above the composer', async () => {
    const { page } = app;
    await page.getByTestId('chat-selection-quote').click();
    const preview = page.getByTestId('composer-quote-preview');
    await expect(preview).toBeVisible({ timeout: 5_000 });
    await expect(preview).toContainText('project');
  });

  test('dismissing the quote preview clears it', async () => {
    const { page } = app;
    await page.getByTestId('composer-quote-dismiss').click();
    await expect(page.getByTestId('composer-quote-preview')).toHaveCount(0);
  });

  // TODO(app-tauri): QuoteBlock (components/ui/assistant-ui/quote.tsx) is exported but never
  // mounted in UserMessage.tsx — a sent message renders no quote block today. Un-skip once it's
  // wired (or drop if the design deliberately keeps quoting composer-only).
  test.skip('a sent message with an active quote renders a quote block', async () => {
    // TODO(app-tauri): QuoteBlock is orphaned — see the file-level docstring.
  });

  test('worktree popover shows a mid-session warning once the chat has messages', async () => {
    const { page } = app;
    await page.getByTestId('composer-worktree-trigger').click();
    // Loaded state (branches/worktrees fetched, not the loading spinner).
    await expect(page.getByTestId('composer-worktree-tab-new')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('composer-worktree-mid-session-warning')).toBeVisible();
    await page.getByTestId('composer-worktree-cancel').click();
    await expect(page.getByTestId('composer-worktree-popover')).toHaveCount(0);
  });
});

// ─── Worktree popover setup (no messages yet — New/Existing tabs, validation, enable) ─────────

test.describe('§composer worktree setup', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let existingWorktreePath: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    // A real, pre-existing worktree so the "Existing" tab has a row to list.
    existingWorktreePath = `${project.projectPath}-wt`;
    execFileSync('git', ['worktree', 'add', '-b', 'preexisting-wt', existingWorktreePath, 'main'], {
      cwd: project.projectPath,
      stdio: 'pipe',
    });
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    rmSync(existingWorktreePath, { recursive: true, force: true });
    await closeTauriApp(app);
  });

  test('New tab shows the current base branch; invalid branch names disable Enable', async () => {
    const { page } = app;
    await page.getByTestId('composer-worktree-trigger').click();
    const baseBranch = page.getByTestId('composer-worktree-base-branch');
    await expect(baseBranch).toBeVisible({ timeout: 10_000 });
    await expect(baseBranch).toContainText('main (current)');
    await expect(page.getByTestId('composer-worktree-enable')).toBeDisabled();

    const popover = page.getByTestId('composer-worktree-popover');
    const branchName = page.getByTestId('composer-worktree-branch-name');
    await branchName.fill('bad branch!');
    await expect(popover.getByText('Invalid characters')).toBeVisible();
    await expect(page.getByTestId('composer-worktree-enable')).toBeDisabled();

    await branchName.fill('feat/e2e-worktree');
    await expect(page.getByTestId('composer-worktree-enable')).toBeEnabled();

    await page.getByTestId('composer-worktree-cancel').click();
    await expect(page.getByTestId('composer-worktree-popover')).toHaveCount(0);
  });

  test('Existing tab lists the pre-existing project worktree', async () => {
    const { page } = app;
    await page.getByTestId('composer-worktree-trigger').click();
    await expect(page.getByTestId('composer-worktree-tab-new')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('composer-worktree-tab-existing').click();
    const row = page.getByTestId(`composer-worktree-attach-${existingWorktreePath}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('preexisting-wt');

    await page.getByTestId('composer-worktree-cancel').click();
    await expect(page.getByTestId('composer-worktree-popover')).toHaveCount(0);
  });

  test('Enable creates a new worktree; reopening shows the active-info readout', async () => {
    const { page } = app;
    await page.getByTestId('composer-worktree-trigger').click();
    await expect(page.getByTestId('composer-worktree-tab-new')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('composer-worktree-branch-name').fill('feat/e2e-enable-test');
    await page.getByTestId('composer-worktree-enable').click();
    // Popover self-closes on success (handleEnable → setOpen(false)) — real git worktree add.
    await expect(page.getByTestId('composer-worktree-popover')).toHaveCount(0, { timeout: 15_000 });

    await page.getByTestId('composer-worktree-trigger').click();
    const activeInfo = page.getByTestId('composer-worktree-active-info');
    await expect(activeInfo).toBeVisible({ timeout: 10_000 });
    await expect(activeInfo).toContainText('Isolated in worktree');
    await expect(activeInfo).toContainText('feat/e2e-enable-test');
  });
});

// ─── Mid-run queue (edit / cancel / flush-on-run-end) ──────────────────────────────────────────

test.describe('§composer queue', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    // The recording's first interaction ends in a Write permission gate — the run stays
    // "running" while the gate is pending, which is what makes Enter mid-run queue instead of
    // send (Composer.tsx: SendOrCancelButton swaps to Cancel while running).
    app = await launchTauriApp({ recordingKey: 'permissions-interactive' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('sending a message while the run is active queues it at the thread tail', async () => {
    const { page } = app;
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });

    // Enter (not the Send button — it's replaced by Cancel while running) queues mid-run.
    const input = page.getByTestId('chat-composer-input');
    await input.fill('First queued note');
    await input.press('Enter');

    const queued = page.getByTestId('chat-queued-message').filter({ hasText: 'First queued note' });
    await expect(queued).toBeVisible({ timeout: 10_000 });
    await expect(queued).toContainText('Queued · sends after the current run');
  });

  test('hover Edit swaps the composer into edit mode; Esc cancels without changes', async () => {
    const { page } = app;
    const queued = page.getByTestId('chat-queued-message').filter({ hasText: 'First queued note' });
    await queued.hover();
    await queued.getByTestId('chat-queued-edit').click();

    const editShell = page.getByTestId('chat-composer-edit');
    await expect(editShell).toBeVisible({ timeout: 5_000 });
    await expect(editShell).toContainText('Editing queued message');
    await expect(page.getByTestId('chat-composer-edit-input')).toHaveValue('First queued note');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-composer-edit')).toHaveCount(0);
    await expect(page.getByTestId('chat-composer')).toBeVisible();
    // Unaffected by the cancelled edit.
    await expect(queued).toContainText('First queued note');
  });

  test('editing a queued message and saving (Ctrl/⌘+Enter) updates its content', async () => {
    const { page } = app;
    const queued = page.getByTestId('chat-queued-message').filter({ hasText: 'First queued note' });
    await queued.hover();
    await queued.getByTestId('chat-queued-edit').click();

    const editInput = page.getByTestId('chat-composer-edit-input');
    await expect(editInput).toBeVisible({ timeout: 5_000 });
    await editInput.fill('Edited queued note');
    // ComposerEditMode's handler accepts either metaKey or ctrlKey — Control+Enter is portable
    // across the macOS/Linux CI runners this suite targets.
    await editInput.press('Control+Enter');

    await expect(page.getByTestId('chat-composer-edit')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('chat-queued-message').filter({ hasText: 'Edited queued note' })).toBeVisible();
  });

  test('a second queued message gets FIFO position 2; Cancel removes it', async () => {
    const { page } = app;
    const input = page.getByTestId('chat-composer-input');
    await input.fill('Second queued note');
    await input.press('Enter');

    const first = page.getByTestId('chat-queued-message').filter({ hasText: 'Edited queued note' });
    const second = page.getByTestId('chat-queued-message').filter({ hasText: 'Second queued note' });
    await expect(second).toBeVisible({ timeout: 10_000 });
    await expect(first).toContainText('Queued · sends next, after the current run');
    await expect(second).toContainText('2nd to send');

    await second.hover();
    await second.getByTestId('chat-queued-cancel').click();
    await expect(second).toHaveCount(0, { timeout: 5_000 });
    // Back to a single queued item — singular FIFO label.
    await expect(first).toContainText('Queued · sends after the current run');
  });

  test('the queued message flushes and sends once the run ends', async () => {
    const { page } = app;
    // Deny the pending gate — ends the recorded interaction (onToolResult/onResult), which
    // triggers ChatManager.flushNextQueued and sends "Edited queued note" for real.
    await page.getByTestId('chat-permission-deny').click();

    await expect(page.getByTestId('chat-queued-message')).toHaveCount(0, { timeout: 45_000 });
    await expect(page.getByTestId('chat-user-message').filter({ hasText: 'Edited queued note' })).toBeVisible();

    // The flushed send is a real new turn (interaction #2 in the recording) — it hits another
    // Write permission gate. Answer it so the mock session ends cleanly.
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-permission-deny').click();
    await waitForIdle(page, 60_000);
  });
});
