/**
 * §git-branch — branch menu (BranchPopover) specs.
 *
 * Cluster D, spec #27 of docs/plans/2026-07-03-tauri-e2e-test-plan.md, rewired for
 * the v2 design-system port: BranchPopover is a native Radix **DropdownMenu** now,
 * not a Popover, and that changes the flow of nearly every scenario here.
 *
 * ── The trigger moved out of the chrome (2026-08-11) ─────────────────────────
 * `main-toolbar-branch` is GONE — MainToolbar carries session tabs and workspace
 * controls only, and its docstring says branch management "lives on the welcome
 * screen and on the session panel's branch row". The popover itself is unchanged
 * (same component, same inner testids), so this file swaps the trigger and keeps
 * every scenario:
 *   • `session-panel-summary-branch` — the Session card's branch row
 *     (SummarySection.tsx `BranchRowView`), a BUTTON wrapping the same
 *     `BranchPopover` with the session's `chatId`, so its git writes still land in
 *     the chat's worktree. This is the trigger for every mutating scenario below.
 *     It renders as a STATIC div (no popover) for a worktree DRAFT, where there is
 *     no chatId and a write would hit the project ROOT — not a state this file
 *     reaches, but the reason the row is not always a button.
 *   • `welcome-branch` — the draft welcome screen's branch pill
 *     (WelcomeState.tsx), the same popover scoped to the PROJECT (no chatId).
 *     Covered by one read-only test at the end of this file; mutating from there
 *     would rewrite the project root's checkout, which every other test depends on.
 * The row lives inside the session panel's Session card, which only stacks inline
 * when the chat host clears `INLINE_MIN_WIDTH` (1468, panel-mode.ts) — hence the
 * explicit wide viewport in `beforeAll`. Narrower it would only float, and every
 * dialog interaction here would light-dismiss it.
 *
 * WHAT THE MENU PORT CHANGED (all read from packages/ui/src/features/git/*.tsx):
 *   • Selecting ANY menu item CLOSES THE WHOLE MENU. Radix closes the root on
 *     item-select unless the handler calls `preventDefault()`, and only
 *     `git-update-all` / `git-push-current` do (BranchListView.tsx's own comment
 *     says so). Every `git-submenu-*` row (BranchSubmenu.tsx) selects plainly, so a
 *     checkout/merge/rename/delete leaves NO menu open — a post-action assertion on
 *     a list row has to reopen the menu first, or it would pass vacuously against a
 *     closed menu.
 *   • Items are `<div role="menuitem">`, so disabled reads as `aria-disabled="true"`
 *     rather than the `disabled` attribute of a real control.
 *   • Branch rows are `DropdownMenuSubTrigger`s (BranchRow.tsx) and the per-branch
 *     actions are a `DropdownMenuSubContent` flyout — clicking a row opens it.
 *   • Forms don't live inside Radix menus: New Branch and Rename are v2 **Dialogs**
 *     (NewBranchDialog / RenameBranchDialog), and an active merge/rebase conflict is
 *     a third Dialog wrapping ConflictView. `git-new-branch-start` is a Select
 *     TRIGGER (a button), so its value is text, not `toHaveValue`.
 *   • Radix keeps a closing menu mounted through its exit animation and swallows a
 *     trigger click landing in that window, so `openBranchPopover` waits for the
 *     previous layer to unmount, for a dying dialog scrim to clear, and for the
 *     branch list's fresh GET to resolve (its `branches` state survives a close, so
 *     a reopen shows the PREVIOUS open's stale rows instantly — waiting on a row
 *     being visible is not enough to know the reload has landed); `closeBranchPopover`
 *     closes the flyout and the root separately (one Escape only pops the innermost
 *     layer). `openSubmenu` retries the open (never the item click) up to twice, and
 *     every `git-submenu-*` click is bounded to its own 5s timeout via
 *     `clickSubmenuItem`, so a stuck interaction fails in seconds and names the
 *     element instead of riding the whole test timeout.
 *
 * BRANCH-ROW FINDINGS (features/session-panel/SummarySection.tsx — these carried
 * over from the retired toolbar chip and still hold):
 *   • The row is not worktree-only: `useDisplayBranch` reads the live branch
 *     (`getGitBranch(port, projectId, chatId)`), so every session shows one. This
 *     spec still seeds a worktree via REST `enable-worktree`, because that is what
 *     makes the popover's git writes land in an isolated checkout (GitService
 *     resolves `getEffectivePath(ctx, projectId, chatId)` → chat.worktreePath)
 *     instead of the project root. A worktree session also earns the row's `wt`
 *     badge (`session-panel-summary-branch-wt`), asserted in the first test.
 *   • `onBranchChanged` is wired to `useDisplayBranch`'s own `refetch` (a popover
 *     write broadcasts no `chat.updated`, so nothing else would invalidate it), so
 *     the row DOES refresh after a checkout / create through the menu. That is
 *     asserted directly below; `git rev-parse --abbrev-ref HEAD` in the worktree
 *     remains the authority for the git-level outcome. The row is NOT refreshed by
 *     this file's own `checkoutBase()` CLI calls — nothing broadcasts them — so row
 *     assertions only ever follow a UI action.
 *
 * Because checking out a branch elsewhere requires it not be checked out in
 * ANY worktree of the repo, every fixture branch below is built with a
 * scratch linked worktree that is immediately removed after committing
 * (`seedBranchCommit`/`addCommitToExistingBranch`) — the project root's own
 * checkout (`main`) and the test chat's worktree checkout never collide with
 * a fixture branch. Tests are ORDER-DEPENDENT (serial, workers:1, one shared
 * fixture) — later tests assume earlier ones left the worktree's current
 * branch back on `e2e-workspace` (see `checkoutBase()`).
 *
 * Testid reference (verified against packages/ui/src/features/git/*.tsx,
 * features/session-panel/SummarySection.tsx and
 * features/sessions/new-thread/WelcomeState.tsx):
 *   session-panel-summary-branch — the session panel's branch row / menu trigger
 *   session-panel-summary-branch-wt — its worktree badge
 *   welcome-branch               — the draft welcome screen's branch pill / trigger
 *   sessions-welcome             — WelcomeState root (the draft empty state)
 *   git-branch-popover           — DropdownMenuContent root (name kept from the Popover era)
 *   git-branch-search            — search input (menu body)
 *   git-fetch                    — quick action; a real Button (disabled while busy)
 *   git-new-branch / git-update-all / git-push-current — quick actions; menu ITEMS
 *   git-branch-list              — BranchList root
 *   git-branch-row-<name>        — a branch row / sub-trigger (full name, incl. "/")
 *   git-branch-section-toggle-<slug> — Local/Remote section collapse (…-local-branches, …-remote)
 *   git-branch-group-<prefix>    — a prefix group's label (e.g. "feature")
 *   git-worktree-row-<dirName>   — a worktree group's label; it carries NO buttons —
 *                                  new-session / delete-worktree moved into the flyout
 *   git-submenu                  — the per-branch flyout (DropdownMenuSubContent)
 *   git-submenu-checkout/-pull/-push/-merge/-rebase/-rename/-delete/-new-branch-from
 *   git-submenu-new-session / -delete-worktree — worktree-only flyout rows
 *   git-new-branch-dialog / -name / -start / -create / -cancel
 *   git-rename-view / -input / -submit / -cancel   (a Dialog now, not an in-menu view)
 *   git-conflict-view / git-conflict-abort         (inside its own Dialog)
 *   git-confirm-dialog / -confirm / -cancel  (ConfirmDialogHost, app-root mounted)
 *   sessions-row                 — session row (data-chat-id), reused from sessions.spec.ts
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { TOAST } from '../helpers/tauri/testids.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { closeMenus, waitForDialogScrimsGone } from '../helpers/tauri/menus.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;
const HOME_BASE = path.join(homedir(), 'tmp');

// ── git helpers (test-process only; array-arg execFileSync, no shell) ─────────

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

function gitCommit(cwd: string, message: string): void {
  git(cwd, ['-c', 'user.email=e2e@mainframe.test', '-c', 'user.name=Mainframe E2E', 'commit', '-m', message]);
}

/** Add one commit to an EXISTING branch via a scratch linked worktree that is
 * removed immediately after — the caller's own checkout never changes, and the
 * branch is free (not checked out anywhere) once this returns. */
