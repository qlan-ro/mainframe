/**
 * §editor-comments-review — inline gutter comments, submit-review, and the
 * editor right-click context menu (spec #18 of
 * docs/plans/2026-07-03-tauri-e2e-test-plan.md, Cluster C).
 *
 * Source read: features/editor/inline-comments/{use-inline-comments,
 * comment-gutter,comment-gutter-state,comment-gutter-markers,
 * CmEditorWithComments,InlineCommentWidget,use-review-actions,use-send-review,
 * resolve-comment-range}.ts(x), features/editor/context-menu/EditorContextMenu.tsx,
 * features/editor/lsp/references-panel.tsx, features/editor/use-lsp-document.ts,
 * features/editor/EditorTab.tsx, features/chat/messages/{UserMessage,
 * ReviewCommentCard}.tsx, features/chat/view-model/parse-review-comment.ts,
 * lib/editor/format-line-comment.ts, lib/editor/copy-reference.ts,
 * lib/lsp/{index,language-detection}.ts, packages/core/src/lsp/{lsp-registry,
 * lsp-manager}.ts.
 *
 * Distinct from review-panel.spec.ts's "Diff of `file`" producer (the ⌘⇧R
 * Review Changes modal, ReviewDiffView.tsx): this spec drives the OTHER
 * producer — the in-editor gutter widget's `useSendReview` → `formatReview`,
 * which emits a "File: `file`" header. Both land on the same
 * `parseReviewComment`/`ReviewCommentCard` renderer (verified: the header
 * regex accepts both prefixes), but the entry points, data model
 * (`useInlineComments`), and CM6 gutter extension are unique to this surface.
 *
 * Gutter interaction: CM6 gutter markers have no testids by design (plan's
 * CM6-internals exception). `comment-gutter-markers.ts`'s `lineMarker`
 * callback renders exactly one marker per visible line: `.cm-comment-gutter-add`
 * (button) for an uncommented line, or `.cm-comment-gutter-marker` (span,
 * "●") for a line with an anchored comment — mutually exclusive, always in
 * document order. The add-button's `visible` flag only toggles a CSS
 * `opacity` (hover affordance) and does NOT gate the click handler, so tests
 * click the button directly without simulating a hover first. Clicking an
 * add-button immediately creates a (possibly empty-text) anchor — CANCEL/
 * ESCAPE close the widget WITHOUT deleting that anchor (`CmEditorWithComments`
 * onClose → closePortal only; no delete path is wired to Cancel/Escape/the
 * widget's `onDelete` prop) — so the ● marker persists even for an abandoned
 * add. This is real, verified behavior (see `onSave`/`onClose` wiring in
 * `CmEditorWithComments.tsx` and the widget's Cancel button using `onClose`,
 * not `onDelete`), not a workaround — tests assert it as-is and flag it in
 * the report as a UX quirk worth a design decision, not "fixed" here.
 *
 * Testid reference (verified against packages/ui/src):
 *   main-toolbar-inspector        — reveals the Inspector (file tree)
 *   file-tree / file-tree-row-<path> — tree root / row (opens the file)
 *   editor-tab / editor-code       — EditorTab root / CmEditor host
 *   editor-comment-widget          — InlineCommentWidget root (portal host has the same testid; scoped via page.getByTestId, always exactly one open at a time in these tests)
 *   editor-comment-widget-snippet  — quoted code preview inside the widget
 *   editor-comment-widget-input    — the comment textarea
 *   editor-comment-widget-save     — "Add context" (save) button
 *   editor-comment-widget-cancel   — Cancel button
 *   editor-comment-widget-close    — header "X" close button
 *   editor-submit-review           — SubmitReviewBar root ("{n} agent notes")
 *   editor-submit-review-btn       — "Submit review (N)" button (disabled until any comment has text)
 *   editor-context-menu            — ContextMenuTrigger wrapper (right-click target)
 *   editor-context-menu-content    — ContextMenuContent root
 *   editor-context-menu-copy       — Copy (selection → clipboard)
 *   editor-context-menu-copy-ref   — Copy Reference ("path:line" → clipboard)
 *   editor-context-menu-add-context — Add Agent Context (→ composer quote)
 *   editor-context-menu-go-to-def  — Go to Definition (disabled unless LSP ready)
 *   editor-context-menu-find-refs  — Find All References (disabled unless LSP ready)
 *   composer-quote-preview / composer-quote-dismiss — composer quote pill
 *   chat-user-review-comment       — the parsed review-comment message card
 *   chat-user-review-comment-L<n>  — one comment section within that card
 *
 * LSP availability in this e2e environment (traced, not assumed): `typescript`
 * and `typescript-language-server` ARE real resolvable deps of packages/core
 * (lsp-registry.ts's `resolveBundledBinPath` / package.json), so the daemon
 * CAN spawn a real LSP server process — "unavailable" would be the wrong
 * conclusion. But `EditorContextMenu`'s `lspAvailable` gate needs BOTH a
 * `providers` object AND `lspConfig.lspReady`, and `useLspDocument` only flips
 * `lspReady` true after a real child-process spawn + WebSocket handshake +
 * `initialize` round-trip completes — no bounded, deterministic window, and
 * typescript-language-server's own package.json declares no `dependencies`
 * (it expects to resolve `typescript` from the analyzed workspace), which our
 * throwaway e2e temp project never has. Rather than gate a real go-to-def/
 * find-references round trip on that spawn (flaky by construction — no
 * `waitForTimeout` workaround makes an external process's cold-start
 * deterministic), the disabled-state assertions here use a `.txt` fixture:
 * `getLspLanguage()` has no entry for `.txt`, so `EditorTab` never constructs
 * a `lspConfig` for it at all — `lspAvailable` is `false` unconditionally,
 * independent of daemon/process timing. See the trailing `test.skip` for the
 * live-path TODO.
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

// ── Fixture content ─────────────────────────────────────────────────────────
//
// 7 lines, no trailing blank line asserted on (the file is written with a
// trailing '\n' for on-disk hygiene, which CM6 shows as an 8th empty line —
// never targeted by any locator below, so it's harmless).
const FIXTURE_LINES = [
  'export function add(a: number, b: number) {', // line 1
  '  return a + b;', // line 2
  '}', // line 3
  '', // line 4
  'export function subtract(a: number, b: number) {', // line 5
  '  return a - b;', // line 6
  '}', // line 7
];

function writeFixture(dir: string): void {
  writeFileSync(path.join(dir, 'review.ts'), FIXTURE_LINES.join('\n') + '\n');
  writeFileSync(path.join(dir, 'readme.txt'), 'Project notes.\nSecond line.\n');
}

async function openInspectorAndFile(app: TauriAppFixture, fileName: string): Promise<void> {
  const { page } = app;
  await page.getByTestId('main-toolbar-inspector').click();
  await page.getByTestId('file-tree').waitFor({ timeout: 10_000 });
  await page.getByTestId(`file-tree-row-${fileName}`).click();
  await page.getByTestId('editor-code').waitFor({ timeout: 10_000 });
}

// ─── §editor-comments-review — inline comment gutter (UI-only) ────────────────

test.describe('§editor-comments-review — inline comment gutter', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    writeFixture(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
    // Copy / Copy Reference read back via navigator.clipboard.readText().
    await app.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openInspectorAndFile(app, 'review.ts');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('clicking an empty gutter line opens the comment widget with the line snippet and an empty input', async () => {
    const { page } = app;
    const editorCode = page.getByTestId('editor-code');
    // Line 2 ("  return a + b;") — index 1, 0-based, matching document order.
    await editorCode.locator('.cm-comment-gutter-add').nth(1).click();

    const widget = page.getByTestId('editor-comment-widget');
    await expect(widget).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('editor-comment-widget-snippet')).toContainText('return a + b;');
    await expect(page.getByTestId('editor-comment-widget-input')).toHaveValue('');
  });

  test('typing text and clicking "Add context" saves the comment and closes the widget, leaving the ● marker', async () => {
    const { page } = app;
    await page.getByTestId('editor-comment-widget-input').fill('Should this handle negative numbers?');
    await page.getByTestId('editor-comment-widget-save').click();

    await expect(page.getByTestId('editor-comment-widget')).toHaveCount(0);
    const editorCode = page.getByTestId('editor-code');
    await expect(editorCode.locator('.cm-comment-gutter-marker')).toHaveCount(1);
  });

  test('clicking the ● marker reopens the widget pre-filled with the saved text', async () => {
    const { page } = app;
    const editorCode = page.getByTestId('editor-code');
    await editorCode.locator('.cm-comment-gutter-marker').nth(0).click();

    const widget = page.getByTestId('editor-comment-widget');
    await expect(widget).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('editor-comment-widget-input')).toHaveValue('Should this handle negative numbers?');

    // Close without editing (header X) — leaves the saved comment untouched.
    await page.getByTestId('editor-comment-widget-close').click();
    await expect(widget).toHaveCount(0);
  });

  test('Cancel discards a typed draft on a new comment, but the ● marker still persists (anchor was already created on gutter-click)', async () => {
    const { page } = app;
    const editorCode = page.getByTestId('editor-code');
    // Remaining add-buttons are for lines [1,3,4,5,6,7] in order — index 1 is line 3 ("}").
    await editorCode.locator('.cm-comment-gutter-add').nth(1).click();
    const widget = page.getByTestId('editor-comment-widget');
    await expect(widget).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('editor-comment-widget-input').fill('temp draft — should not be saved');
    await page.getByTestId('editor-comment-widget-cancel').click();
    await expect(widget).toHaveCount(0);

    // Two markers now exist (line 2, line 3); the line-3 marker is the second.
    await expect(editorCode.locator('.cm-comment-gutter-marker')).toHaveCount(2);
    await editorCode.locator('.cm-comment-gutter-marker').nth(1).click();
    await expect(widget).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('editor-comment-widget-input')).toHaveValue('');
    await page.getByTestId('editor-comment-widget-close').click();
    await expect(widget).toHaveCount(0);
  });

  test('Escape discards a typed draft the same way Cancel does', async () => {
    const { page } = app;
    const editorCode = page.getByTestId('editor-code');
    // Remaining add-buttons are for lines [1,4,5,6,7] in order — index 3 is line 6 ("  return a - b;").
    await editorCode.locator('.cm-comment-gutter-add').nth(3).click();
    const widget = page.getByTestId('editor-comment-widget');
    await expect(widget).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('editor-comment-widget-input').fill('temp escape draft — should not be saved');
    await page.keyboard.press('Escape');
    await expect(widget).toHaveCount(0);

    // Three markers now exist (lines 2, 3, 6); the line-6 marker is the third.
    await expect(editorCode.locator('.cm-comment-gutter-marker')).toHaveCount(3);
    await editorCode.locator('.cm-comment-gutter-marker').nth(2).click();
    await expect(widget).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('editor-comment-widget-input')).toHaveValue('');
    await page.getByTestId('editor-comment-widget-close').click();
    await expect(widget).toHaveCount(0);
  });

  test('the submit-review bar shows the total comment count and enables submit once any comment has text', async () => {
    const { page } = app;
    // 3 comments total (line 2 has text, lines 3 and 6 are empty drafts) → filledCount 1.
    const bar = page.getByTestId('editor-submit-review');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('3 agent notes');
    const submitBtn = page.getByTestId('editor-submit-review-btn');
    await expect(submitBtn).toHaveText('Submit review (3)');
    await expect(submitBtn).toBeEnabled();
  });

  test('right-click → Copy copies the selected line text to the clipboard', async () => {
    const { page } = app;
    const firstLine = page.getByTestId('editor-code').locator('.cm-line').first();
    // Triple-click selects the whole line (CM6's native line-select gesture).
    await firstLine.click({ clickCount: 3 });
    await firstLine.click({ button: 'right' });

    await expect(page.getByTestId('editor-context-menu-content')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('editor-context-menu-copy').click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('export function add');
  });

  test('right-click → Copy Reference writes "path:line" to the clipboard', async () => {
    const { page } = app;
    const line2 = page.getByTestId('editor-code').locator('.cm-line').nth(1);
    // Home lands the cursor at column 0 (before the leading whitespace) — no
    // word touches that boundary, so the reference has no "(word)" suffix.
    await line2.click();
    await page.keyboard.press('Home');
    await line2.click({ button: 'right' });

    await expect(page.getByTestId('editor-context-menu-content')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('editor-context-menu-copy-ref').click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe('review.ts:2');
  });

  test('right-click → Add Agent Context sets the composer quote to the same "path:line" reference', async () => {
    const { page } = app;
    const line2 = page.getByTestId('editor-code').locator('.cm-line').nth(1);
    await line2.click();
    await page.keyboard.press('Home');
    await line2.click({ button: 'right' });

    await expect(page.getByTestId('editor-context-menu-content')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('editor-context-menu-add-context').click();

    const preview = page.getByTestId('composer-quote-preview');
    await expect(preview).toBeVisible({ timeout: 5_000 });
    await expect(preview).toContainText('review.ts:2');

    // Clean up so the pill doesn't linger into the next describe's assertions.
    await page.getByTestId('composer-quote-dismiss').click();
    await expect(preview).toHaveCount(0);
  });

  test('Go to Definition / Find All References are disabled for a file type with no LSP language mapping', async () => {
    const { page } = app;
    // readme.txt has no getLspLanguage() entry — EditorTab never builds an
    // lspConfig for it, so lspAvailable is false deterministically (not a
    // timing race against a real LSP server spawn — see file-level docstring).
    await openInspectorAndFile(app, 'readme.txt');

    const firstLine = page.getByTestId('editor-code').locator('.cm-line').first();
    await firstLine.click({ button: 'right' });
    await expect(page.getByTestId('editor-context-menu-content')).toBeVisible({ timeout: 5_000 });

    await expect(page.getByTestId('editor-context-menu-go-to-def')).toHaveAttribute('data-disabled');
    await expect(page.getByTestId('editor-context-menu-find-refs')).toHaveAttribute('data-disabled');
    await page.keyboard.press('Escape');
  });

  // TODO(app-tauri): a live Go to Definition / Find All References happy path
  // needs a fixture project that ships its own node_modules/typescript (so
  // typescript-language-server's workspace-relative `require('typescript')`
  // resolves) PLUS a bounded, reliable readiness signal for the real spawned
  // process (today: poll lspReady/menu-item enabled state with a generous
  // timeout, or add a daemon-side "LSP ready" WS event -- neither exists yet).
  // Until then, a real go-to-def assertion here would be flaky by
  // construction (external process cold-start + no workspace `typescript`).
  test.skip('Go to Definition jumps to the symbol and Find All References lists + closes the panel', () => {
    // Not attempted — see TODO above and the file-level docstring's LSP-availability trace.
  });
});

// ─── §editor-comments-review — submit review to chat ───────────────────────────
//
// Posting a review goes through the real runtime.append → controller.sendMessage
// path (useSendReview.ts) — the same one composer send / ReviewPanel comments
// use — so it needs a live chat and, under E2E_MODE=mock, a recording. `thread`
// is reused (content-agnostic replay, matches review-panel.spec.ts's identical
// "comment to chat" scenario); this test never inspects the assistant's reply,
// only that the user turn it produces renders as a ReviewCommentCard.

test.describe('§editor-comments-review — submit review to chat', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'thread' });
    project = await createTauriProject(app.page);
    writeFixture(project.projectPath);
    await createTauriChat(app.page, project.projectId, 'default');
    await openInspectorAndFile(app, 'review.ts');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('submitting a single-comment review clears the gutter and posts a ReviewCommentCard to the chat', async () => {
    const { page } = app;
    const editorCode = page.getByTestId('editor-code');
    // Line 2 ("  return a + b;") — index 1.
    await editorCode.locator('.cm-comment-gutter-add').nth(1).click();
    await page.getByTestId('editor-comment-widget-input').fill('Should this handle negative numbers?');
    await page.getByTestId('editor-comment-widget-save').click();

    const submitBtn = page.getByTestId('editor-submit-review-btn');
    await expect(submitBtn).toHaveText('Submit review (1)');
    await submitBtn.click();

    // handleSubmitReview removes every comment (whether it had text or not) —
    // the bar and the gutter marker both disappear.
    await expect(page.getByTestId('editor-submit-review')).toHaveCount(0);
    await expect(editorCode.locator('.cm-comment-gutter-marker')).toHaveCount(0);

    const card = page.getByTestId('chat-user-review-comment');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('review.ts');
    const section = page.getByTestId('chat-user-review-comment-L2');
    await expect(section).toBeVisible();
    await expect(section).toContainText('Should this handle negative numbers?');
  });
});