function addCommitToExistingBranch(
  projectPath: string,
  branchName: string,
  fileRelPath: string,
  content: string,
  message: string,
): void {
  const scratch = mkdtempSync(path.join(HOME_BASE, 'mf-e2e-scratch-'));
  git(projectPath, ['worktree', 'add', scratch, branchName]);
  writeFileSync(path.join(scratch, fileRelPath), content);
  git(scratch, ['add', '.']);
  gitCommit(scratch, message);
  git(projectPath, ['worktree', 'remove', scratch, '--force']);
}

/** Create `branchName` off `baseRef` with one commit, without ever checking it
 * out in the primary working tree. */
function seedBranchCommit(
  projectPath: string,
  branchName: string,
  baseRef: string,
  fileRelPath: string,
  content: string,
  message: string,
): void {
  git(projectPath, ['branch', branchName, baseRef]);
  addCommitToExistingBranch(projectPath, branchName, fileRelPath, content, message);
}

/** True while any Radix menu layer (root menu or a flyout) is still mounted. */
const menuLayers = (page: Page) => page.locator('[role="menu"]');

/** The menu's trigger since the toolbar chip retired: the session panel's branch row. */
const branchRow = (page: Page) => page.getByTestId('session-panel-summary-branch');

/**
 * Open a BranchPopover trigger — by KEYBOARD, and that is not a style choice.
 *
 * TODO(bug): a plain pointer click cannot open this menu from either of its new
 * triggers. `DropdownMenuTrigger` toggles on POINTERDOWN (Radix opens there so the
 * content can take focus before the button does), and both new triggers ALSO carry
 * their own `onClick={() => setOpen(o => !o)}` — SummarySection.tsx `BranchRowView`
 * and WelcomeState.tsx. So one press runs the toggle twice: pointerdown opens the
 * menu, the click that follows on release closes it again. Measured live: holding
 * the button down keeps the menu up (rows load into it), and it dies on the exact
 * tick the `click` event dispatches, with focus restored to the trigger — a
 * controlled close, not a dismiss (no outside pointerdown, no Escape, no remount:
 * the trigger node is identical across it). The retired `main-toolbar-branch` chip
 * had no `onClick` of its own, which is why nothing caught this.
 *
 * ArrowDown is the honest way through: Radix's trigger opens on it and cancels the
 * event, so no synthetic click follows and the double toggle never happens. Enter
 * and Space do NOT work — verified live (`search=0`): the browser still synthesizes
 * a click for those, which the child handler turns into a close.
 *
 * The pointer route is pinned as its own skipped test at the end of this file, so
 * the bug has a home in the suite and starts passing when the extra handler goes.
 */
async function openTriggerMenu(trigger: Locator): Promise<void> {
  await trigger.focus();
  await trigger.press('ArrowDown');
}

/**
 * Open the branch menu. Waits, in order, for: a previous menu layer to unmount
 * (Radix keeps a closing menu mounted through its exit animation and swallows a
 * trigger click that lands in that window, so the menu would silently fail to
 * open); a dying dialog scrim to clear (this spec opens four kinds of dialog, and
 * `data-slot="dialog-overlay"` outlives its dialog's content, intercepting the
 * trigger click underneath it); and the branch list's *fresh* reload.
 *
 * That last wait has to be on the network response, not on a row being visible.
 * `BranchPopover` keeps its `branches` state across a close — it is only
 * refetched by the `open`-gated `useEffect` — so on every open AFTER the first,
 * a row is visible INSTANTLY from the previous open's stale state, well before
 * the fresh GET resolves. A row-presence wait is satisfied by that cache and
 * returns immediately; the real reload then lands mid-test and re-sorts the
 * list, which can close a flyout the test has already opened on the stale
 * row's position (confirmed with a MutationObserver: reopening right after a
 * CLI-side `checkoutBase()` showed the stale row swap out for the fresh one a
 * beat after the wait had already resolved). Waiting for the GET itself is the
 * only signal that is honest on both the first open and every reopen.
 */
async function openBranchPopover(page: Page): Promise<void> {
  await expect(menuLayers(page)).toHaveCount(0, { timeout: 5_000 });
  await waitForDialogScrimsGone(page);
  const branchesLoaded = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().includes('/git/branches'),
    { timeout: 10_000 },
  );
  await openTriggerMenu(branchRow(page));
  await expect(page.getByTestId('git-branch-search')).toBeVisible({ timeout: 10_000 });
  await branchesLoaded;
  await expect(page.locator('[data-testid^="git-branch-row-"]').first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Close whatever the branch menu currently has open, layer by layer. A single
 * Escape only pops the innermost layer, so an open flyout would leave the root
 * menu up — and a modal Radix menu puts `pointer-events: none` on <html>, which
 * would make every control in the NEXT test unclickable. Selecting an item already
 * closes the whole menu, so this no-ops in that case.
 */
async function closeBranchPopover(page: Page): Promise<void> {
  // One Escape per press, and a press that lands inside a layer's exit animation is
  // swallowed — so this retries while any layer is left rather than pressing once and
  // asserting. A single press was enough when this file ran alone and not in the full
  // suite, where the animation window is longer.
  await closeMenus(page);
  await expect(page.getByTestId('git-branch-popover')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId('git-submenu')).toHaveCount(0);
}

/**
 * Open a branch row's action flyout (the row is a DropdownMenuSubTrigger). The
 * flyout anchors to the row's on-screen position, which is only final once the
 * branch data has landed (the caller's `openBranchPopover` wait for that), but a
 * mid-flight list re-render can still close an already-open Sub before Radix has
 * finished anchoring it. Opening is side-effect-free, so this retries the open —
 * and only the open, never the flyout item click that follows it — up to twice,
 * re-asserting the row is visible between attempts instead of sleeping. The final
 * attempt lets the assertion throw so a genuine failure names the row or the
 * flyout, not a swallowed retry.
 */
async function openSubmenu(page: Page, branch: string): Promise<void> {
  const row = page.getByTestId(`git-branch-row-${branch}`);
  const submenu = page.getByTestId('git-submenu');
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click({ timeout: 5_000 });
    if (attempt === maxAttempts) {
      await expect(submenu).toBeVisible({ timeout: 5_000 });
      return;
    }
    try {
      await expect(submenu).toBeVisible({ timeout: 5_000 });
      return;
    } catch {
      /* a mid-flight re-render closed the flyout before it settled; retry the open */
    }
  }
}

/** Open the branch menu and a branch's flyout in one step. */
async function openBranchSubmenu(page: Page, branch: string): Promise<void> {
  await openBranchPopover(page);
  await openSubmenu(page, branch);
}

/**
 * Click a flyout action item by its `git-submenu-*` testid. Bounded with its own
 * timeout rather than inheriting the whole test timeout: selecting an item is a
 * real git mutation (rule 2 — not retriable), so a failure here must surface in
 * seconds and name the element, instead of riding the 45s mock test timeout the
 * way an unbounded `.click()` would.
 */
async function clickSubmenuItem(page: Page, testid: string): Promise<void> {
  await page.getByTestId(testid).click({ timeout: 5_000 });
}

/**
 * A menu item's enabled state. Radix renders `aria-disabled="true"` on a disabled
 * `role="menuitem"` div and omits the attribute entirely when enabled — there is no
 * `disabled` attribute to read, so `toBeDisabled()` is not the contract here.
 */
function expectItemDisabled(page: Page, testid: string) {
  return expect(page.getByTestId(testid)).toHaveAttribute('aria-disabled', 'true');
}

function expectItemEnabled(page: Page, testid: string) {
  return expect(page.getByTestId(testid)).not.toHaveAttribute('aria-disabled', 'true');
}

test.describe('§git-branch — session-panel branch popover', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let bareRepoPath: string;
  let worktreePath: string; // the active chat's own worktree (branch e2e-workspace)
  let worktreeSessionPath: string;
  let worktreeDeletePath: string;

  /** Reset the active chat's worktree back to its home branch (a git op most
   * mutating tests need after them, done via CLI — no UI round-trip needed). */
  function checkoutBase(): void {
    git(worktreePath, ['checkout', 'e2e-workspace']);
  }

  test.beforeAll(async () => {
    mkdirSync(HOME_BASE, { recursive: true });
    app = await launchTauriApp();
    // The trigger lives in the session panel's Session card, which stacks inline
    // only above INLINE_MIN_WIDTH (1468). At the harness default of 1280 the card
    // would merely float, and the first dialog this file opens would dismiss it.
    await app.page.setViewportSize({ width: 2100, height: 900 });
    project = await createTauriProject(app.page);

    // createTauriProject writes CLAUDE.md/index.ts but never commits them — commit
    // now so the tree starts clean. Every UI checkout/merge/rebase gates on
    // confirmDirtyTree() (a live `git status` read); a dirty tree would surface an
    // unrelated "Uncommitted changes" confirm dialog on nearly every action below.
    git(project.projectPath, ['add', '-A']);
    gitCommit(project.projectPath, 'chore: seed fixture files');

    // ── bare "remote" + tracking branches ────────────────────────────────────
    bareRepoPath = mkdtempSync(path.join(HOME_BASE, 'mf-e2e-remote-'));
    git(bareRepoPath, ['init', '--bare']);
    git(project.projectPath, ['remote', 'add', 'origin', bareRepoPath]);
    git(project.projectPath, ['push', '-u', 'origin', 'main']);

    // ── plain fixture branches (never checked out anywhere) ─────────────────
    seedBranchCommit(project.projectPath, 'feature/ff-branch', 'main', 'ff-file.txt', 'ff\n', 'add ff-file');
    seedBranchCommit(
      project.projectPath,
      'feature/checkout-target',
      'main',
      'checkout-file.txt',
      'x\n',
      'checkout target',
    );
    seedBranchCommit(project.projectPath, 'feature/rename-me', 'main', 'rename-file.txt', 'x\n', 'rename target');
    seedBranchCommit(
      project.projectPath,
      'feature/delete-me',
      'main',
      'delete-file.txt',
      'x\n',
      'delete target (unmerged)',
    );

    // ── pull/push fixtures (tracking origin) ─────────────────────────────────
    seedBranchCommit(project.projectPath, 'feature/pull-target', 'main', 'pull-file-v1.txt', 'v1\n', 'pull v1');
    seedBranchCommit(project.projectPath, 'feature/push-target', 'main', 'push-file-v1.txt', 'v1\n', 'push v1');
    git(project.projectPath, ['push', '-u', 'origin', 'feature/pull-target', 'feature/push-target']);

    // Advance origin's feature/pull-target ahead of the local ref (via a scratch
    // clone of the bare remote) — gives the row-level Pull action a real change.
    const scratchClone = mkdtempSync(path.join(HOME_BASE, 'mf-e2e-clone-'));
    git(HOME_BASE, ['clone', bareRepoPath, scratchClone]);
    git(scratchClone, ['checkout', 'feature/pull-target']);
    writeFileSync(path.join(scratchClone, 'pull-file-v2.txt'), 'v2\n');
    git(scratchClone, ['add', '.']);
    gitCommit(scratchClone, 'pull v2 (remote-only)');
    git(scratchClone, ['push', 'origin', 'feature/pull-target']);
    rmSync(scratchClone, { recursive: true, force: true });

    // Advance feature/push-target's LOCAL ref ahead of origin — a commit that
    // exists only locally, for the row-level Push test to send.
    addCommitToExistingBranch(
      project.projectPath,
      'feature/push-target',
      'push-file-v2.txt',
      'v2\n',
      'push v2 (local-only)',
    );

    // ── conflict fixtures: two branches editing the same line of the same file ─
    seedBranchCommit(
      project.projectPath,
      'feature/conflict-base',
      'main',
      'conflict.txt',
      'original line\n',
      'seed conflict.txt',
    );
    seedBranchCommit(
      project.projectPath,
      'feature/conflict-a',
      'feature/conflict-base',
      'conflict.txt',
      'version A\n',
      'edit line to A',
    );
    seedBranchCommit(
      project.projectPath,
      'feature/conflict-b',
      'feature/conflict-base',
      'conflict.txt',
      'version B\n',
      'edit line to B',
    );

    // ── worktree fixtures (besides the chat's own, created below) ───────────
    worktreeSessionPath = path.join(project.projectPath, '.worktrees-fixture', 'wt-session');
    git(project.projectPath, ['worktree', 'add', '-b', 'feature/worktree-session', worktreeSessionPath, 'main']);
    worktreeDeletePath = path.join(project.projectPath, '.worktrees-fixture', 'wt-delete');
    git(project.projectPath, ['worktree', 'add', '-b', 'feature/worktree-delete', worktreeDeletePath, 'main']);

    // ── chat + its own worktree (the popover's writes follow the chat) ──────
    const chatId = await createTauriChat(app.page, project.projectId, 'default');
    const res = await fetch(`${DAEMON_BASE}/api/chats/${chatId}/enable-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseBranch: 'main', branchName: 'e2e-workspace' }),
    });
    if (!res.ok) throw new Error(`enable-worktree failed: ${res.status} ${await res.text()}`);
    worktreePath = path.join(project.projectPath, '.worktrees', 'e2e-workspace');

    // chat.updated broadcasts live (config-manager applyWorktreeUpdate) — wait for
    // the panel's branch row before any test touches the popover.
    await expect(branchRow(app.page)).toContainText('e2e-workspace', { timeout: 15_000 });
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    rmSync(bareRepoPath, { recursive: true, force: true });
    await closeTauriApp(app);
  });

  test('the panel branch row opens the menu; branches lazy-load', async () => {
    const { page } = app;
    // The row is the trigger AND the readout: a worktree session earns the badge.
    await expect(page.getByTestId('session-panel-summary-branch-wt')).toBeVisible();

    await openBranchPopover(page);
    await expect(page.getByTestId('git-branch-list')).toBeVisible();
    await expect(page.getByTestId('git-branch-row-main')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('git-branch-row-feature/ff-branch')).toBeVisible();
    await expect(page.getByTestId('git-branch-row-feature/pull-target')).toBeVisible();
    await expect(page.getByTestId('git-worktree-row-wt-session')).toBeVisible();
    await expect(page.getByTestId('git-worktree-row-wt-delete')).toBeVisible();
    await closeBranchPopover(page);
  });

  test('search filters the branch list by substring', async () => {
    const { page } = app;
    await openBranchPopover(page);
    await page.getByTestId('git-branch-search').fill('conflict');
    await expect(page.getByTestId('git-branch-row-feature/conflict-a')).toBeVisible();
    await expect(page.getByTestId('git-branch-row-feature/conflict-b')).toBeVisible();
    await expect(page.getByTestId('git-branch-row-main')).toHaveCount(0);
    await expect(page.getByTestId('git-branch-row-feature/ff-branch')).toHaveCount(0);
    await page.getByTestId('git-branch-search').fill('');
    await expect(page.getByTestId('git-branch-row-main')).toBeVisible();
    await closeBranchPopover(page);
  });

  test('the Local branches section header collapses and expands its rows', async () => {
    const { page } = app;
    // The only collapse affordance in the menu: BranchGroupSection wraps each
    // section (Local / Remote) in a Collapsible whose trigger is NOT a menu item,
    // so toggling it never closes the menu. Worktree groups have no toggle of their
    // own any more — WorktreeSection renders a bare label.
    await openBranchPopover(page);
    const row = page.getByTestId('git-branch-row-main');
    await expect(row).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('git-branch-section-toggle-local-branches').click();
    await expect(row).toHaveCount(0);
    await page.getByTestId('git-branch-section-toggle-local-branches').click();
    await expect(row).toBeVisible();
    // The menu itself survived both toggles.
    await expect(page.getByTestId('git-branch-search')).toBeVisible();
    await closeBranchPopover(page);
  });

  test('new branch dialog creates a branch, checks it out, and refreshes the panel row', async () => {
    const { page } = app;
    await openBranchPopover(page);
    // `git-new-branch` selects plainly, so the menu closes as the dialog opens.
    await page.getByTestId('git-new-branch').click();
    await expect(page.getByTestId('git-new-branch-dialog')).toBeVisible();
    await expect(page.getByTestId('git-branch-popover')).toHaveCount(0);
    await page.getByTestId('git-new-branch-name').fill('feature/e2e-created');
    await page.getByTestId('git-new-branch-create').click();
    await expect(page.getByTestId('git-new-branch-dialog')).toHaveCount(0, { timeout: 10_000 });

    expect(git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('feature/e2e-created');
    // handleCreate → onBranchChanged → useDisplayBranch.refetch re-reads the live branch.
    await expect(branchRow(page)).toContainText('feature/e2e-created', { timeout: 10_000 });

    // The new branch is in the list — assert it with the menu REOPENED, since the
    // create closed it.
    await openBranchPopover(page);
    await expect(page.getByTestId('git-branch-row-feature/e2e-created')).toBeVisible({ timeout: 10_000 });
    await closeBranchPopover(page);

    checkoutBase();
  });

  test('branch row flyout: checkout switches the worktree current branch', async () => {
    const { page } = app;
    await openBranchSubmenu(page, 'feature/checkout-target');
    await expectItemEnabled(page, 'git-submenu-checkout');
    await clickSubmenuItem(page, 'git-submenu-checkout');
    // Selecting the item closes the whole menu (BranchSubmenu items don't
    // preventDefault) — the outcome is read from git and from the panel row.
    await expect(page.getByTestId('git-branch-popover')).toHaveCount(0, { timeout: 5_000 });

    await expect
      .poll(() => git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), { timeout: 10_000 })
      .toBe('feature/checkout-target');
    await expect(branchRow(page)).toContainText('feature/checkout-target', { timeout: 10_000 });

    // Reopened, the flyout re-derives isCurrent from the refreshed branch list, so
    // Checkout is now disabled for that branch (aria-disabled — it's a menuitem div).
    await openBranchSubmenu(page, 'feature/checkout-target');
    await expectItemDisabled(page, 'git-submenu-checkout');
    await closeBranchPopover(page);

    checkoutBase();
  });

  test('branch row flyout: new branch from a selected branch', async () => {
    const { page } = app;
    await openBranchSubmenu(page, 'main');
    await clickSubmenuItem(page, 'git-submenu-new-branch-from');
    await expect(page.getByTestId('git-new-branch-dialog')).toBeVisible();
    // `git-new-branch-start` is a Select TRIGGER (a button showing SelectValue),
    // not an input — the start point is its text.
    await expect(page.getByTestId('git-new-branch-start')).toContainText('main');
    await page.getByTestId('git-new-branch-name').fill('feature/from-main');
    await page.getByTestId('git-new-branch-create').click();
    await expect(page.getByTestId('git-new-branch-dialog')).toHaveCount(0, { timeout: 10_000 });

    expect(git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('feature/from-main');
    checkoutBase();
  });

  test('branch row flyout: merge fast-forwards a clean ancestor branch', async () => {
    const { page } = app;
    const ffHead = git(project.projectPath, ['rev-parse', 'feature/ff-branch']).trim();
    expect(git(worktreePath, ['rev-parse', 'HEAD']).trim()).not.toBe(ffHead);

    await openBranchSubmenu(page, 'feature/ff-branch');
    await expectItemEnabled(page, 'git-submenu-merge');
    await clickSubmenuItem(page, 'git-submenu-merge');
    await expect(page.getByTestId('git-branch-popover')).toHaveCount(0, { timeout: 5_000 });

    await expect.poll(() => git(worktreePath, ['rev-parse', 'HEAD']).trim(), { timeout: 10_000 }).toBe(ffHead);
    expect(git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('e2e-workspace');
  });

  test('branch row flyout: Rename… hands off to the rename dialog', async () => {
    const { page } = app;
    await openBranchSubmenu(page, 'feature/rename-me');
    await clickSubmenuItem(page, 'git-submenu-rename');

    // Forms don't live in Radix menus: Rename is its own Dialog and the menu closes
    // behind it (RenameBranchDialog / BranchPopover's DialogState).
    const renameDialog = page.getByTestId('git-rename-view');
    await expect(renameDialog).toBeVisible();
    await expect(page.getByTestId('git-branch-popover')).toHaveCount(0);
    const input = page.getByTestId('git-rename-input');
    await expect(input).toHaveValue('feature/rename-me');
    await input.fill('feature/renamed-branch');
    await page.getByTestId('git-rename-submit').click();

    await expect(renameDialog).toHaveCount(0, { timeout: 10_000 });
    const branches = git(project.projectPath, ['branch', '--list']);
    expect(branches).toContain('feature/renamed-branch');
    expect(branches).not.toContain('feature/rename-me');

    // The reloaded list carries the new name — asserted with the menu reopened,
    // since the rename closed it.
    await openBranchPopover(page);
    await expect(page.getByTestId('git-branch-row-feature/renamed-branch')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('git-branch-row-feature/rename-me')).toHaveCount(0);
    await closeBranchPopover(page);
  });

  test('branch row flyout: delete force-deletes a not-yet-merged branch (two-step confirm)', async () => {
    const { page } = app;
    await openBranchSubmenu(page, 'feature/delete-me');
    await clickSubmenuItem(page, 'git-submenu-delete');

    const confirmDialog = page.getByTestId('git-confirm-dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await expect(confirmDialog).toContainText("Delete branch 'feature/delete-me'?");
    await page.getByTestId('git-confirm-dialog-confirm').click();

    // Not merged into the worktree's current branch — a second, force-delete
    // confirm follows (use-branch-actions.ts handleDelete two-step flow).
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await expect(confirmDialog).toContainText('Force delete');
    await page.getByTestId('git-confirm-dialog-confirm').click();

    await expect
      .poll(() => git(project.projectPath, ['branch', '--list']), { timeout: 10_000 })
      .not.toContain('feature/delete-me');

    // Row gone from the reloaded list — the menu closed on the item select, so this
    // has to be re-opened or it would assert against no list at all.
    await openBranchPopover(page);
    await expect(page.getByTestId('git-branch-row-feature/delete-me')).toHaveCount(0);
    await expect(page.getByTestId('git-branch-row-main')).toBeVisible({ timeout: 10_000 });
    await closeBranchPopover(page);
  });

  test('branch row flyout: pull fast-forwards a branch from the bare remote', async () => {
    const { page } = app;
    const remoteHead = git(bareRepoPath, ['rev-parse', 'feature/pull-target']).trim();
    expect(git(project.projectPath, ['rev-parse', 'feature/pull-target']).trim()).not.toBe(remoteHead);

    await openBranchSubmenu(page, 'feature/pull-target');
    await clickSubmenuItem(page, 'git-submenu-pull');

    await expect
      .poll(() => git(project.projectPath, ['rev-parse', 'feature/pull-target']).trim(), { timeout: 15_000 })
      .toBe(remoteHead);
    await closeBranchPopover(page);
  });

  test('branch row flyout: push sends a local-only commit to the bare remote', async () => {
    const { page } = app;
    const localHead = git(project.projectPath, ['rev-parse', 'feature/push-target']).trim();
    expect(git(bareRepoPath, ['rev-parse', 'feature/push-target']).trim()).not.toBe(localHead);

    await openBranchSubmenu(page, 'feature/push-target');
    await clickSubmenuItem(page, 'git-submenu-push');

    await expect
      .poll(() => git(bareRepoPath, ['rev-parse', 'feature/push-target']).trim(), { timeout: 15_000 })
      .toBe(localHead);
    await closeBranchPopover(page);
  });

  test('conflict view: a conflicting merge routes the branch menu to the conflict dialog; abort recovers', async () => {
    const { page } = app;
    await openBranchSubmenu(page, 'feature/conflict-a');
    await clickSubmenuItem(page, 'git-submenu-checkout');
    await expect
      .poll(() => git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), { timeout: 10_000 })
      .toBe('feature/conflict-a');

    await openBranchSubmenu(page, 'feature/conflict-b');
    await clickSubmenuItem(page, 'git-submenu-merge');

    // Selecting Merge closes the menu, and BranchPopover only swaps in the conflict
    // dialog while the menu is OPEN (`if (open && hasConflict)`), so the conflict
    // surfaces on the next open rather than immediately. Reopening the trigger
    // therefore yields the conflict dialog INSTEAD of the branch list.
    const conflictView = page.getByTestId('git-conflict-view');
    await expect(page.getByTestId('git-branch-popover')).toHaveCount(0, { timeout: 10_000 });
    await expect(conflictView).toHaveCount(0);
    await expect
      .poll(() => git(worktreePath, ['status', '--porcelain']).trim(), { timeout: 15_000 })
      .toContain('conflict.txt');

    await expect(menuLayers(page)).toHaveCount(0, { timeout: 5_000 });
    await openTriggerMenu(branchRow(page));
    await expect(conflictView).toBeVisible({ timeout: 15_000 });
    await expect(conflictView).toContainText('conflict.txt');
    await expect(page.getByTestId('git-branch-search')).toHaveCount(0);

    // Abort closes the dialog outright — it does not fall back to the branch list.
    await page.getByTestId('git-conflict-abort').click();
    await expect(conflictView).toHaveCount(0, { timeout: 10_000 });

    expect(git(worktreePath, ['status', '--porcelain']).trim()).toBe('');
    expect(git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('feature/conflict-a');
    checkoutBase();

    // With the conflict cleared, the menu opens normally again.
    await openBranchPopover(page);
    await closeBranchPopover(page);
  });

  test('worktree branch flyout: Delete Worktree removes wt-delete', async () => {
    const { page } = app;
    // The worktree affordances moved OUT of the worktree label row and INTO each
    // worktree branch's flyout (WorktreeSection.tsx: "the label row carries no
    // buttons of its own"), so the delete is reached through the branch row.
    await openBranchPopover(page);
    await expect(page.getByTestId('git-worktree-row-wt-delete')).toBeVisible({ timeout: 10_000 });
    await openSubmenu(page, 'feature/worktree-delete');

    // Assert the daemon's own delete-worktree REST call actually succeeded, not just that
    // the row disappeared from the (optimistically-updated) list — this is the
    // observable server-side outcome the row-disappearance is supposed to reflect.
    const respPromise = page.waitForResponse((r) => r.url().includes('/git/delete-worktree'));

    await clickSubmenuItem(page, 'git-submenu-delete-worktree');
    const confirmDialog = page.getByTestId('git-confirm-dialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await expect(confirmDialog).toContainText('wt-delete');
    await page.getByTestId('git-confirm-dialog-confirm').click();

    const resp = await respPromise;
    expect(resp.status()).toBe(200);

    // The daemon's delete-worktree route fully awaits `removeWorktree()` before responding, so
    // the git-level effects are already committed by the time the 200 above is observed — this
    // poll is a small safety margin against filesystem-visibility lag, not a real wait.
    await expect.poll(() => existsSync(worktreeDeletePath), { timeout: 3_000 }).toBe(false);
    await expect
      .poll(() => git(project.projectPath, ['worktree', 'list']), { timeout: 3_000 })
      .not.toContain('wt-delete');

    // Gone from the reloaded list too (menu reopened — the item select closed it).
    await openBranchPopover(page);
    await expect(page.getByTestId('git-worktree-row-wt-delete')).toHaveCount(0, { timeout: 15_000 });
    await closeBranchPopover(page);
  });

  test('quick actions: fetch, update all, and push current complete without error', async () => {
    const { page } = app;
    const errorToasts = () => page.locator(TOAST.root).filter({ hasText: /failed|error/i });

    await openBranchPopover(page);

    // Fetch is a real Button (`disabled={busy}`), so enabled-again is its idle signal.
    await page.getByTestId('git-fetch').click();
    await expect(page.getByTestId('git-fetch')).toBeEnabled({ timeout: 15_000 });
    await expect(errorToasts()).toHaveCount(0);

    // Update all / Push are menu ITEMS whose handlers preventDefault, so the menu
    // stays OPEN for their busy spinners. Their completion shows up as the success
    // toast `handleUpdateAll`/`handlePush` raise, not as a re-enabled control (a
    // menuitem carries `aria-disabled`, and it clears too early to wait on).
    await page.getByTestId('git-update-all').click();
    await expect(page.getByTestId('git-branch-search')).toBeVisible();
    await expect(page.locator(TOAST.root).filter({ hasText: /up to date|pulled|updated/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(errorToasts()).toHaveCount(0);

    const localHead = git(worktreePath, ['rev-parse', 'HEAD']).trim();
    await page.getByTestId('git-push-current').click();
    await closeBranchPopover(page);

    // Push-current sends the worktree's checked-out branch (e2e-workspace) — the
    // bare remote gains a matching ref once the push round-trips.
    await expect
      .poll(() => git(bareRepoPath, ['rev-parse', 'e2e-workspace']).trim(), { timeout: 15_000 })
      .toBe(localHead);
  });

  // Last test: navigates the app to a NEW worktree-scoped chat, so nothing after
  // this can assume the original chat/worktree is still active.
  test('worktree branch flyout: New Session on Worktree creates a worktree-scoped chat', async () => {
    const { page } = app;
    const rowsBefore = await page.getByTestId('sessions-row').count();

    // Also moved into the flyout — `git-submenu-new-session` is only rendered for a
    // branch that IS checked out in a worktree (BranchSubmenu's isWorktree branch).
    await openBranchSubmenu(page, 'feature/worktree-session');
    await clickSubmenuItem(page, 'git-submenu-new-session');

    // The menu closes both ways here: the item select closes it, and the new-session
    // flow calls `onDone`/closeMenu as well (useNewSessionAction).
    await expect(page.getByTestId('git-branch-popover')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('sessions-row')).toHaveCount(rowsBefore + 1, { timeout: 15_000 });

    // The new chat is worktree-scoped on feature/worktree-session — the row follows
    // the newly-activated chat's own identity (useDisplayBranch re-reads the live
    // branch for the new chatId).
    await expect(branchRow(page)).toContainText('feature/worktree-session', { timeout: 15_000 });
  });

  // The draft welcome screen carries the SECOND entry point to this same popover
  // (WelcomeState.tsx), and it is read-only here on purpose: the pill passes no
  // chatId, so every write would land in the project ROOT checkout that the
  // fixtures above depend on. Last test in the file — it leaves a draft active.
  test('the welcome screen branch pill opens the same popover for the project', async () => {
    const { page } = app;
    await sessionsSidebar(page).newButton().click();
    await page.getByTestId(`sessions-new-picker-project-${project.projectId}`).click({ timeout: 10_000 });
    await expect(page.getByTestId('sessions-new-picker')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('sessions-welcome')).toBeVisible({ timeout: 10_000 });

    // The pill names the PROJECT's checkout (`main`), not any worktree session's.
    const pill = page.getByTestId('welcome-branch');
    await expect(pill).toContainText('main', { timeout: 15_000 });

    await expect(menuLayers(page)).toHaveCount(0, { timeout: 5_000 });
    const branchesLoaded = page.waitForResponse(
      (r) => r.request().method() === 'GET' && r.url().includes('/git/branches'),
      { timeout: 10_000 },
    );
    await openTriggerMenu(pill);
    await expect(page.getByTestId('git-branch-popover')).toBeVisible({ timeout: 10_000 });
    await branchesLoaded;
    // Same menu, same rows — including the branch the fixtures created above.
    await expect(page.getByTestId('git-branch-row-feature/e2e-created')).toBeVisible({ timeout: 10_000 });
    await closeBranchPopover(page);
  });

  // The POINTER contract, stated once: both triggers used to carry their own
  // `onClick={() => setOpen(o => !o)}`, which double-toggled against
  // `DropdownMenuTrigger`'s pointerdown open — a plain click flashed the menu
  // and dismissed it. The handlers are gone; this pins that a click opens the
  // menu and it STAYS open. (The other tests open via ArrowDown for stability.)
  // Continues from the welcome draft the test above left active.
  test('clicking the branch row opens the menu and keeps it open', async () => {
    const { page } = app;
    await expect(menuLayers(page)).toHaveCount(0, { timeout: 5_000 });
    await page.getByTestId('welcome-branch').click();
    await expect(page.getByTestId('git-branch-popover')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('git-branch-row-main')).toBeVisible({ timeout: 10_000 });
    await closeBranchPopover(page);
  });
});
